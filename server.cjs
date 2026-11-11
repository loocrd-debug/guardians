const express = require('express')
const cors = require('cors')
const { chromium, webkit, firefox } = require('playwright')
const { createServer } = require('http')
const { readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync } = require('fs')
// fileURLToPath not needed in CJS
const { dirname, join, extname } = require('path')
// createRequire not needed in CJS
const ExcelJS = require('exceljs')
const { tmpdir, homedir } = require('os')
const { randomBytes } = require('crypto')

// ── PKG(exe) 실행 시 Chromium 경로 자동 탐지 ──────────
// pkg로 빌드된 exe는 __dirname이 스냅샷 내부를 가리키므로
// process.execPath(exe 위치) 기준으로 chromium 폴더를 탐색한다
;(function setupChromiumPath() {
  // 이미 환경변수가 설정되어 있으면 그대로 사용
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return

  const exeDir = dirname(process.execPath)   // exe가 놓인 실제 폴더
  const candidates = [
    join(exeDir, 'chromium'),                // 배포 패키지 내 chromium 폴더
    join(exeDir, '..', 'chromium'),
    join(homedir(), '.cache', 'ms-playwright'),   // 로컬 npm install 경로
    join(homedir(), 'AppData', 'Local', 'ms-playwright'),  // Windows npm
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = p
      console.log('[Chromium] 경로 자동 설정:', p)
      return
    }
  }
  // 못 찾아도 Playwright 내장 탐색에 맡김 (개발 환경)
})()

// ── --install-chromium 플래그: Chromium만 설치하고 종료 ─
if (process.argv.includes('--install-chromium')) {
  const { execSync } = require('child_process')
  const exeDir = dirname(process.execPath)
  const targetPath = join(exeDir, 'chromium')
  process.env.PLAYWRIGHT_BROWSERS_PATH = targetPath
  console.log('Chromium 설치 중...', targetPath)
  try {
    execSync('npx playwright install chromium', {
      stdio: 'inherit',
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: targetPath }
    })
    console.log('✅ Chromium 설치 완료!')
  } catch(e) {
    console.error('❌ Chromium 설치 실패:', e.message)
    process.exit(1)
  }
  process.exit(0)
}

// ── 코어덤프 비활성화 (디스크 낭비 방지) ──────────────
try { process.setrlimit('core', { soft: 0, hard: 0 }) } catch(_) {}

// ── 전역 예외 핸들러 (서버가 크래시로 죽지 않도록) ────
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] 처리되지 않은 예외 (서버 계속 실행):', err.message)
})
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] 처리되지 않은 Promise 거부 (서버 계속 실행):', reason?.message || reason)
})

const multer = require('multer')

// multer(busboy)는 파일명을 latin1로 해석 — 한글 UTF-8 복원 (v5.3)
function fixUploadName(name) {
  try {
    const decoded = Buffer.from(String(name || ''), 'latin1').toString('utf8')
    // 복원 결과에 한글이 생기거나, 원본에 깨진 라틴 확장문자가 있으면 복원본 채택
    if (/[가-힣]/.test(decoded) && !/[가-힣]/.test(name)) return decoded
    if (!/[\u00c0-\u00ff]/.test(name)) return name
    return decoded.includes('\ufffd') ? name : decoded
  } catch (_) { return name }
}


// multer: 메모리에 파일 보관 (각 파일 최대 5MB, 전체 500파일)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 500 },
  fileFilter: (req, file, cb) => {
    if (/\.(html?|jsp|asp|php)$/i.test(file.originalname)) cb(null, true)
    else cb(null, false)
  }
})

// ── PKG exe/일반 실행 공통: 실제 파일 루트 경로 결정 ──
// pkg로 빌드된 exe: process.pkg 가 존재 → exe 옆 폴더를 실제 루트로 사용
// 일반 node 실행: __dirname 사용
const APP_ROOT = process.pkg
  ? dirname(process.execPath)   // exe가 있는 폴더 (data/, public/ 등이 나란히 위치)
  : __dirname

// ── 버전 상수 ─────────────────────────────────────────
const APP_VERSION = '6.23.0'

// ═══════════════════════════════════════════════════════════
//  axe-core 규칙 한국어 번역 테이블 (help / description)
// ═══════════════════════════════════════════════════════════
const AXE_KO = {
  'area-alt': ['이미지맵 <area> 요소에 대체 텍스트가 필요합니다', '<map> 내의 <area> 요소에 대체 텍스트를 제공해야 합니다'],
  'aria-allowed-attr': ['요소의 역할(role)에 허용된 ARIA 속성만 사용해야 합니다', 'ARIA 속성이 해당 요소의 역할에 맞게 사용되었는지 확인하세요'],
  'aria-allowed-role': ['해당 요소에 적합한 ARIA role 값을 사용해야 합니다', 'role 속성 값이 요소에 적절한지 확인하세요'],
  'aria-command-name': ['모든 ARIA 버튼/링크/메뉴항목에 접근 가능한 이름이 필요합니다', 'ARIA command 역할 요소에 이름을 제공하세요'],
  'aria-conditional-attr': ['ARIA 속성은 해당 역할에 맞는 조건에서만 사용해야 합니다', '요소의 역할에 따라 허용되는 ARIA 속성인지 확인하세요'],
  'aria-deprecated-role': ['더 이상 사용되지 않는(deprecated) ARIA role은 사용하지 않아야 합니다', '폐기된 role 값을 최신 값으로 교체하세요'],
  'aria-dialog-name': ['ARIA dialog/alertdialog에 접근 가능한 이름이 필요합니다', '대화상자에 aria-label 또는 aria-labelledby로 이름을 제공하세요'],
  'aria-hidden-body': ['<body>에 aria-hidden="true"를 사용하면 안 됩니다', '문서 본문 전체를 보조기기에서 숨기면 안 됩니다'],
  'aria-hidden-focus': ['aria-hidden 요소는 초점을 받을 수 없어야 합니다', 'aria-hidden="true" 요소 안에 초점 가능한 요소가 없어야 합니다'],
  'aria-input-field-name': ['ARIA 입력 필드에 접근 가능한 이름이 필요합니다', 'ARIA 입력 필드에 레이블을 제공하세요'],
  'aria-meter-name': ['ARIA meter 요소에 접근 가능한 이름이 필요합니다', 'meter 역할 요소에 이름을 제공하세요'],
  'aria-progressbar-name': ['ARIA progressbar 요소에 접근 가능한 이름이 필요합니다', '진행 표시줄에 이름을 제공하세요'],
  'aria-prohibited-attr': ['해당 역할에서 금지된 ARIA 속성은 사용할 수 없습니다', '요소의 역할에서 금지된 ARIA 속성을 제거하세요'],
  'aria-required-attr': ['ARIA role에 필수인 속성을 모두 제공해야 합니다', '해당 role에 필요한 필수 ARIA 속성을 추가하세요'],
  'aria-required-children': ['ARIA role에 필수인 자식 요소를 포함해야 합니다', '해당 role이 요구하는 자식 role 요소를 포함하세요'],
  'aria-required-parent': ['ARIA role에 필수인 부모 요소 안에 있어야 합니다', '해당 role이 요구하는 부모 role 요소 안에 배치하세요'],
  'aria-roles': ['유효한 ARIA role 값을 사용해야 합니다', 'role 속성에 유효한 값을 사용하세요'],
  'aria-text': ['role="text" 요소 안에 초점 가능한 자손이 없어야 합니다', 'text 역할 요소 내부에 초점 가능한 요소를 두지 마세요'],
  'aria-toggle-field-name': ['ARIA 토글 필드에 접근 가능한 이름이 필요합니다', '체크박스/스위치 등 토글 필드에 레이블을 제공하세요'],
  'aria-tooltip-name': ['ARIA tooltip 요소에 접근 가능한 이름이 필요합니다', '툴팁에 이름을 제공하세요'],
  'aria-valid-attr': ['유효한 ARIA 속성명을 사용해야 합니다', '철자가 틀리거나 존재하지 않는 ARIA 속성을 수정하세요'],
  'aria-valid-attr-value': ['ARIA 속성에 유효한 값을 사용해야 합니다', 'ARIA 속성 값이 올바른 형식인지 확인하세요'],
  'audio-caption': ['<audio> 요소에 자막(캡션)을 제공해야 합니다', '음성 콘텐츠에 자막 트랙을 제공하세요'],
  'autocomplete-valid': ['autocomplete 속성에 유효한 값을 사용해야 합니다', 'autocomplete 속성 값이 올바른지 확인하세요'],
  'blink': ['<blink> 요소는 사용하면 안 됩니다', '깜빡이는 텍스트 요소를 제거하세요'],
  'button-name': ['버튼에 인식 가능한 텍스트(이름)가 필요합니다', '버튼에 텍스트 또는 aria-label로 이름을 제공하세요'],
  'bypass': ['반복 영역을 건너뛸 수 있는 수단을 제공해야 합니다', '본문 바로가기 링크 등 건너뛰기 수단을 제공하세요'],
  'color-contrast': ['전경색과 배경색의 명도 대비가 충분해야 합니다 (4.5:1 이상)', '텍스트와 배경의 색상 대비를 WCAG AA 기준 이상으로 높이세요'],
  'color-contrast-enhanced': ['전경색과 배경색의 명도 대비가 AAA 기준(7:1)을 충족해야 합니다', '텍스트와 배경의 색상 대비를 WCAG AAA 기준 이상으로 높이세요'],
  'definition-list': ['<dl>은 올바른 순서의 <dt>/<dd> 그룹만 포함해야 합니다', '정의 목록 구조를 올바르게 작성하세요'],
  'dlitem': ['<dt>/<dd> 요소는 <dl> 안에 있어야 합니다', '정의 항목을 <dl> 요소로 감싸세요'],
  'document-title': ['문서에 비어있지 않은 <title> 요소가 필요합니다', '페이지를 설명하는 제목을 <title>에 제공하세요'],
  'duplicate-id-aria': ['id 속성 값은 고유해야 합니다', '중복된 id 값을 고유한 값으로 수정하세요'],
  'duplicate-id-active': ['초점 가능한 요소의 id 값은 고유해야 합니다', '활성 요소의 중복 id를 고유한 값으로 수정하세요'],
  'duplicate-id-aria': ['ARIA 및 레이블에서 참조되는 id 값은 고유해야 합니다', 'ARIA가 참조하는 중복 id를 수정하세요'],
  'empty-heading': ['제목(heading) 요소에 내용이 있어야 합니다', '비어있는 제목 태그에 텍스트를 제공하거나 제거하세요'],
  'empty-table-header': ['표 머리글(th)에 인식 가능한 텍스트가 있어야 합니다', '비어있는 표 머리글에 텍스트를 제공하세요'],
  'form-field-multiple-labels': ['폼 필드에 레이블이 여러 개 연결되면 안 됩니다', '하나의 입력 필드에는 하나의 레이블만 연결하세요'],
  'frame-focusable-content': ['초점 가능한 콘텐츠가 있는 프레임에 tabindex="-1"을 쓰면 안 됩니다', '프레임의 tabindex 설정을 확인하세요'],
  'frame-tested': ['프레임 내부도 axe-core로 검사되어야 합니다', '프레임 내부 콘텐츠 검사 여부를 확인하세요'],
  'frame-title': ['<frame>/<iframe> 요소에 title 속성(제목)이 필요합니다', '프레임의 용도를 설명하는 title을 제공하세요'],
  'frame-title-unique': ['프레임의 title은 고유해야 합니다', '서로 다른 프레임에 중복되지 않는 제목을 제공하세요'],
  'heading-order': ['제목(h1~h6) 레벨은 순차적으로 증가해야 합니다', '제목 레벨을 건너뛰지 않고 순서대로 사용하세요'],
  'html-has-lang': ['<html> 요소에 lang 속성이 필요합니다', '페이지 기본 언어를 <html lang="ko">처럼 명시하세요'],
  'html-lang-valid': ['<html> lang 속성에 유효한 언어 코드를 사용해야 합니다', 'lang 속성 값이 올바른 언어 코드인지 확인하세요'],
  'html-xml-lang-mismatch': ['lang과 xml:lang 속성의 기본 언어가 일치해야 합니다', '두 언어 속성 값을 동일하게 맞추세요'],
  'identical-links-same-purpose': ['같은 이름의 링크는 같은 목적을 가져야 합니다', '동일한 텍스트의 링크가 서로 다른 곳으로 연결되지 않게 하세요'],
  'image-alt': ['이미지에 대체 텍스트(alt)가 필요합니다', '<img>에 alt 속성으로 대체 텍스트를 제공하거나 장식용이면 role="presentation"을 사용하세요'],
  'image-redundant-alt': ['이미지 대체 텍스트가 주변 텍스트와 중복되면 안 됩니다', '인접 텍스트와 동일한 alt를 수정하세요'],
  'input-button-name': ['입력 버튼에 인식 가능한 텍스트가 필요합니다', '<input type="button">에 value 등으로 이름을 제공하세요'],
  'input-image-alt': ['이미지 버튼(<input type="image">)에 대체 텍스트가 필요합니다', '이미지 버튼에 alt 속성을 제공하세요'],
  'label': ['폼 요소에 레이블이 필요합니다', '<label> 요소 또는 aria-label로 입력 필드의 용도를 제공하세요'],
  'label-content-name-mismatch': ['보이는 레이블 텍스트가 접근 가능한 이름에 포함되어야 합니다', '화면에 보이는 텍스트와 접근 가능한 이름을 일치시키세요'],
  'label-title-only': ['폼 요소는 화면에 보이는 레이블을 제공해야 합니다', 'title이나 숨김 레이블만으로 레이블을 대신하지 말고 보이는 <label>을 제공하세요'],
  'landmark-banner-is-top-level': ['배너 랜드마크는 다른 랜드마크 안에 포함되면 안 됩니다', '<header>(banner)를 최상위 레벨에 배치하세요'],
  'landmark-complementary-is-top-level': ['보조(aside) 랜드마크는 최상위 레벨에 있어야 합니다', '<aside>를 다른 랜드마크 밖에 배치하세요'],
  'landmark-contentinfo-is-top-level': ['콘텐츠 정보(footer) 랜드마크는 최상위 레벨에 있어야 합니다', '<footer>(contentinfo)를 최상위 레벨에 배치하세요'],
  'landmark-main-is-top-level': ['main 랜드마크는 최상위 레벨에 있어야 합니다', '<main>을 다른 랜드마크 밖에 배치하세요'],
  'landmark-no-duplicate-banner': ['문서에는 배너 랜드마크가 1개만 있어야 합니다', '중복된 <header>(banner) 랜드마크를 정리하세요'],
  'landmark-no-duplicate-contentinfo': ['문서에는 콘텐츠 정보 랜드마크가 1개만 있어야 합니다', '중복된 <footer>(contentinfo) 랜드마크를 정리하세요'],
  'landmark-no-duplicate-main': ['문서에는 main 랜드마크가 1개만 있어야 합니다', '중복된 <main> 랜드마크를 정리하세요'],
  'landmark-one-main': ['문서에는 main 랜드마크가 1개 있어야 합니다', '주요 콘텐츠 영역을 <main>으로 표시하세요'],
  'landmark-unique': ['랜드마크는 고유한 역할 또는 역할/레이블 조합을 가져야 합니다', '같은 역할의 랜드마크가 여러 개면 aria-label로 구분하세요'],
  'link-in-text-block': ['본문 속 링크는 색상 외의 방법으로도 구별되어야 합니다', '링크에 밑줄 등 색상 이외의 구별 수단을 제공하세요'],
  'link-name': ['링크에 인식 가능한 텍스트(이름)가 필요합니다', '링크에 텍스트 또는 aria-label로 이름을 제공하세요'],
  'list': ['<ul>과 <ol>은 <li>, <script>, <template> 요소만 직접 포함해야 합니다', '목록 안의 잘못된 직접 자식 요소를 <li>로 감싸세요'],
  'listitem': ['<li> 요소는 <ul>/<ol>/<menu> 안에 있어야 합니다', '목록 항목을 올바른 목록 요소로 감싸세요'],
  'marquee': ['<marquee> 요소는 사용하면 안 됩니다', '흐르는 텍스트 요소를 제거하세요'],
  'meta-refresh': ['meta refresh로 지연 자동 새로고침을 사용하면 안 됩니다', '<meta http-equiv="refresh">의 자동 새로고침/이동을 제거하세요'],
  'meta-viewport': ['viewport 메타에서 확대/축소를 비활성화하면 안 됩니다', 'user-scalable=no, maximum-scale=1 설정을 제거하세요'],
  'meta-viewport-large': ['사용자가 500%까지 확대할 수 있어야 합니다', 'viewport 설정에서 충분한 확대를 허용하세요'],
  'nested-interactive': ['상호작용 요소 안에 다른 상호작용 요소를 중첩하면 안 됩니다', '버튼 안의 링크 등 중첩된 인터랙티브 요소를 분리하세요'],
  'no-autoplay-audio': ['오디오가 3초 이상 자동 재생되면 안 됩니다', '자동 재생 오디오에 정지 수단을 제공하거나 제거하세요'],
  'object-alt': ['<object> 요소에 대체 텍스트가 필요합니다', '<object>에 대체 콘텐츠를 제공하세요'],
  'p-as-heading': ['스타일만으로 <p>를 제목처럼 사용하면 안 됩니다', '굵게/크게 스타일한 문단 대신 제목 태그(h1~h6)를 사용하세요'],
  'page-has-heading-one': ['페이지에 h1(레벨 1 제목)이 있어야 합니다', '페이지 주제를 나타내는 <h1>을 제공하세요'],
  'presentation-role-conflict': ['presentation/none 역할 요소에 ARIA 속성이나 tabindex를 쓰면 안 됩니다', '장식용으로 지정한 요소의 충돌 속성을 제거하세요'],
  'region': ['모든 페이지 콘텐츠는 랜드마크 안에 포함되어야 합니다', '콘텐츠를 header/nav/main/footer 등 랜드마크로 감싸세요'],
  'role-img-alt': ['role="img" 요소에 대체 텍스트가 필요합니다', 'img 역할 요소에 aria-label 등으로 대체 텍스트를 제공하세요'],
  'scope-attr-valid': ['scope 속성은 표 머리글에서 올바르게 사용해야 합니다', '<th>의 scope 속성 값을 확인하세요'],
  'scrollable-region-focusable': ['스크롤 가능한 영역은 키보드로 접근할 수 있어야 합니다', '스크롤 영역에 tabindex="0" 등 키보드 접근 수단을 제공하세요'],
  'select-name': ['<select> 요소에 접근 가능한 이름이 필요합니다', '선택 목록에 레이블을 제공하세요'],
  'server-side-image-map': ['서버 사이드 이미지맵은 사용하면 안 됩니다', '클라이언트 사이드 이미지맵으로 교체하세요'],
  'skip-link': ['건너뛰기 링크의 대상이 존재하고 초점 가능해야 합니다', '건너뛰기 링크가 가리키는 대상 요소를 확인하세요'],
  'svg-img-alt': ['이미지 역할의 SVG에 대체 텍스트가 필요합니다', 'SVG에 <title> 또는 aria-label로 대체 텍스트를 제공하세요'],
  'tabindex': ['tabindex 값으로 0보다 큰 값을 사용하지 않아야 합니다', '양수 tabindex를 제거하고 자연스러운 초점 순서를 사용하세요'],
  'table-duplicate-name': ['표의 caption과 summary가 동일하면 안 됩니다', '표 제목과 요약을 다르게 작성하세요'],
  'table-fake-caption': ['표 제목은 데이터 셀이 아닌 <caption>으로 제공해야 합니다', '표 첫 행 대신 <caption> 요소를 사용하세요'],
  'target-size': ['터치 대상 크기가 충분해야 합니다 (24x24px 이상)', '버튼/링크 등의 터치 영역을 충분히 크게 만드세요'],
  'td-has-header': ['큰 표의 데이터 셀(td)에는 머리글이 연결되어야 합니다', '데이터 셀에 대응하는 표 머리글을 제공하세요'],
  'td-headers-attr': ['td의 headers 속성은 같은 표의 th를 참조해야 합니다', 'headers 속성이 올바른 머리글 id를 참조하는지 확인하세요'],
  'th-has-data-cells': ['표 머리글(th)에는 설명하는 데이터 셀이 있어야 합니다', '머리글에 대응하는 데이터 셀을 제공하세요'],
  'valid-lang': ['lang 속성에 유효한 언어 코드를 사용해야 합니다', '부분 콘텐츠의 lang 값이 올바른지 확인하세요'],
  'video-caption': ['<video> 요소에 자막(캡션)이 필요합니다', '동영상에 <track kind="captions">로 자막을 제공하세요'],
  'focus-trap': ['키보드 초점이 특정 영역에 갇히면 안 됩니다', '키보드만으로 모든 영역을 빠져나갈 수 있게 하세요'],
  'accesskeys': ['accesskey 속성 값은 고유해야 합니다', '중복된 accesskey 값을 수정하세요'],
  'hidden-content': ['숨겨진 콘텐츠도 검사가 필요할 수 있습니다', '표시/숨김 전환 콘텐츠의 접근성을 확인하세요'],
  'avoid-inline-spacing': ['인라인 스타일의 글자 간격은 사용자 조정이 가능해야 합니다', '!important로 고정된 텍스트 간격 스타일을 제거하세요'],
  'css-orientation-lock': ['콘텐츠가 특정 화면 방향으로 잠겨있으면 안 됩니다', '가로/세로 방향 모두에서 사용 가능하게 하세요'],
  'focus-order-semantics': ['초점 순서에 포함된 요소는 적절한 역할이 필요합니다', '초점 가능한 요소에 적절한 role을 제공하세요'],
}

// 번역 적용 헬퍼: [한국어 help, 한국어 description] 반환 (없으면 원문)
function koAxe(id, help, description) {
  const t = AXE_KO[id]
  if (!t) return { help, description, helpEn: null }
  return { help: t[0], description: t[1], helpEn: help }
}
// ═══════════════════════════════════════════════════════════
//  W3C Nu Validator 메시지 한국어 번역 (패턴 기반)
//  매칭되지 않는 메시지는 영문 원문 유지
// ═══════════════════════════════════════════════════════════
const W3C_KO_PATTERNS = [
  [/^Element “(.+?)” not allowed as child of element “(.+?)” in this context\.?.*$/s, '요소 "$1"은(는) 이 위치에서 "$2" 요소의 자식으로 허용되지 않습니다.'],
  [/^Element “(.+?)” not allowed as child of element “(.+?)”\.?$/, '요소 "$1"은(는) "$2" 요소의 자식으로 허용되지 않습니다.'],
  [/^Duplicate ID “(.+?)”\.?$/, 'ID "$1"이(가) 중복되었습니다.'],
  [/^The first occurrence of ID “(.+?)” was here\.?$/, 'ID "$1"이(가) 처음 사용된 위치입니다.'],
  [/^Attribute “(.+?)” not allowed on element “(.+?)” at this point\.?$/, '속성 "$1"은(는) "$2" 요소에서 허용되지 않습니다.'],
  [/^Attribute “(.+?)” is not serializable as XML 1\.0\.?$/, '속성 "$1"은(는) XML 1.0으로 직렬화할 수 없습니다.'],
  [/^Stray end tag “(.+?)”\.?$/, '짝이 맞지 않는 닫는 태그 "$1"이(가) 있습니다.'],
  [/^Stray start tag “(.+?)”\.?$/, '짝이 맞지 않는 여는 태그 "$1"이(가) 있습니다.'],
  [/^Stray doctype\.?$/, '잘못된 위치의 doctype 선언이 있습니다.'],
  [/^Unclosed element “(.+?)”\.?$/, '닫히지 않은 요소 "$1"이(가) 있습니다.'],
  [/^An “img” element must have an “alt” attribute.*$/s, '"img" 요소에는 "alt" 속성(대체 텍스트)이 필요합니다.'],
  [/^Bad value “(.*?)” for attribute “(.+?)” on element “(.+?)”[:.]?\s*(.*)$/s, '"$3" 요소의 "$2" 속성 값 "$1"이(가) 올바르지 않습니다. $4'],
  [/^Bad value “(.*?)” for the attribute “(.+?)”\.?$/, '"$2" 속성 값 "$1"이(가) 올바르지 않습니다.'],
  [/^The “(.+?)” attribute on the “(.+?)” element is obsolete\.?\s*(.*)$/s, '"$2" 요소의 "$1" 속성은 더 이상 사용되지 않습니다. $3'],
  [/^The “(.+?)” attribute is obsolete\.?\s*(.*)$/s, '"$1" 속성은 더 이상 사용되지 않습니다(obsolete). $2'],
  [/^The “(.+?)” element is obsolete\.?\s*(.*)$/s, '"$1" 요소는 더 이상 사용되지 않습니다(obsolete). $2'],
  [/^Section lacks heading\..*$/s, '섹션(section)에 제목(h2~h6)이 없습니다.'],
  [/^Article lacks heading\..*$/s, '아티클(article)에 제목(h2~h6)이 없습니다.'],
  [/^Empty heading\.?$/, '비어있는 제목(heading) 요소입니다.'],
  [/^No space between attributes\.?$/, '속성 사이에 공백이 없습니다.'],
  [/^End tag “(.+?)” seen, but there were open elements\.?$/, '닫는 태그 "$1"이(가) 나왔지만 아직 닫히지 않은 요소가 있습니다.'],
  [/^End tag “(.+?)” violates nesting rules\.?$/, '닫는 태그 "$1"이(가) 요소 중첩 규칙을 위반합니다.'],
  [/^End tag “(.+?)” implied, but there were open elements\.?$/, '닫는 태그 "$1"이(가) 생략되었지만 아직 닫히지 않은 요소가 있습니다.'],
  [/^Self-closing syntax \(“\/>”\) used on a non-void HTML element.*$/s, '내용을 가질 수 있는 HTML 요소에 자기닫음 문법("/>")이 사용되었습니다.'],
  [/^Element “(.+?)” is missing required attribute “(.+?)”\.?$/, '"$1" 요소에 필수 속성 "$2"이(가) 없습니다.'],
  [/^Element “(.+?)” is missing one or more of the following attributes: (.+?)\.?$/, '"$1" 요소에 다음 속성 중 하나 이상이 필요합니다: $2'],
  [/^Element “(.+?)” is missing a required instance of child element “(.+?)”\.?$/, '"$1" 요소에 필수 자식 요소 "$2"이(가) 없습니다.'],
  [/^A document must not include more than one “(.+?)” element\.?$/, '문서에는 "$1" 요소가 1개만 있어야 합니다.'],
  [/^A document must not include both a “(.+?)” element and a “(.+?)” element\.?$/, '문서에 "$1" 요소와 "$2" 요소를 함께 사용할 수 없습니다.'],
  [/^Start tag “(.+?)” seen but an element of the same type was already open\.?$/, '"$1" 시작 태그가 나왔지만 같은 종류의 요소가 이미 열려 있습니다.'],
  [/^Start tag “(.+?)” seen in “(.+?)”\.?$/, '"$2" 안에 "$1" 시작 태그가 있습니다.'],
  [/^Saw “(.+?)” when expecting an attribute name\..*$/s, '속성 이름이 와야 할 자리에 "$1"이(가) 있습니다.'],
  [/^Quote “(.+?)” in attribute name\..*$/s, '속성 이름에 따옴표("$1")가 포함되어 있습니다.'],
  [/^The “type” attribute is unnecessary for JavaScript resources\.?$/, 'JavaScript 리소스에는 "type" 속성이 필요하지 않습니다.'],
  [/^The “charset” attribute on the “(.+?)” element is obsolete\.?\s*(.*)$/s, '"$1" 요소의 "charset" 속성은 더 이상 사용되지 않습니다. $2'],
  [/^A table row was (\d+) columns wide, which is less than the column count established by the first row \((\d+)\)\.?$/, '표의 행이 $1개 열로, 첫 행에서 정한 열 수($2개)보다 적습니다.'],
  [/^A table row was (\d+) columns wide and exceeded the column count established by the first row \((\d+)\)\.?$/, '표의 행이 $1개 열로, 첫 행에서 정한 열 수($2개)를 초과했습니다.'],
  [/^Table column (\d+) established by element “(.+?)” has no cells beginning in it\.?$/, '"$2" 요소로 만들어진 표의 $1번째 열에 시작하는 셀이 없습니다.'],
  [/^Table columns in range (.+?) established by element “(.+?)” have no cells beginning in them\.?$/, '"$2" 요소로 만들어진 표의 $1 범위 열에 시작하는 셀이 없습니다.'],
  [/^Row (\d+) of a row group established by a “(.+?)” element has no cells beginning on it\.?$/, '"$2" 요소 행 그룹의 $1번째 행에 시작하는 셀이 없습니다.'],
  [/^The “for” attribute of the “label” element must refer to a non-hidden form control\.?$/, '"label" 요소의 "for" 속성은 숨겨지지 않은 폼 컨트롤을 참조해야 합니다.'],
  [/^Any “(.+?)” descendant of a “(.+?)” element must not have an? “(.+?)” attribute\.?$/, '"$2" 요소의 자손 "$1" 요소에는 "$3" 속성을 사용할 수 없습니다.'],
  [/^Possible misuse of “aria-label”\..*$/s, '"aria-label" 속성이 잘못 사용되었을 수 있습니다.'],
  [/^The “aria-(.+?)” attribute must not be used on an? “(.+?)” element.*$/s, '"aria-$1" 속성은 "$2" 요소에 사용할 수 없습니다.'],
  [/^Text not allowed in element “(.+?)” in this context\.?$/, '"$1" 요소 안에는 이 위치에서 텍스트가 허용되지 않습니다.'],
  [/^Legacy encoding “(.+?)” used.*$/s, '오래된 인코딩 "$1"이(가) 사용되었습니다. UTF-8을 권장합니다.'],
  [/^Internal encoding declaration “(.+?)” disagrees with the actual encoding of the document(?:\s*\(“(.+?)”\))?\.?$/, '문서에 선언된 인코딩("$1")이 실제 인코딩과 일치하지 않습니다.'],
  [/^This document appears to be written in (.+?)[\.,].*“html” start tag has “?lang="?(.+?)"?”?.*$/s, '문서 내용은 $1(으)로 작성된 것으로 보이지만 html 태그의 lang 속성이 "$2"입니다.'],
  [/^Consider adding a “lang” attribute to the “html” start tag.*$/s, 'html 시작 태그에 "lang" 속성을 추가하는 것을 고려하세요 (예: lang="ko").'],
  [/^Consider avoiding viewport values that prevent users from resizing documents\.?$/, '사용자의 화면 확대/축소를 막는 viewport 설정은 피하는 것이 좋습니다.'],
  [/^Element “(.+?)” does not need a “role” attribute\.?$/, '"$1" 요소에는 "role" 속성이 필요하지 않습니다.'],
  [/^The “(.+?)” role is unnecessary for element “(.+?)”\.?$/, '"$2" 요소에는 "$1" 역할(role) 지정이 불필요합니다(기본 역할과 동일).'],
  [/^Bad character “(.+?)” after “(.+?)”\..*$/s, '"$2" 다음에 잘못된 문자 "$1"이(가) 있습니다.'],
  [/^Forbidden code point U\+(.+?)\.?$/, '사용할 수 없는 문자 코드(U+$1)가 포함되어 있습니다.'],
  [/^Almost standards mode doctype\..*$/s, '비표준에 가까운 doctype입니다. "<!DOCTYPE html>"을 권장합니다.'],
  [/^Obsolete doctype\..*$/s, '오래된 doctype 선언입니다. "<!DOCTYPE html>"을 권장합니다.'],
  [/^Non-space characters found without seeing a doctype first\..*$/s, 'doctype 선언 전에 공백이 아닌 문자가 있습니다.'],
  [/^Element “(.+?)” must not be empty\.?$/, '"$1" 요소는 비어 있으면 안 됩니다.'],
  [/^The element “(.+?)” must not appear as a descendant of the “(.+?)” element\.?$/, '"$1" 요소는 "$2" 요소의 자손으로 사용할 수 없습니다.'],
  [/^An “(.+?)” element must have an? “(.+?)” attribute\.?$/, '"$1" 요소에는 "$2" 속성이 필요합니다.'],
  [/^CSS: “(.+?)”: (.+?)\.?$/s, 'CSS 오류 — "$1": $2'],
  [/^CSS: (.+?)\.?$/s, 'CSS 오류 — $1'],
]

function koW3C(message) {
  if (!message) return { message, messageEn: null }
  for (const [re, tpl] of W3C_KO_PATTERNS) {
    const m = message.match(re)
    if (m) {
      let out = tpl
      for (let g = 1; g < m.length; g++) {
        out = out.split('$' + g).join(m[g] !== undefined ? m[g] : '')
      }
      return { message: out.trim(), messageEn: message }
    }
  }
  return { message, messageEn: null }
}




// ── KRDS 규칙 JSON 로더 (외부 파일 우선, 없으면 내장 규칙) ──
let KRDS_RULES = []
;(function loadKrdsRules() {
  const rulePaths = [
    join(APP_ROOT, 'krds-rules.json'),
    join(__dirname, 'krds-rules.json'),
  ]
  for (const p of rulePaths) {
    if (existsSync(p)) {
      try {
        const raw = readFileSync(p, 'utf8')
        const parsed = JSON.parse(raw)
        KRDS_RULES = (parsed.rules || []).filter(r => r.enabled !== false)
        console.log(`[KRDS] 규칙 파일 로드: ${p} (${KRDS_RULES.length}개 규칙)`)
        return
      } catch (e) {
        console.warn('[KRDS] 규칙 파일 파싱 오류, 내장 규칙 사용:', e.message)
      }
    }
  }
  console.log('[KRDS] 규칙 파일 없음 - 내장 규칙 사용')
})()

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' }))
// ── 인터넷 배포(공개 서비스) 모드 — GUARDIANS_PUBLIC=1
//    · 내부망·사설 IP 주소 검사 차단(SSRF 방지)  · 접근 비밀번호(GUARDIANS_PASSWORD)  · AI 키는 서버에 저장하지 않고 요청 헤더로만 받음
const PUBLIC_MODE = process.env.GUARDIANS_PUBLIC === '1'
const ACCESS_PW = process.env.GUARDIANS_PASSWORD || ''
if (PUBLIC_MODE) {
  console.log('[공개 모드] 인터넷 배포 설정: 내부망 주소 차단 · ' + (ACCESS_PW ? '접근 비밀번호 사용' : '비밀번호 없음(주의)'))
  // 접근 제어: 자체 로그인 페이지(쿠키) + Basic 인증 둘 다 허용 (기업 브라우저가 Basic 팝업을 막는 경우 대비)
  const crypto = require('crypto')
  const SESSION_SECRET = crypto.createHash('sha256').update('guardians:' + ACCESS_PW).digest('hex')
  const sessionToken = () => crypto.createHmac('sha256', SESSION_SECRET).update('ok').digest('hex')
  const parseCookies = h => Object.fromEntries(String(h || '').split(';').map(s => s.trim().split('=')).filter(a => a[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]))
  const LOGIN_HTML = (err) => `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>가디언즈 — 로그인</title>
<link rel="stylesheet" href="/lib/pretendard.css"><style>body{margin:0;font-family:"Pretendard Variable",Pretendard,-apple-system,"Malgun Gothic",sans-serif;background:#fff;color:#222;display:flex;min-height:100vh;align-items:center;justify-content:center}
.box{width:min(400px,92vw);padding:40px 36px;border:1px solid #ebebeb;border-radius:16px}h1{font-size:26px;font-weight:800;letter-spacing:-.03em;margin:0 0 4px}h1 small{font-size:13px;font-weight:400;color:#8c8c8c;margin-left:8px}
p{font-size:13px;color:#8c8c8c;margin:0 0 26px}label{display:block;font-size:13px;color:#8c8c8c;margin:14px 0 6px}input{width:100%;height:48px;padding:0 14px;border:1px solid #ebebeb;border-radius:10px;font:inherit;font-size:16px;box-sizing:border-box}input:focus{outline:none;border-color:#222}
button{width:100%;height:52px;margin-top:22px;border:0;border-radius:10px;background:#222;color:#fff;font:inherit;font-size:16px;font-weight:600;cursor:pointer}.err{color:#ef6253;font-size:13px;margin-top:12px}.foot{font-size:12px;color:#8c8c8c;margin-top:22px}</style></head>
<body><form class="box" method="post" action="/login"><h1>가디언즈<small>웹 품질 검사</small></h1><p>팀 접근 비밀번호를 입력하세요.</p>
<label for="pw">접근 비밀번호</label><input id="pw" name="pw" type="password" autocomplete="current-password" autofocus required>
<button type="submit">들어가기</button>${err ? `<div class="err">${err}</div>` : ''}<div class="foot">(주)솔리데오 · 공공 IT · 정부24</div></form></body></html>`
  if (ACCESS_PW) {
    app.get('/login', (req, res) => res.type('html').send(LOGIN_HTML(req.query.e ? '비밀번호가 맞지 않습니다.' : '')))
    app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
      const pw = String((req.body || {}).pw || '')
      if (pw !== ACCESS_PW) return res.redirect('/login?e=1')
      res.set('Set-Cookie', `gsess=${sessionToken()}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`)
      res.redirect('/')
    })
    app.get('/logout', (req, res) => { res.set('Set-Cookie', 'gsess=; Path=/; Max-Age=0'); res.redirect('/login') })
    app.use((req, res, next) => {
      if (req.path === '/healthz' || req.path === '/login' || req.path.startsWith('/lib/')) return next()
      const ck = parseCookies(req.headers.cookie)
      if (ck.gsess && ck.gsess === sessionToken()) return next()
      const h = req.headers.authorization || ''
      if (h.startsWith('Basic ') && Buffer.from(h.slice(6), 'base64').toString().split(':').slice(1).join(':') === ACCESS_PW) return next()
      if (req.path.startsWith('/api/')) return res.status(401).json({ error: '로그인이 필요합니다' })
      res.redirect('/login')
    })
  }
  // 검사 대상 URL 필터 (localhost·사설망·메타데이터 주소 차단)
  const BLOCK = u => { try { const h = new URL(u).hostname.toLowerCase(); return h === 'localhost' || /^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^169\.254\.|^0\.|^\[?::1\]?$|^fc|^fd|^fe80|^metadata|\.internal$|\.local$/.test(h) || !h.includes('.') } catch (_) { return true } }
  // 로그인 없이 공개할 때의 보호: IP당 동시 검사 1건 · 시간당 30건 (서버 2GB 보호)
  const RL = new Map()
  app.use((req, res, next) => {
    if (process.env.GUARDIANS_RATELIMIT !== '1' || ACCESS_PW || req.method !== 'POST' || !/^\/api\/(scan|krds-scan|security-scan|compat-scan|reader|batch|sitescan|crawl)/.test(req.path)) return next()   // 기본 꺼짐 (팀 전용 웹)
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim(); const now = Date.now()
    const r = RL.get(ip) || { active: 0, times: [] }; r.times = r.times.filter(t => now - t < 3600e3)
    if (r.active >= 1) return res.status(429).json({ error: '같은 접속에서 검사가 진행 중입니다. 끝난 뒤 다시 시도해 주세요.' })
    if (r.times.length >= 30) return res.status(429).json({ error: '시간당 검사 한도(30건)에 도달했습니다. 잠시 후 다시 시도하거나 설치형을 사용해 주세요.' })
    r.active++; r.times.push(now); RL.set(ip, r)
    const done = () => { r.active = Math.max(0, r.active - 1) }; res.on('finish', done); res.on('close', done)
    next()
  })
  app.use((req, res, next) => {
    if (req.method !== 'POST' || !/^\/api\/(scan|krds-scan|security-scan|compat-scan|reader|batch|sitescan|crawl|schedules)/.test(req.path)) return next()
    const cand = [req.body?.url, ...(Array.isArray(req.body?.urls) ? req.body.urls : [])].filter(Boolean)
    const bad = cand.find(u => { const full = /^https?:\/\//i.test(u) ? u : 'https://' + u; try { if (new URL(full).pathname === '/selftest.html') return false } catch (_) {} return BLOCK(full) })   // 자가 진단 페이지는 허용
    if (bad) return res.status(403).json({ error: '공개 서비스에서는 내부망·사설 IP 주소를 검사할 수 없습니다: ' + String(bad).slice(0, 80) })
    next()
  })
}
// ── 다운로드 센터: downloads/ 폴더의 설치 파일을 목록·제공 (업데이트 때 폴더만 바꾸면 페이지가 따라감)
const DL_DIR = require('path').join(APP_ROOT, 'downloads')
const DL_KINDS = [
  { key: 'update', re: /^Guardians-Update-v[\d.]+-\d{8}\.exe$/i, name: '업데이트 파일 (설치형 · 행정망)', desc: '이미 설치한 가디언즈를 최신으로. 더블클릭하면 설치 폴더를 찾아 프로그램 · 크롬 확장 · KRDS 기준만 바꾸고 검사 기록 · 설정은 그대로 둡니다. 어느 6.x 버전이든 이 파일 하나로 최신이 됩니다', how: '행정망은 인터넷 PC에서 받아 USB로 옮긴 뒤 실행 · 크롬 확장을 쓰면 끝난 뒤 크롬을 다시 켜기' },
  { key: 'exe', re: /^Guardians-Setup-v[\d.]+\.exe$/i, name: 'Windows 설치 프로그램', desc: '더블클릭 → 다음 → 설치. 관리자 권한 불필요, 검사용 브라우저·확장·예약 검사 포함, 인터넷 없이 실행', how: '처음 실행 시 "Windows의 PC 보호" 창이 뜨면 [추가 정보] → [실행]' },
  { key: 'zip', re: /^Guardians-v[\d.]+\.zip$/i, name: '설치 없이 쓰는 ZIP판', desc: '압축을 풀고 START.bat 실행. 검사용 브라우저 포함(폐쇄망 가능)', how: 'ZIP 우클릭 → 속성 → [차단 해제] → 압축 풀기' },
  { key: 'ext', re: /^Guardians-Chrome-Extension-v[\d.]+\.zip$/i, name: 'Chrome 확장 (사이드 패널)', desc: '보고 있는 페이지를 브라우저 옆 패널에서 즉시 검사. 항목을 누르면 요소로 이동', how: 'chrome://extensions → 개발자 모드 켜기 → 압축 푼 폴더를 끌어다 놓기 → 퍼즐 아이콘에서 고정' },
  { key: 'server', re: /^Guardians-v[\d.]+-server\.zip$/i, name: '서버 배포용 소스', desc: '웹 서비스로 띄울 때 쓰는 소스(Docker). 일반 이용자는 필요 없음', how: 'deploy/README-인터넷배포.md 참고' },
]
app.get('/api/downloads', (req, res) => {
  const fs = require('fs'); let files = []
  try { files = fs.readdirSync(DL_DIR).filter(f => !f.startsWith('.')).map(f => { const st = fs.statSync(require('path').join(DL_DIR, f)); return { file: f, size: st.size, mtime: st.mtime.toISOString() } }) } catch (_) {}
  const items = DL_KINDS.map(k => { const m = files.filter(f => k.re.test(f.file)).sort((a, b) => b.mtime.localeCompare(a.mtime))[0]; return { key: k.key, name: k.name, desc: k.desc, how: k.how, file: m ? m.file : null, size: m ? m.size : null, mtime: m ? m.mtime : null, url: m ? '/downloads/' + encodeURIComponent(m.file) : null, version: m ? (((m.file.match(/v(\d+(?:\.\d+)*)/) || [])[1]) || null) : null } })
  const extras = files.filter(f => /\.(pptx|pdf|mp4|docx|xlsx|md|txt|png|jpg)$/i.test(f.file) && !DL_KINDS.some(k => k.re.test(f.file))).sort((a, b) => b.mtime.localeCompare(a.mtime)).map(f => ({ file: f.file, size: f.size, mtime: f.mtime, url: '/downloads/' + encodeURIComponent(f.file), kind: (f.file.match(/\.(\w+)$/) || [])[1].toLowerCase(), label: (([['Guardians-QnA','해커톤 Q&A 대비 자료'],['Guardians-98-Criteria','98개 기준 산정 설명 (숫자의 뜻 · 실제 검사 범위)'],['Guardians-Feature-Demo','가디언즈 기능 시연 영상'],['Guardians-User-Manual','가디언즈 사용설명서 (전 기능 · 용어 사전 · 문제 해결)'],['Guardians-Deck','해커톤 발표 덱 (최종 · 영상 포함)'],['Guardians-Presentation-Guide','해커톤 발표 가이드 (시나리오·체크리스트·Q&A)'],['Guardians-Opening-30s','오프닝 영상 30초 (실화면 녹화)'],['Guardians-Intro-Clip','발표 오프닝 영상 (방송 클립)']].find(([k]) => f.file.startsWith(k + '-') || f.file.startsWith(k + '.')) || [])[1] || null) }))
  res.json({ version: APP_VERSION, public: PUBLIC_MODE, web: process.env.GUARDIANS_WEB_URL || null, items, extras })
})
app.use('/downloads', express.static(DL_DIR, { dotfiles: 'ignore', index: false, setHeaders: res => res.set('Cache-Control', 'no-cache') }))
// ── 결과서 자가 점검: PPTX 엔진이 이 배포본에서 실제로 동작하는지 (시연 전 확인용)
app.get('/api/report/selfcheck', async (req, res) => {
  const out = { pptxgenjs: false, exceljs: false, node: process.version, platform: process.platform, generate: false, error: null }
  try { require.resolve('pptxgenjs'); out.pptxgenjs = true } catch (e) { out.error = 'pptxgenjs 모듈 없음' }
  try { require.resolve('exceljs'); out.exceljs = true } catch (e) { out.error = (out.error ? out.error + ' · ' : '') + 'exceljs 모듈 없음' }
  try {
    const buf = await generatePptxReport([{ url: 'https://selfcheck.local/', pageTitle: '자가 점검', violations: [], passes: [], summary: { score: 100 }, screenshot: null }], { project: '자가 점검' })
    out.generate = !!(buf && buf.length > 10000 && buf.slice(0, 2).toString() === 'PK'); out.bytes = buf ? buf.length : 0
  } catch (e) { out.error = (out.error ? out.error + ' · ' : '') + e.message.slice(0, 200) }
  res.json(out)
})
app.get('/healthz', (req, res) => res.json({ ok: true, version: APP_VERSION, public: PUBLIC_MODE }))
// ── 공개 운영판: 광고(애드센스) — 기본 꺼짐. GUARDIANS_ADS=1 + GUARDIANS_ADSENSE_CLIENT 가 있어야 켜짐 (설치형·행정망에는 표시 안 함)
const ADS = { on: PUBLIC_MODE && process.env.GUARDIANS_ADS === '1' && /^ca-pub-\d{10,}$/.test(process.env.GUARDIANS_ADSENSE_CLIENT || ''),
  client: process.env.GUARDIANS_ADSENSE_CLIENT || '', slotFooter: process.env.GUARDIANS_ADSENSE_SLOT_FOOTER || '', slotSide: process.env.GUARDIANS_ADSENSE_SLOT_SIDE || '', auto: process.env.GUARDIANS_ADSENSE_AUTO === '1' }
app.get('/api/ads', (req, res) => res.json(ADS.on ? { on: true, client: ADS.client, slotFooter: ADS.slotFooter, slotSide: ADS.slotSide, auto: ADS.auto } : { on: false }))
app.get('/ads.txt', (req, res) => { if (!ADS.on) return res.status(404).type('text/plain').send(''); res.type('text/plain').send(`google.com, ${ADS.client.replace('ca-', '')}, DIRECT, f08c47fec0942fa0\n`) })
// ── 공개 운영판: 응원하기(후원) — 기본 꺼짐. GUARDIANS_SUPPORT=1 + GUARDIANS_SUPPORT_URL(카카오페이 송금 링크)이 있어야 켜짐. 설치형에는 표시 안 함
const SUPPORT_ON = PUBLIC_MODE && process.env.GUARDIANS_SUPPORT === '1' && /^https:\/\//.test(process.env.GUARDIANS_SUPPORT_URL || '')
const STATS_FILE = join(APP_ROOT, 'data', 'stats.json'), SUPPORT_FILE = join(APP_ROOT, 'data', 'support.json'), SUPPORT_QR = join(APP_ROOT, 'data', 'support-qr.png')
const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
let STATS = {}; try { STATS = JSON.parse(readFileSync(STATS_FILE, 'utf8')) } catch (_) {}
let statsTimer = null
app.use((req, res, next) => {   // 오늘 검사 수 (검사 요청이 성공했을 때만 1 증가)
  if (req.method === 'POST' && /^\/api\/(scan|krds-scan|compat-scan|reader|batch|sitescan)\b/.test(req.path)) res.on('finish', () => { if (res.statusCode < 400) { const d = kstDay(); STATS[d] = (STATS[d] || 0) + 1
    for (const k of Object.keys(STATS)) if (k < new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 10)) delete STATS[k]
    clearTimeout(statsTimer); statsTimer = setTimeout(() => { try { mkdirSync(join(APP_ROOT, 'data'), { recursive: true }); writeFileSync(STATS_FILE, JSON.stringify(STATS)) } catch (_) {} }, 2000) } })
  next()
})
app.get('/api/support', (req, res) => {
  if (!SUPPORT_ON) return res.json({ on: false })
  let cfg = {}; try { cfg = JSON.parse(readFileSync(SUPPORT_FILE, 'utf8')) } catch (_) {}
  const goal = +cfg.goal || +process.env.GUARDIANS_SUPPORT_GOAL || 0, raised = +cfg.raised || 0
  res.json({ on: true, url: process.env.GUARDIANS_SUPPORT_URL, owner: cfg.owner || process.env.GUARDIANS_SUPPORT_OWNER || '', goal, raised, pct: goal ? Math.min(100, Math.round(raised / goal * 100)) : null, month: cfg.month || '', today: STATS[kstDay()] || 0, qr: existsSync(SUPPORT_QR) })
})
app.get('/api/support/qr', (req, res) => SUPPORT_ON && existsSync(SUPPORT_QR) ? res.sendFile(SUPPORT_QR) : res.status(404).end())
// ── 변경분 받기 (관리자 토큰) — Claude 작업 환경 → 서버 data/incoming → 서버 cron이 GitHub에 커밋 · 푸시 · 반영 (사이트 중단 없음)
// ── 다운로드 파일 올리기 (관리자) — 업데이트 파일 · 설치 파일처럼 Git에 넣지 않는 큰 파일
app.post('/api/admin/download-file', express.raw({ type: '*/*', limit: '250mb' }), (req, res) => {
  const t = process.env.GUARDIANS_ADMIN_TOKEN; if (!t || req.headers['x-admin-token'] !== t) return res.status(403).json({ error: '관리자만' })
  const name = String(req.query.name || ''); if (!/^Guardians-[\w.-]+\.(exe|zip)$/.test(name) || !req.body || !req.body.length) return res.status(400).json({ error: '파일 이름 또는 내용이 올바르지 않습니다' })
  try { const f = join(DL_DIR, name); if (req.query.append === '1') require('fs').appendFileSync(f, req.body); else writeFileSync(f, req.body); res.json({ ok: true, name, bytes: require('fs').statSync(f).size }) } catch (e) { res.status(500).json({ error: e.message }) }   // 큰 파일은 조각으로 이어 붙임(append=1)
})
app.post('/api/admin/incoming', express.raw({ type: '*/*', limit: '30mb' }), (req, res) => {
  const t = process.env.GUARDIANS_ADMIN_TOKEN; if (!t || req.headers['x-admin-token'] !== t) return res.status(403).json({ error: '관리자만' })
  const name = String(req.query.name || '').replace(/[^\w.-]/g, ''); if (!/\.zip$/.test(name) || !req.body || !req.body.length) return res.status(400).json({ error: 'zip 파일이 필요합니다' })
  const msg = Buffer.from(String(req.headers['x-commit-msg'] || ''), 'base64').toString('utf8').slice(0, 500) || '변경분 반영'
  const dir = join(APP_ROOT, 'data', 'incoming'); mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name + '.msg'), msg); writeFileSync(join(dir, name), req.body)
  res.json({ ok: true, name, bytes: req.body.length, note: '1분 안에 서버가 GitHub에 커밋하고 반영합니다' })
})
app.get('/api/admin/incoming/status', (req, res) => {
  const t = process.env.GUARDIANS_ADMIN_TOKEN; if (!t || req.headers['x-admin-token'] !== t) return res.status(403).json({ error: '관리자만' })
  let log = ''; try { log = readFileSync(join(APP_ROOT, 'data', 'incoming', 'last.log'), 'utf8').slice(-1500) } catch (_) {}
  res.json({ version: APP_VERSION, log })
})
// ── 베타(새 디자인) — 기존 화면을 그대로 쓰되 A5 공통 디자인을 덧칠해 /beta/ 아래에서 보여 줌 (기존 주소는 영향 없음)
app.get(['/beta', '/beta/', '/beta/:page'], (req, res, next) => {
  if (req.path === '/beta') return res.redirect(301, '/beta/')
  const p = String(req.params.page || 'index.html'); if (!/^[a-z0-9-]+\.html$/.test(p)) return next()
  const f = join(APP_ROOT, 'public', p); if (!existsSync(f)) return next()
  let h = readFileSync(f, 'utf8'); h = h.replace('</head>', '<link rel="stylesheet" href="/beta/a5.css"><script src="/beta/beta.js" defer></script></head>')
  res.set('Cache-Control', 'no-cache').type('html').send(h)
})
app.use(express.static(join(APP_ROOT, 'public')))

// axe-core 소스 서버 시작 시 1회만 로드 (캐싱 → 매 스캔 I/O 제거)
// pkg 내부 스냅샷(__dirname)에서는 axe.min.js가 번들에 포함되어 있으므로 __dirname 사용
const AXE_SOURCE = readFileSync(join(__dirname, 'node_modules/axe-core/axe.min.js'), 'utf8')

// ─────────────────────────────────────────────────────
// 브라우저 풀 (배치 스캔에서 매번 launch/close 하지 않고 재사용)
// ─────────────────────────────────────────────────────
// ⚠️ RAM 987MB 환경: 브라우저 1개당 150~200MB → 풀 3개가 최대 안전치
// 브라우저 3개 × 200MB = 600MB + Node.js 150MB = 750MB (< 987MB 한계)
const BROWSER_POOL_SIZE = 3       // 동시 유지 브라우저 수 (메모리 제한으로 3개)
const BATCH_CONCURRENCY = 3       // 배치 동시 처리 수 (메모리 제한으로 3개)
const BROWSER_MAX_USES  = 30      // 재사용 횟수 초과 시 교체 (메모리 누수 방지)
const MAX_EVIDENCE_STORE = 5000   // evidenceStore 최대 보관 수 (메모리 제한)

class BrowserPool {
  constructor(size = BROWSER_POOL_SIZE) {
    this.size = size
    this.pool = []    // { browser, uses, busy }
    this.queue = []   // 대기 Promise resolve 목록
  }

  async _launch() {
    const browser = await chromium.launch({
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-gpu', '--disable-extensions', '--disable-background-networking',
        '--disable-default-apps', '--disable-sync', '--disable-translate',
        '--hide-scrollbars', '--metrics-recording-only', '--mute-audio',
        '--no-first-run', '--safebrowsing-disable-auto-update',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-software-rasterizer', '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection', '--disable-hang-monitor',
        '--disable-prompt-on-repost', '--disable-domain-reliability',
        '--disable-component-update', '--disable-client-side-phishing-detection',
        '--js-flags=--max-old-space-size=128'   // 브라우저당 JS 힙 제한 128MB
      ]
    })
    return { browser, uses: 0, busy: false }
  }

  async acquire() {
    // 빈 슬롯 찾기
    let slot = this.pool.find(s => !s.busy)
    if (!slot && this.pool.length < this.size) {
      slot = await this._launch()
      this.pool.push(slot)
    }
    if (slot) {
      slot.busy = true
      return slot
    }
    // 모두 사용 중 → 대기
    return new Promise(resolve => this.queue.push(resolve))
  }

  async release(slot) {
    slot.uses++
    slot.busy = false
    // 과다 사용 슬롯은 교체
    if (slot.uses >= BROWSER_MAX_USES) {
      const idx = this.pool.indexOf(slot)
      if (idx !== -1) {
        this.pool.splice(idx, 1)
        slot.browser.close().catch(() => {})
      }
    }
    // 대기 중인 요청 처리
    if (this.queue.length > 0) {
      const next = this.queue.shift()
      const newSlot = await this._launch().catch(async () => {
        // 런칭 실패 시 기존 슬롯 하나를 강제 해제
        const free = this.pool.find(s => !s.busy)
        if (free) { free.busy = true; return free }
        return null
      })
      if (newSlot) {
        this.pool.push(newSlot)
        newSlot.busy = true
        next(newSlot)
      }
    }
  }

  async closeAll() {
    await Promise.allSettled(this.pool.map(s => s.browser.close()))
    this.pool = []
  }
}

const browserPool = new BrowserPool()
// 서버 종료 시 정리
process.on('SIGTERM', () => browserPool.closeAll())
process.on('SIGINT',  () => browserPool.closeAll())

// ─── 유틸 함수 ────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function normalizeUrl(url, base) {
  try {
    if (!url || url.startsWith('mailto:') || url.startsWith('tel:') || url.startsWith('javascript:') || url.startsWith('#') || url.startsWith('data:')) return null
    return new URL(url, base).href
  } catch {
    return null
  }
}

// ─── 한글 오탈자 검사 (Daum 맞춤법 검사기 기반) ────────
// Playwright로 dic.daum.net/grammar_checker.do 에 접근하여 검사
// errorType 코드: spell(철자), spacing(띄어쓰기), ambiguous(문맥), stat(통계)
const DAUM_ERROR_TYPE_LABEL = {
  spell:     '철자 오류',
  spacing:   '띄어쓰기',
  ambiguous: '문맥 오류',
  stat:      '통계적 교정',
  unknown:   '기타 오류',
}

// 텍스트에서 오탈자 위치(줄번호, 근사 컬럼)를 찾는 헬퍼
function findTokenPosition(fullText, token, context) {
  // context 기반으로 위치 탐색
  const ctxIdx = context ? fullText.indexOf(context.trim().substring(0, 30)) : -1
  const searchFrom = ctxIdx >= 0 ? ctxIdx : 0
  const idx = fullText.indexOf(token, searchFrom)
  if (idx === -1) return { line: null, col: null }
  const before = fullText.substring(0, idx)
  const lines = before.split('\n')
  return {
    line: lines.length,
    col: lines[lines.length - 1].length + 1
  }
}

// HTML 소스에서 노드 outerHTML의 줄번호를 근사 계산
function findHtmlLineNumber(nodeHtml, htmlLines) {
  if (!nodeHtml || !htmlLines) return null
  const snippet = nodeHtml.replace(/\s+/g, ' ').trim().substring(0, 160)
  const tagMatch = snippet.match(/^<(\w[\w-]*)/)
  if (!tagMatch) return null
  const tag = tagMatch[1].toLowerCase()
  // 고유 식별 속성 우선 탐색
  const idM    = snippet.match(/\bid=["']([^"']+)["']/)
  const srcM   = snippet.match(/\bsrc=["']([^"']{4,100})["']/)
  const hrefM  = snippet.match(/\bhref=["']([^"']{4,100})["']/)
  const forM   = snippet.match(/\bfor=["']([^"']+)["']/)
  const nameM  = snippet.match(/\bname=["']([^"']+)["']/)
  const ariaM  = snippet.match(/\baria-label=["']([^"']{3,60})["']/)
  const altM   = snippet.match(/\balt=["']([^"']{3,60})["']/)
  const roleM  = snippet.match(/\brole=["']([^"']+)["']/)
  const searches = []
  if (idM)   searches.push(`id="${idM[1]}"`, `id='${idM[1]}'`)
  if (srcM)  { const f = srcM[1].split('/').pop().substring(0,50); if (f.length>3) searches.push(f) }
  if (hrefM) { const f = hrefM[1].split('/').pop().substring(0,50); if (f.length>3) searches.push(f) }
  if (forM)  searches.push(`for="${forM[1]}"`, `for='${forM[1]}'`)
  if (nameM) searches.push(`name="${nameM[1]}"`)
  if (ariaM) searches.push(ariaM[1].substring(0,40))
  if (altM)  searches.push(altM[1].substring(0,40))
  if (roleM) searches.push(`role="${roleM[1]}"`)
  searches.push(`<${tag}`)          // 태그명 폴백
  for (const s of searches) {
    if (!s || s.length < 2) continue
    for (let li = 0; li < htmlLines.length; li++) {
      if (htmlLines[li].includes(s)) return li + 1
    }
  }
  return null
}

// Daum 맞춤법 검사기 호출 (별도 페이지 사용 - 원본 페이지 DOM 보존)
async function checkDaumSpelling(textChunks, pageUrl, browser) {
  // ── 폐쇄망: 인터넷 불가면 내장 규칙 엔진으로 즉시 대체
  try {
    const net = await OFFLINE.netStatus()
    if (!net.online) {
      const r = OFFLINE.spellOffline((textChunks || []).map(ch => (ch && ch.text) || ch || '').join('\n'))
      const arr = r.issues; arr.engine = 'builtin'; arr.engineNote = r.engineNote; arr.total = r.totalIssues
      return arr
    }
  } catch (_) {}
  // textChunks: 청크별 { text, lineOffset } 배열
  // browser: Playwright 브라우저 인스턴스 (별도 페이지 생성)
  const allIssues = []
  let daumPage = null

  try {
    // 별도 페이지 생성으로 원본 DOM 보존
    daumPage = await browser.newPage()
    await daumPage.setViewportSize({ width: 1280, height: 800 })

    // Daum 맞춤법 검사기 페이지 로드 (이미지/폰트 차단 → 빠른 로드)
    await daumPage.route('**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2,ttf,eot}', r => r.abort())
    await daumPage.goto('https://dic.daum.net/grammar_checker.do', {
      waitUntil: 'domcontentloaded', timeout: 20000
    })
    await daumPage.waitForSelector('#tfSpelling', { timeout: 10000 })
    await daumPage.waitForTimeout(100)

    for (const chunk of textChunks) {
      const { text, lineOffset = 0 } = chunk
      if (!text || text.trim().length < 2) continue

      try {
        // 텍스트 입력 (기존 내용 지우고 새 텍스트 입력)
        await daumPage.waitForSelector('#tfSpelling', { timeout: 8000 })
        await daumPage.fill('#tfSpelling', '')
        await daumPage.fill('#tfSpelling', text)

        // 검사 버튼 클릭
        await daumPage.waitForSelector('#btnCheck', { timeout: 8000 })
        await daumPage.click('#btnCheck')

        // 결과 대기: resultForm 또는 오류메시지 표시될 때까지
        try {
          await daumPage.waitForSelector('#resultForm', { timeout: 10000 })
        } catch {
          // resultForm도 없으면 스킵
          continue
        }
        await daumPage.waitForTimeout(100)

        // 오류 파싱
        const errors = await daumPage.evaluate(() => {
          const results = []
          document.querySelectorAll('a[data-error-type]').forEach(el => {
            results.push({
              token:      el.getAttribute('data-error-input')  || '',
              suggestion: el.getAttribute('data-error-output') || '',
              type:       el.getAttribute('data-error-type')   || 'unknown',
              context:    el.getAttribute('data-error-context')|| '',
              help:       el.getAttribute('data-error-help')   || '',
            })
          })
          return results
        })

        // 위치 정보 추가
        for (const err of errors) {
          if (!err.token) continue
          const pos = findTokenPosition(text, err.token, err.context)
          allIssues.push({
            word:       err.token,
            suggestion: err.suggestion,
            context:    err.context,
            desc:       DAUM_ERROR_TYPE_LABEL[err.type] || DAUM_ERROR_TYPE_LABEL.unknown,
            type:       err.type,
            help:       err.help,
            pageUrl:    pageUrl || '',
            line:       pos.line !== null ? pos.line + lineOffset : null,
            col:        pos.col,
            engine:     'daum',
          })
        }

      } catch (e) {
        console.error('[Daum 맞춤법] 청크 오류:', e.message)
      }
    }
  } catch (e) {
    // Daum 접속 실패 → 내장 규칙으로 대체
    try {
      const r = OFFLINE.spellOffline((textChunks || []).map(ch => (ch && ch.text) || ch || '').join('\n'))
      const arr = r.issues; arr.engine = 'builtin'; arr.engineNote = 'Daum 맞춤법 접속 실패 → ' + r.engineNote; arr.total = r.totalIssues
      return arr
    } catch (_) {}
    console.error('[Daum 맞춤법] 페이지 초기화 오류:', e.message)
  } finally {
    if (daumPage) await daumPage.close().catch(() => {})
  }

  return allIssues
}

// 영문 오탈자 검사 제거 (한국어 전용)

// ─── 데드링크 검사 ────────────────────────────────────
async function checkDeadLinks(links, baseUrl, page) {
  // 동일 도메인 우선, 외부 링크는 최대 15개로 제한 (속도 최적화)
  const baseDomain = new URL(baseUrl).hostname
  const internalLinks = links.filter(l => { try { return new URL(l).hostname === baseDomain } catch { return false } }).slice(0, 30)
  const externalLinks = links.filter(l => { try { return new URL(l).hostname !== baseDomain } catch { return false } }).slice(0, 15)
  const allLinks = [...new Set([...internalLinks, ...externalLinks])].slice(0, 45)

  // 단일 링크 HEAD→GET 검사
  async function checkOne(link) {
    let status = null, ok = false, redirectUrl = null, error = null
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 4000)   // 7초→4초 단축
      const resp = await fetch(link, {
        method: 'HEAD', redirect: 'follow', signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (A11y-Inspector/1.0)' }
      })
      clearTimeout(timer)
      status = resp.status
      ok = resp.ok || [301,302,307,308].includes(resp.status)
      if (resp.url !== link) redirectUrl = resp.url
      if (resp.status === 405) {
        const ctrl2 = new AbortController()
        const timer2 = setTimeout(() => ctrl2.abort(), 4000)   // 7초→4초 단축
        const resp2 = await fetch(link, { method: 'GET', redirect: 'follow', signal: ctrl2.signal, headers: { 'User-Agent': 'Mozilla/5.0 (종합검사/2.0)' } })
        clearTimeout(timer2)
        status = resp2.status; ok = resp2.ok
      }
    } catch (e) {
      error = e.name === 'AbortError' ? '연결 시간 초과' : e.message.includes('fetch') ? '연결 실패' : e.message.substring(0, 60)
      ok = false
    }
    return { url: link, status, error, redirectUrl, ok }
  }

  // 병렬 처리 (최대 15개 동시, 10→15)
  const CONCUR = 15
  const results = []
  for (let i = 0; i < allLinks.length; i += CONCUR) {
    const batch = allLinks.slice(i, i + CONCUR)
    const settled = await Promise.allSettled(batch.map(checkOne))
    for (const s of settled) {
      if (s.status === 'fulfilled') results.push(s.value)
      else results.push({ url: batch[results.length % CONCUR], status: null, error: s.reason?.message, ok: false })
    }
  }
  return { results, total: allLinks.length }
}

// ═══════════════════════════════════════════════════════
// ─── 로컬 HTML/JSP 파일 스캔 API ─────────────────────
// ═══════════════════════════════════════════════════════
// FormData: files[] + options(JSON string)
app.post('/api/scan/local', upload.array('files', 500), async (req, res) => {
  const files = req.files
  if (!files || files.length === 0) return res.status(400).json({ error: '파일이 없습니다.' })

  let options = {}
  try { options = JSON.parse(req.body.options || '{}') } catch(e) {}
  const {
    level = 'wcag2aa',
    includeScreenshot = false,
    checkSpelling = false,
    checkLinks = false,
    checkW3C = false,
    checkKRDS: doCheckKRDS = false,
    excludeCommon = false,   // 컨테이너만 검사 (헤더/푸터/네비 제외)
    scanMode = 'professional',
  } = options

  // 임시 디렉토리에 파일 저장
  const tmpDir = join(tmpdir(), 'scan_local_' + randomBytes(6).toString('hex'))
  mkdirSync(tmpDir, { recursive: true })

  const tmpFiles = []
  for (const f of files) {
    const fixedName = fixUploadName(f.originalname)
    const safeName = fixedName.replace(/[^a-zA-Z0-9가-힣._-]/g, '_')
    const tmpPath = join(tmpDir, safeName)
    writeFileSync(tmpPath, f.buffer)
    tmpFiles.push({ path: tmpPath, name: fixedName })
  }

  // 파일을 file:// URL로 변환하여 병렬 스캔 (최대 BATCH_CONCURRENCY 동시)
  const results = []
  const CONCUR = Math.min(BATCH_CONCURRENCY, 5)
  
  try {
    const queue = tmpFiles.map((f, i) => ({ ...f, idx: i }))
    const workers = Array.from({ length: CONCUR }, async () => {
      while (queue.length > 0) {
        const item = queue.shift()
        if (!item) break
        // Windows: C:\path → file:///C:/path 로 변환
        const normalPath = item.path.replace(/\\/g, '/')
        const fileUrl = normalPath.startsWith('/') ? `file://${normalPath}` : `file:///${normalPath}`
        const result = await scanSinglePage(fileUrl, {
          level, includeScreenshot, checkSpelling, checkLinks,
          useW3CLinks: false, checkW3C, checkKRDS: doCheckKRDS, scanMode
        })
        result.fileName = item.name
        result.originalUrl = fileUrl
        result.url = item.name   // 파일명을 URL 대신 표시
        result.pageTitle = result.pageTitle || item.name
        results[item.idx] = result
      }
    })
    await Promise.allSettled(workers)
  } finally {
    // 임시 파일 정리
    for (const f of tmpFiles) { try { unlinkSync(f.path) } catch(e){} }
    try { require('fs').rmdirSync(tmpDir) } catch(e){}
  }

  // 배치 세션 생성 → PPTX/Excel/HTML 보고서 버튼과 연결 (v5.3)
  const okResults = results.filter(Boolean)
  const sessionId = 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
  const localSession = {
    id: sessionId, type: 'local', status: 'completed',
    total: okResults.length,
    completed: okResults.filter(r => r.status !== 'error').length,
    failed: okResults.filter(r => r.status === 'error').length,
    startedAt: new Date().toISOString(),
    results: [], screenshots: {},
  }
  okResults.forEach(r => {
    if (r && r.id) {
      addEvidence(r.id, r)
      if (r.screenshot) localSession.screenshots[r.id] = r.screenshot
    }
    localSession.results.push(typeof lightResult === 'function' ? lightResult(r) : r)
  })
  batchSessions.set(sessionId, localSession)
  console.log(`[로컬 검사] 세션 생성: ${sessionId} (${okResults.length}건 — PPTX/보고서 연결)`)

  res.json({ results: okResults, total: results.length, sessionId })
})

// ═══════════════════════════════════════════════════════
// ─── 메인 통합 검사 API ───────────────────────────────
// ═══════════════════════════════════════════════════════
app.post('/api/scan', async (req, res) => {
  const {
    url,
    level = 'wcag2aa',
    includeScreenshot = true,
    checkSpelling = false,    // 기본: WCAG만 (옵션 선택 시 활성화)
    checkLinks = false,       // 기본: 비활성 (옵션 선택 시 활성화)
    useW3CLinks = false,    // W3C Link Checker 사용 여부
    checkW3C = false,
    checkKRDS: doCheckKRDS = false,  // KRDS 준수 검사 여부
    excludeCommon = false,           // 컨테이너만 검사 (헤더/푸터/네비 제외)
    scanMode = 'professional',       // 'simple'(간편) | 'professional'(전문가)
    // ── 로그인 지원: 쿠키 & 커스텀 헤더 ──────────────
    cookies = [],             // [{ name, value, domain, path }] 형태
    extraHeaders = {},        // { 'Authorization': 'Bearer ...' } 형태
  } = req.body

  if (!url) return res.status(400).json({ error: 'URL이 필요합니다.' })

  // https:// 없으면 자동 보완
  if (!url.startsWith('http')) req.body.url = 'https://' + url

  let normalizedUrl = url
  if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    normalizedUrl = 'https://' + normalizedUrl
  }

  let browser
  try {
    browser = await chromium.launch({
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
        '--disable-extensions', '--disable-default-apps', '--disable-sync', '--disable-translate',
        '--mute-audio', '--no-first-run', '--disable-background-networking',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        '--disable-software-rasterizer', '--disable-ipc-flooding-protection',
        '--disable-hang-monitor', '--disable-domain-reliability',
        '--disable-component-update', '--disable-client-side-phishing-detection',
        '--js-flags=--max-old-space-size=128'
      ]
    })
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1280, height: 900 })

    // 불필요 리소스 차단 → 로드 속도 대폭 향상
    if (!includeScreenshot) {
      await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2,ttf,eot,mp4,mp3,pdf,flv,avi,mov,swf}', r => r.abort())
      await page.route('**/{gtag,analytics,ga,fbq,hotjar,clarity,matomo,pixel,beacon,telemetry}*', r => r.abort())
    } else {
      await page.route('**/*.{woff,woff2,ttf,eot,mp4,mp3,pdf,flv,avi,mov,swf}', r => r.abort())
    }
    // 광고/트래킹 도메인 차단 (공통)
    await page.route('**/{doubleclick,googlesyndication,adservice,adsystem,moatads,scorecardresearch,quantserve,chartbeat}**', r => r.abort())

    // ── 간편 로그인 세션 쿠키 자동 주입 (v4.5) ──────
    if (typeof loginSession !== 'undefined' && loginSession && loginSession.storageState && loginSession.storageState.cookies.length) {
      try {
        await page.context().addCookies(loginSession.storageState.cookies)
        console.log(`[로그인] 세션 쿠키 ${loginSession.storageState.cookies.length}개 적용`)
      } catch(e) { console.warn('[로그인] 쿠키 적용 실패:', e.message) }
    }
    // ── 로그인 지원: 쿠키 & 커스텀 헤더 설정 ─────────
    if (cookies && cookies.length > 0) {
      const cookieList = cookies.map(c => ({
        name: String(c.name || ''),
        value: String(c.value || ''),
        domain: c.domain || new URL(normalizedUrl).hostname,
        path: c.path || '/',
        httpOnly: c.httpOnly || false,
        secure: c.secure || normalizedUrl.startsWith('https'),
      })).filter(c => c.name && c.value)
      if (cookieList.length > 0) await page.context().addCookies(cookieList)
    }
    if (extraHeaders && Object.keys(extraHeaders).length > 0) {
      await page.setExtraHTTPHeaders(extraHeaders)
    }

    await page.goto(normalizedUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })

    // 타이틀/URL 안전 취득 (리다이렉션·context 파괴 대응)
    let pageTitle = ''
    let pageUrl = normalizedUrl
    try {
      pageTitle = await page.title()
      try { pageUrl = decodeURIComponent(page.url()) } catch(_) { pageUrl = page.url() }
    } catch (e) {
      pageUrl = normalizedUrl
    }

    // ── 스크린샷 — 렌더링 완료 후 캡처 ───────────────
    let screenshotBase64 = null
    if (includeScreenshot) {
      try {
        // 네트워크 안정화 대기 (최대 3초)
        await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})
        // 로딩 스피너/오버레이 사라질 때까지 추가 대기
        await page.waitForFunction(() => {
          const loaders = document.querySelectorAll(
            '.loading, .loader, .spinner, [class*="loading"], [class*="spinner"], ' +
            '[id*="loading"], [id*="spinner"], .overlay, .dimmed'
          )
          return [...loaders].every(el => {
            const s = window.getComputedStyle(el)
            return s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0'
          })
        }, { timeout: 3000 }).catch(() => {})
        // 최소 500ms 추가 대기 (JS 렌더링 여유)
        await new Promise(r => setTimeout(r, 500))
        const buf = await page.screenshot({ fullPage: false, type: 'png' })
        screenshotBase64 = buf.toString('base64')
      } catch (e) {
        // 스크린샷 실패해도 검사 계속
        console.warn('[스크린샷 실패]', e.message)
      }
    }

    // ── 접근성 검사 (axe-core) ────────────────────────
    // axeSource는 AXE_SOURCE 캐시 사용
    await page.addScriptTag({ content: AXE_SOURCE })
    // ── 검사 모드별 axe 규칙 정의 ──────────────────────────────
    // 간편 모드: 누구나 이해하고 조치할 수 있는 핵심 15개 규칙만
    const SIMPLE_RULES = [
      'image-alt',          // 이미지 대체텍스트
      'input-image-alt',    // 버튼 이미지 대체텍스트
      'button-name',        // 버튼 이름
      'link-name',          // 링크 텍스트
      'label',              // 폼 레이블
      'document-title',     // 페이지 제목
      'html-has-lang',      // 언어 선언
      'color-contrast',     // 색상 대비
      'skip-link',          // 건너뛰기 링크
      'heading-order',      // 제목 순서
      'list',               // 목록 구조
      'frame-title',        // 프레임 제목
      'duplicate-id-aria',       // ID 중복
      'meta-viewport',      // 뷰포트 설정
      'video-caption',      // 동영상 자막
    ]

    const axeResults = await page.evaluate(async ([runLevel, mode, simpleRules, exCommon]) => {
      const opts = { reporter: 'v2' }
      if (mode === 'simple') {
        // 간편 모드: 핵심 15개 규칙만
        opts.runOnly = { type: 'rule', values: simpleRules }
      } else {
        // 전문가 모드: WCAG 레벨 전체
        if (runLevel === 'wcag2a') {
          opts.runOnly = { type: 'tag', values: ['wcag2a', 'best-practice'] }
        } else if (runLevel === 'wcag2aa') {
          opts.runOnly = { type: 'tag', values: ['wcag2a', 'wcag2aa', 'best-practice'] }
        } else if (runLevel === 'wcag2aaa') {
          opts.runOnly = { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag2aaa', 'best-practice'] }
        }
      }
      // 컨테이너만 검사: 공통영역(헤더/푸터/네비) DOM 제외
      const ctx = exCommon
        ? { exclude: [['header'],['footer'],['nav'],['aside'],['[role="banner"]'],['[role="contentinfo"]'],['[role="navigation"]'],['#header'],['#footer'],['#gnb'],['.header'],['.footer'],['.gnb'],['#skip'],['.skip-nav']] }
        : document
      return await window.axe.run(ctx, opts)
    }, [level, scanMode, SIMPLE_RULES, excludeCommon])

    // ── HTML 소스 취득 (줄번호 계산 + W3C 검사 공유) ────
    const htmlSource = await page.content()
    const htmlLines  = htmlSource.split('\n')

    // violations + incomplete(검토필요) 모두 포함
    // ── ④ 신뢰도: 위반 요소의 화면 좌표(뷰포트 기준) 수집 → 스크린샷 하이라이트용
    let rectMap = {}
    try {
      const targets = []
      for (const v of axeResults.violations) for (const n of v.nodes.slice(0, 12)) if (n.target && n.target[0]) targets.push(String(n.target[0]))
      if (targets.length) {
        await page.evaluate(() => window.scrollTo(0, 0))
        rectMap = await page.evaluate((sels) => {
          const out = {}, vw = window.innerWidth, vh = window.innerHeight
          for (const s of sels) {
            try {
              const el = document.querySelector(s)
              if (!el) continue
              const cs = getComputedStyle(el)
              if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) { out[s] = { hidden: true }; continue }
              const r = el.getBoundingClientRect()
              if (!(r.width > 0 && r.height > 0)) { out[s] = { hidden: true }; continue }
              const inView = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw
              const big = (r.width * r.height) > (vw * vh * 0.5)     // 화면 절반 이상을 덮는 구조 요소는 표시 제외
              // 실제로 가장 위에 보이는 요소인지 (팝업에 가려졌는지)
              let covered = false
              try { const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(vh - 1, Math.max(0, r.top + Math.min(r.height / 2, 20)))
                const top = document.elementFromPoint(cx, cy); covered = !!(top && top !== el && !el.contains(top) && !top.contains(el)) } catch (_) {}
              let ctx = ''; try { ctx = (el.parentElement ? el.parentElement.outerHTML : el.outerHTML).replace(/\s+/g, ' ').slice(0, 600) } catch (_) {}
              out[s] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), inView, big, covered, ctx }
            } catch (_) {}
          }
          return out
        }, [...new Set(targets)])
        // 좌표와 같은 순간의 화면을 다시 캡처 (검사 전 캡처와 팝업 상태가 달라지는 문제 방지)
        if (includeScreenshot) {
          try { const buf2 = await page.screenshot({ fullPage: false, type: 'png' }); screenshotBase64 = buf2.toString('base64') } catch (_) {}
        }
      }
    } catch (e) { console.warn('[좌표 수집 실패]', e.message) }
    const vp = page.viewportSize() || { width: 1280, height: 800 }
    const mapNode = (n, ruleId) => ({
      html: n.html,
      suggest: (SUGGEST && ruleId) ? SUGGEST.suggest(ruleId, n.html, (n.any && n.any[0] && n.any[0].data) || null) : null,
      failureSummary: koFailure(n.failureSummary),
      target: n.target,
      line: findHtmlLineNumber(n.html, htmlLines),
      rect: (n.target && n.target[0] && rectMap[String(n.target[0])]) ? (({ ctx, ...r }) => r)(rectMap[String(n.target[0])]) : null,
      ctx: (n.target && n.target[0] && rectMap[String(n.target[0])] && rectMap[String(n.target[0])].ctx) || '',
      pageUrl,
    })
    const violations = axeResults.violations.map(v => {
      const ko = koAxe(v.id, v.help, v.description)
      return {
      id: v.id, impact: v.impact, description: ko.description,
      help: ko.help, helpEn: ko.helpEn, helpUrl: v.helpUrl, tags: v.tags,
      kwcag: RULE_TO_KWCAG[v.id] || null,
      fix: FIXES[v.id] || null,
      pageUrl, resultType: 'violation',
      nodes: v.nodes.map(n => mapNode(n, v.id))
    }})
    const incompleteItems = axeResults.incomplete.map(v => {
      const ko = koAxe(v.id, v.help, v.description)
      return {
      id: v.id, impact: v.impact || 'needs-review', description: ko.description,
      help: ko.help, helpEn: ko.helpEn, helpUrl: v.helpUrl, tags: v.tags,
      pageUrl, resultType: 'incomplete',
      nodes: v.nodes.map(mapNode)
    }})
    const passes = axeResults.passes.length
    const incomplete = axeResults.incomplete.length
    const inapplicable = axeResults.inapplicable.length
    // ── 판정 조정: 읽기 전용(readonly)·비활성(disabled) 입력의 이름/레이블 계열 위반은 '보통'으로 조정 (원래 심각도는 보존·표시)
    //    근거: 값을 편집할 수 없는 표시용 입력은 사용자 조작을 막지 않으므로, 이름 누락의 실제 영향이 편집 가능한 입력보다 낮음. 여전히 위반이며 권장 수정 대상.
    const ADJUST_RULES = new Set(['label', 'label-title-only', 'select-name', 'aria-input-field-name', 'aria-toggle-field-name', 'autocomplete-valid', 'form-field-multiple-labels'])
    const isReadonlyHtml = h => /\s(readonly|disabled)(\s|=|>|\/)/i.test(String(h || ''))
    for (const v of violations) {
      if (!ADJUST_RULES.has(v.id) || !v.nodes || !v.nodes.length) continue
      const ro = v.nodes.filter(n => isReadonlyHtml(n.html)).length
      if (ro === v.nodes.length && ['critical', 'serious'].includes(v.impact)) {
        v.originalImpact = v.impact; v.impact = 'moderate'
        v.adjusted = `읽기 전용·비활성 입력(${ro}개)이라 '${({critical:'치명적',serious:'심각'})[v.originalImpact]}'에서 '보통'으로 조정. 표시용 입력이라 조작을 막지는 않지만 이름은 제공해야 합니다.`
      } else if (ro > 0) {
        v.adjustedNote = `해당 요소 ${v.nodes.length}개 중 ${ro}개는 읽기 전용·비활성 입력 — 편집 가능한 나머지가 우선 수정 대상`
      }
    }
    const impactCounts = { critical: 0, serious: 0, moderate: 0, minor: 0, needsReview: 0 }
    violations.forEach(v => { if (v.impact && v.impact !== 'needs-review') impactCounts[v.impact] = (impactCounts[v.impact] || 0) + 1 })
    impactCounts.needsReview = incomplete
    const allFindings = [...violations, ...incompleteItems]
    // score는 UI에 표시하지 않지만 하위 호환성을 위해 유지
    const _total = violations.length + passes
    const score = _total > 0 ? Math.max(0, 100 - (impactCounts.critical*15 + impactCounts.serious*10 + impactCounts.moderate*5 + impactCounts.minor*2)) : null   // v6.19 산식: 규칙당 고정 벌점, 페이지 크기 무관

    // ── 오탈자 검사 (Daum 맞춤법 검사기) ─────────────────
    let spellingResult = { issues: [], totalWords: 0, checkedAt: new Date().toISOString() }
    if (checkSpelling) {
      // 페이지 텍스트 추출 (줄 단위 배열로) - body null 방지 처리 포함
      const pageLines = await page.evaluate(() => {
        if (!document.body) return []
        // NodeFilter 객체 직렬화 문제 회피: 세 번째 인자 없이 SHOW_TEXT만 사용 후 직접 필터
        const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'code', 'pre'])
        const walker = document.createTreeWalker(document.body, 0x4 /* NodeFilter.SHOW_TEXT */)
        const texts = []
        let n
        while ((n = walker.nextNode())) {
          const tag = n.parentElement?.tagName?.toLowerCase()
          if (SKIP_TAGS.has(tag)) continue
          const t = n.textContent.trim()
          if (t.length > 1) texts.push(t)
        }
        return texts
      })

      const fullText = pageLines.join('\n')
      const wordCount = fullText.split(/\s+/).filter(w => w.length > 0).length

      // Daum 맞춤법 검사기용 청크 분할 (최대 1500자, 최대 5청크)
      const CHUNK_SIZE = 1500
      const MAX_CHUNKS = 5
      const chunks = []
      let lineOffset = 0
      let buf = []
      let bufLen = 0
      for (const line of pageLines) {
        if (bufLen + line.length + 1 > CHUNK_SIZE && buf.length > 0) {
          chunks.push({ text: buf.join('\n'), lineOffset })
          lineOffset += buf.length
          buf = []
          bufLen = 0
          if (chunks.length >= MAX_CHUNKS) break
        }
        buf.push(line)
        bufLen += line.length + 1
      }
      if (buf.length > 0 && chunks.length < MAX_CHUNKS) chunks.push({ text: buf.join('\n'), lineOffset })

      // Daum 맞춤법 검사 수행 → 실패 시 로컬 폴백
      let koIssues = []
      let spellEngine = 'daum'
      let spellError = null
      try {
        koIssues = await checkDaumSpelling(chunks, pageUrl, browser)
      } catch (e) {
        console.warn('[오탈자] Daum 검사 실패, 로컬 폴백 사용:', e.message)
        spellError = e.message
        spellEngine = 'local'
        koIssues = localSpellCheck(fullText)
      }

      if (koIssues && koIssues.engine) { spellEngine = koIssues.engine }
      spellingResult = {
        issues: koIssues.slice(0, 100),
        totalWords: wordCount,
        totalIssues: koIssues.total ?? koIssues.length,
        koreanIssues: koIssues.total ?? koIssues.length,
        engine: spellEngine,
        engineNote: koIssues.engineNote || (spellEngine === 'local' ? '오프라인 모드 (Daum 연결 실패)' : null),
        checkedAt: new Date().toISOString()
      }
    }


    // ── 데드링크 검사 ─────────────────────────────────
    let linkResult = { dead: [], redirects: [], live: 0, total: 0, checkedAt: new Date().toISOString() }
    if (checkLinks) {
      if (useW3CLinks) {
        // ── W3C Link Checker 사용 ─────────────────────
        linkResult = await checkLinksWithW3C(pageUrl)
      } else {
        // ── 내장 HEAD/GET 검사 ─────────────────────────
        const rawLinks = await page.evaluate(() => {
          const links = []
          document.querySelectorAll('a[href], link[href]').forEach(el => {
            const href = el.getAttribute('href')
            const text = el.textContent?.trim().substring(0, 60) || el.tagName
            if (href) links.push({ href, text })
          })
          return links
        })

        const resolvedLinks = rawLinks
          .map(l => ({ ...l, resolved: normalizeUrl(l.href, pageUrl) }))
          .filter(l => l.resolved !== null)

        const uniqueUrls = [...new Set(resolvedLinks.map(l => l.resolved))]
        const linkTextMap = {}
        resolvedLinks.forEach(l => { if (!linkTextMap[l.resolved]) linkTextMap[l.resolved] = l.text })

        const { results, total } = await checkDeadLinks(uniqueUrls, pageUrl, page)

        // ── 폐쇄망: 인터넷 불가면 외부(공인망) 링크는 "확인 불가"로 분리 (데드로 세지 않음)
        const netNow = await OFFLINE.netStatus().catch(() => ({ online: true }))
        const isExt = u => !OFFLINE.isPrivateHost(u) && !(new URL(u).hostname === new URL(pageUrl).hostname)
        const unreachable = netNow.online ? [] : results.filter(r => !r.ok && isExt(r.url)).map(r => ({ ...r, text: linkTextMap[r.url] || '', reason: '폐쇄망 — 외부 링크는 확인 불가' }))
        const unreachSet = new Set(unreachable.map(u => u.url))
        const dead = results.filter(r => !r.ok && !unreachSet.has(r.url)).map(r => ({ ...r, text: linkTextMap[r.url] || '' }))
        const redirects = results.filter(r => r.ok && r.redirectUrl).map(r => ({ ...r, text: linkTextMap[r.url] || '' }))
        const live = results.filter(r => r.ok).length

        linkResult = {
          engine: 'internal',
          dead,
          redirects,
          unreachable,
          live,
          total,
          totalRaw: rawLinks.length,
          network: netNow.online ? 'online' : 'offline',
          checkedAt: new Date().toISOString()
        }
      }
    }

    // ── W3C Markup Validation ─────────────────────────
    let w3cResult = { valid: null, errorCount: 0, warningCount: 0, fatalCount: 0, errors: [], warnings: [] }
    if (checkW3C) {
      // htmlSource는 이미 위에서 취득
      w3cResult = await validateW3C(htmlSource, pageUrl)
    }

    // ── KRDS 준수 검사 ─────────────────────────────────
    let krdsResult = null
    if (doCheckKRDS) {
      try {
        krdsResult = await checkKRDS(page, htmlSource, pageUrl)
        try { await KRDS_DEEP.applyDeep(page, krdsResult) } catch (_) {}
      } catch (e) {
        console.error('[KRDS] 검사 오류:', e.message)
        krdsResult = { error: e.message, score: 0, passed: 0, failed: 0, total: 0, items: [] }
      }
    }

    await browser.close()

    return res.json({
      id: Date.now().toString(),
      scannedAt: new Date().toISOString(),
      url: pageUrl,
      pageTitle,
      level,
      score,
      status: 'completed',
      summary: { violations: violations.length, passes, incomplete, inapplicable, impactCounts },
      violations,
      passes: (axeResults.passes || []).map(p => ({ id: p.id })),
      screenshot: screenshotBase64,
      screenshotViewport: { width: vp.width, height: vp.height },
      scoreConfidence: _total >= 10 ? 'ok' : 'low',
      scoreNote: _total >= 10 ? null : `검사에 적용된 규칙이 ${_total}개뿐입니다(위반 ${violations.length} + 통과 ${passes}). 페이지가 비어 있거나 차단·로그인 화면일 수 있어 점수는 참고만 하세요.`,
      engine: {
        axe: AXE_VERSION, playwright: PW_VERSION, browser: 'Chromium (Playwright)',
        level, mode: scanMode || 'expert', viewport: `${vp.width}×${vp.height}`,
        criteria: 'KWCAG 2.2 (KS X OT0003:2022) · WCAG 2.1', toolVersion: APP_VERSION,
        network: (await OFFLINE.netStatus().catch(() => ({ online: true }))).online ? 'online' : 'offline',
      },
      manualItems: CRITERIA_MANUAL,
      spelling: spellingResult,
      links: linkResult,
      w3c: w3cResult,
      krds: krdsResult
    })

  } catch (err) {
    if (browser) await browser.close().catch(() => {})
    console.error('스캔 오류:', err.message)
    return res.status(500).json({ error: '스캔 중 오류가 발생했습니다: ' + err.message })
  }
})

// ═══════════════════════════════════════════════════════
// ─── HTML 보고서 생성 API ─────────────────────────────
// ═══════════════════════════════════════════════════════
app.post('/api/report', (req, res) => {
  const result = req.body
  if (!result || !result.url) return res.status(400).json({ error: '검사 결과가 필요합니다.' })
  
  // generateReportHtml 함수가 아직 정의되기 전이므로 여기서는 인라인으로 처리
  // (함수는 아래 민원 배치 섹션에 정의됨 - 순서 무관하게 호이스팅 없으므로 인라인 유지)

  const impactColor = { critical: '#ef6253', serious: '#f0a34d', moderate: '#f0a34d', minor: '#41b979' }
  const impactLabel = { critical: '치명적', serious: '심각', moderate: '보통', minor: '경미' }
  const scoreColor = result.score >= 80 ? '#41b979' : result.score >= 50 ? '#f0a34d' : '#ef6253'

  // 접근성 위반 HTML
  const violationsHtml = result.violations.map((v, i) => `
    <div style="border-left:4px solid ${impactColor[v.impact]||'#8c8c8c'};margin-bottom:16px;padding:12px 16px;background:#f4f4f4;border-radius:0 8px 8px 0;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <strong style="font-size:14px;color:#222222;">${i+1}. ${escapeHtml(v.help)}</strong>
        <span style="background:${impactColor[v.impact]||'#8c8c8c'};color:white;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;">${impactLabel[v.impact]||v.impact}</span>
      </div>
      <p style="color:#444444;font-size:12px;margin-bottom:6px;">${escapeHtml(v.description)}</p>
      <div style="font-size:11px;color:#8c8c8c;margin-bottom:6px;"><strong>규칙:</strong> ${v.id} | <a href="${v.helpUrl}" style="color:#222222;">가이드 →</a></div>
      ${v.fix ? `<div style="margin-top:8px;font-size:13px"><b>어떻게:</b> ${v.fix.how}${(v.nodes&&v.nodes[0]&&v.nodes[0].suggest&&v.nodes[0].suggest.after) ? `<pre style="margin:6px 0 0;padding:8px 10px;border-radius:6px;background:#f1faf5;border:1px solid #bfe8d0;font-size:11.5px;white-space:pre-wrap"><b style="color:#41b979">이 요소 맞춤 제안</b>${v.nodes[0].suggest.note ? ' · '+v.nodes[0].suggest.note : ''}\n${v.nodes[0].suggest.after.replace(/</g,'&lt;')}</pre>` : (v.fix.after ? `<pre style="margin:6px 0 0;padding:8px 10px;border-radius:6px;background:#f1faf5;border:1px solid #bfe8d0;font-size:11.5px;white-space:pre-wrap"><b style="color:#41b979">수정 예시</b>\n${v.fix.after.replace(/</g,'&lt;')}</pre>` : '')}</div>` : ''}
      <div style="background:#f4f4f4;border-radius:6px;padding:8px;font-size:11px;">
        ${v.nodes.slice(0,3).map(n=>`<div style="font-family:monospace;background:#ebebeb;padding:3px 6px;border-radius:3px;margin-top:4px;word-break:break-all;">${escapeHtml(n.html)}</div><div style="color:#8c8c8c;margin-top:2px;">${escapeHtml(n.failureSummary||'')}</div>`).join('')}
        ${v.nodes.length>3?`<div style="color:#8c8c8c;margin-top:4px;">... 외 ${v.nodes.length-3}개</div>`:''}
      </div>
    </div>`).join('')

  // 오탈자 HTML
  const sp = result.spelling || {}
  const SPELL_TYPE_LABEL = { spell: '철자 오류', spacing: '띄어쓰기', ambiguous: '문맥 오류', stat: '통계 교정', korean: '한글', unknown: '기타' }
  const SPELL_TYPE_COLOR = { spell: '#ef6253', spacing: '#f0a34d', ambiguous: '#f0a34d', stat: '#222222', korean: '#222222', unknown: '#8c8c8c' }
  const engineLabel = sp.engine === 'daum' ? '다음 맞춤법 검사기' : '규칙 기반'
  const spellingHtml = (sp.issues && sp.issues.length > 0) ? sp.issues.map((issue, i) => {
    const tc = SPELL_TYPE_COLOR[issue.type] || '#222222'
    const tl = SPELL_TYPE_LABEL[issue.type] || '기타'
    const lineInfo = issue.line ? `줄 ${issue.line}${issue.col ? ', 열 '+issue.col : ''}` : ''
    return `
    <div style="border-left:4px solid ${tc};margin-bottom:12px;padding:10px 14px;background:#f4f4f4;border-radius:0 6px 6px 0;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-size:13px;color:#222222;">
          <strong style="color:#ef6253;">"${escapeHtml(issue.word)}"</strong>
          <span style="color:#8c8c8c;margin:0 6px;">→</span>
          <strong style="color:#41b979;">"${escapeHtml(issue.suggestion)}"</strong>
        </span>
        <span style="background:${tc};color:white;padding:1px 8px;border-radius:10px;font-size:10px;">${tl}</span>
      </div>
      ${issue.desc?`<div style="font-size:11px;color:#8c8c8c;margin-bottom:4px;">${escapeHtml(issue.desc)}</div>`:''}
      ${issue.context?`<div style="font-family:monospace;font-size:11px;background:#ebebeb;padding:3px 8px;border-radius:4px;color:#444444;margin-bottom:4px;">${escapeHtml(issue.context)}</div>`:''}
      <div style="font-size:11px;color:#8c8c8c;display:flex;gap:12px;flex-wrap:wrap;">
        ${lineInfo ? `<span>${lineInfo}</span>` : ''}
        ${issue.pageUrl ? `<span>${escapeHtml(issue.pageUrl)}</span>` : ''}
      </div>
    </div>`
  }).join('') : '<div style="text-align:center;padding:24px;color:#41b979;font-weight:600;">오탈자가 감지되지 않았습니다.</div>'


  // 데드링크 HTML
  const lk = result.links || {}
  const deadLinksHtml = (lk.dead && lk.dead.length > 0) ? lk.dead.map((link, i) => `
    <div style="border-left:4px solid #ef6253;margin-bottom:12px;padding:10px 14px;background:#fff5f4;border-radius:0 6px 6px 0;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <code style="font-size:11px;color:#222222;word-break:break-all;">${escapeHtml(link.url)}</code>
        <span style="background:#ef6253;color:white;padding:1px 8px;border-radius:10px;font-size:10px;white-space:nowrap;margin-left:8px;">${link.status||'오류'}</span>
      </div>
      ${link.text?`<div style="font-size:12px;color:#8c8c8c;">링크 텍스트: "${escapeHtml(link.text)}"</div>`:''}
      ${link.error?`<div style="font-size:11px;color:#ef6253;margin-top:2px;">${escapeHtml(link.error)}</div>`:''}
    </div>`).join('') : '<div style="text-align:center;padding:24px;color:#41b979;font-weight:600;">데드링크가 발견되지 않았습니다.</div>'

  const redirectLinksHtml = (lk.redirects && lk.redirects.length > 0) ? lk.redirects.slice(0, 20).map(link => `
    <div style="border-left:4px solid #f0a34d;margin-bottom:8px;padding:8px 12px;background:#fff8ef;border-radius:0 6px 6px 0;font-size:11px;">
      <code style="word-break:break-all;color:#222222;">${escapeHtml(link.url)}</code>
      <div style="color:#b9771f;margin-top:2px;">→ ${escapeHtml(link.redirectUrl||'')} (${link.status})</div>
    </div>`).join('') : ''

  // W3C 검사 결과 HTML
  const w3c = result.w3c || {}
  const w3cErrorsHtml = (w3c.errors && w3c.errors.length > 0)
    ? w3c.errors.slice(0, 30).map((e, i) => `
      <div style="border-left:4px solid #ef6253;margin-bottom:10px;padding:10px 14px;background:#fff5f4;border-radius:0 6px 6px 0;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:4px;">
          <div style="font-size:12px;font-weight:600;color:#222222;flex:1;">${escapeHtml(e.message)}</div>
          <div style="display:flex;gap:4px;shrink:0;flex-shrink:0;">
            ${e.subType==='fatal'?'<span style="background:#ef6253;color:white;font-size:10px;padding:1px 6px;border-radius:4px;">치명적</span>':''}
            ${e.lastLine?`<span style="font-size:10px;color:#8c8c8c;white-space:nowrap;">L${e.lastLine}${e.lastColumn?':C'+e.lastColumn:''}</span>`:''}
          </div>
        </div>
        ${e.extract?`<div style="font-family:monospace;font-size:11px;background:#fff5f4;padding:3px 8px;border-radius:4px;color:#7f1d1d;word-break:break-all;margin-top:4px;">${escapeHtml(e.extract)}</div>`:''}
      </div>`).join('')
    + (w3c.errors.length > 30 ? `<div style="text-align:center;color:#8c8c8c;font-size:12px;padding:8px">… 외 ${w3c.errors.length-30}건</div>` : '')
    : '<div style="text-align:center;padding:20px;color:#41b979;font-weight:600;">W3C 오류가 없습니다.</div>'

  const w3cWarningsHtml = (w3c.warnings && w3c.warnings.length > 0)
    ? w3c.warnings.slice(0, 15).map((w, i) => `
      <div style="border-left:4px solid #f0a34d;margin-bottom:8px;padding:8px 12px;background:#fff8ef;border-radius:0 6px 6px 0;">
        <div style="font-size:12px;color:#222222;">${escapeHtml(w.message)}</div>
        ${w.extract?`<div style="font-family:monospace;font-size:11px;background:#fff8ef;padding:2px 6px;border-radius:3px;color:#78350f;margin-top:3px;word-break:break-all;">${escapeHtml(w.extract)}</div>`:''}
      </div>`).join('')
    : ''

  const screenshotSection = result.screenshot ? `
    <div class="section"><h2>페이지 스크린샷</h2>
      <img src="data:image/png;base64,${result.screenshot}" style="max-width:100%;border:1px solid #ebebeb;border-radius:8px;box-shadow:0 4px 6px rgba(0,0,0,0.07);" />
    </div>` : ''

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>웹 품질 검사 보고서 - ${escapeHtml(result.pageTitle || result.url)}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html{overflow-y:scroll}
  body{font-family:"Pretendard Variable",Pretendard,-apple-system,"Malgun Gothic","맑은 고딕",sans-serif;background:#fff;color:#222;letter-spacing:-.01em;line-height:1.5}
  .header{background:#fff;color:#222;padding:0;border-bottom:1px solid #ebebeb}
  .header > div{max-width:1180px!important;margin:0 auto;padding:36px 40px 28px}
  .header h1{font-size:34px;font-weight:800;letter-spacing:-.04em;margin-bottom:10px}
  .header h1::before{content:"가디언즈";display:block;font-size:13px;font-weight:600;color:#8c8c8c;letter-spacing:0;margin-bottom:6px}
  .meta{font-size:13px;color:#8c8c8c;margin-top:3px}
  .container{max-width:1180px;margin:0 auto;padding:28px 40px 80px}
  .section{background:#fff;border-radius:0;padding:28px 0;margin-bottom:0;box-shadow:none;border-bottom:1px solid #ebebeb}
  .section h2{font-size:22px;font-weight:700;letter-spacing:-.03em;margin-bottom:18px;color:#222;border-bottom:0;padding-bottom:0}
  .section h3{font-size:15px;font-weight:700;margin:14px 0 8px}
  .score-num{font-size:72px;font-weight:800;color:#222;line-height:1;letter-spacing:-.05em}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid #ebebeb;border-radius:10px;overflow:hidden}
  .stat{text-align:left;padding:18px 20px;background:#fff;border-radius:0;border-right:1px solid #ebebeb}
  .stat:last-child{border-right:0}
  .stat-num{font-size:30px;font-weight:800;letter-spacing:-.04em}
  .impact-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
  .impact-item{padding:14px 16px;border-radius:10px;text-align:left;background:#f4f4f4!important}
  .impact-item .num{font-size:28px;font-weight:800;color:#222;letter-spacing:-.04em}
  .impact-item .lbl{font-size:12px;color:#8c8c8c;margin-top:2px}
  .summary-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}
  .sum-box{padding:16px 18px;border-radius:10px;text-align:left;border:1px solid #ebebeb!important;background:#fff!important}
  .badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;background:#f4f4f4!important;color:#222!important}
  .footer{text-align:left;color:#8c8c8c;font-size:12px;margin-top:28px;padding:20px 0 36px;border-top:1px solid #ebebeb}
  table{border-collapse:collapse;width:100%} th{text-align:left;color:#8c8c8c;font-weight:600;border-bottom:1px solid #ebebeb;padding:10px 8px;font-size:13px} td{border-bottom:1px solid #ebebeb;padding:10px 8px;font-size:13px;vertical-align:top}
  a{color:#222}
  [style*="font-family:monospace"]{font-family:ui-monospace,Menlo,Consolas,monospace!important;background:#f4f4f4!important;border:1px solid #ebebeb;color:#222}
  [style*="border-left"]{border-left-width:2px!important}
  @media print{body{background:white}.header{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body>
<div class="header">
  <div style="max-width:960px;margin:0 auto">
    <h1>웹 품질 종합 검사 보고서</h1>
    <div class="meta">URL: ${escapeHtml(result.url)}</div>
    <div class="meta">제목: ${escapeHtml(result.pageTitle||'알 수 없음')}</div>
    <div class="meta">검사 일시: ${new Date(result.scannedAt).toLocaleString('ko-KR')}</div>
    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
      <span class="badge" style="background:rgba(255,255,255,.2)">접근성 ${result.level.toUpperCase()}</span>
      <span class="badge" style="background:rgba(255,255,255,.2)">오탈자 검사</span>
      <span class="badge" style="background:rgba(255,255,255,.2)">링크 검사</span>
      ${w3c.checkedAt ? '<span class="badge" style="background:rgba(255,255,255,.2)">W3C 표준검사</span>' : ''}
    </div>
  </div>
</div>
<div class="container">

  <!-- 종합 현황 -->
  <div class="section">
    <h2>종합 검사 현황</h2>
    <div class="summary-grid">
      <div class="sum-box" style="background:#fff5f4;border-color:#f7c9c3">
        <div style="font-size:11px;font-weight:600;color:#ef6253;margin-bottom:4px">접근성 위반</div>
        <div style="font-size:32px;font-weight:800;color:#ef6253">${result.summary.violations}</div>
        <div style="font-size:11px;color:#8c8c8c">점수: ${result.score}/100</div>
      </div>
      <div class="sum-box" style="background:${sp.totalIssues>0?'#f4f4f4':'#f1faf5'};border-color:${sp.totalIssues>0?'#ebebeb':'#bfe8d0'}">
        <div style="font-size:11px;font-weight:600;color:${sp.totalIssues>0?'#222222':'#41b979'};margin-bottom:4px">오탈자</div>
        <div style="font-size:32px;font-weight:800;color:${sp.totalIssues>0?'#222222':'#41b979'}">${sp.totalIssues||0}</div>
        <div style="font-size:11px;color:#8c8c8c">총 ${sp.totalWords||0}개 단어 검사</div>
      </div>
      <div class="sum-box" style="background:${lk.dead&&lk.dead.length>0?'#fff5f4':'#f1faf5'};border-color:${lk.dead&&lk.dead.length>0?'#f7c9c3':'#bfe8d0'}">
        <div style="font-size:11px;font-weight:600;color:${lk.dead&&lk.dead.length>0?'#ef6253':'#41b979'};margin-bottom:4px">데드링크</div>
        <div style="font-size:32px;font-weight:800;color:${lk.dead&&lk.dead.length>0?'#ef6253':'#41b979'}">${lk.dead?lk.dead.length:0}</div>
        <div style="font-size:11px;color:#8c8c8c">총 ${lk.total||0}개 링크 검사</div>
      </div>
    </div>
    ${w3c.checkedAt ? `
    <div style="margin-top:12px;padding:12px 16px;border-radius:8px;background:${(w3c.errorCount||0)>0?'#fff5f4':'#f1faf5'};border:1px solid ${(w3c.errorCount||0)>0?'#f7c9c3':'#bfe8d0'}">
      <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">
        <div style="font-size:11px;font-weight:700;color:#222222;min-width:120px">W3C 표준검사</div>
        <div style="text-align:center;min-width:70px">
          <div style="font-size:20px;font-weight:800;color:${(w3c.errorCount||0)>0?'#ef6253':'#41b979'}">${w3c.errorCount||0}</div>
          <div style="font-size:10px;color:#8c8c8c">오류</div>
        </div>
        <div style="text-align:center;min-width:70px">
          <div style="font-size:20px;font-weight:800;color:${(w3c.warningCount||0)>0?'#f0a34d':'#41b979'}">${w3c.warningCount||0}</div>
          <div style="font-size:10px;color:#8c8c8c">경고</div>
        </div>
        <div style="text-align:center;min-width:80px">
          <span style="font-size:13px;font-weight:700;padding:4px 12px;border-radius:20px;background:${w3c.valid===true?'#f1faf5':w3c.valid===false?'#fff5f4':'#f4f4f4'};color:${w3c.valid===true?'#41b979':w3c.valid===false?'#ef6253':'#8c8c8c'}">
            ${w3c.valid===true?'유효':w3c.valid===false?'무효':'미검사'}
          </span>
        </div>
      </div>
    </div>` : ''}
  </div>

  <!-- 접근성 점수 -->
  <div class="section">
    <h2>접근성 검사 결과 (${result.level.toUpperCase()})</h2>
    <div style="display:grid;grid-template-columns:1fr 2fr;gap:20px;align-items:center;margin-bottom:20px">
      <div style="text-align:center">
        <div class="score-num">${result.score}</div>
        <div style="font-size:14px;color:#8c8c8c">/ 100점</div>
      </div>
      <div class="stats">
        <div class="stat"><div class="stat-num" style="color:#ef6253">${result.summary.violations}</div><div style="font-size:11px;color:#8c8c8c">위반</div></div>
        <div class="stat"><div class="stat-num" style="color:#41b979">${result.summary.passes}</div><div style="font-size:11px;color:#8c8c8c">통과</div></div>
        <div class="stat"><div class="stat-num" style="color:#f0a34d">${result.summary.incomplete}</div><div style="font-size:11px;color:#8c8c8c">검토필요</div></div>
        <div class="stat"><div class="stat-num" style="color:#8c8c8c">${result.summary.inapplicable}</div><div style="font-size:11px;color:#8c8c8c">해당없음</div></div>
      </div>
    </div>
    <div class="impact-grid">
      <div class="impact-item" style="background:#ef6253"><div class="num">${result.summary.impactCounts.critical||0}</div><div class="lbl">치명적</div></div>
      <div class="impact-item" style="background:#f0a34d"><div class="num">${result.summary.impactCounts.serious||0}</div><div class="lbl">심각</div></div>
      <div class="impact-item" style="background:#f0a34d"><div class="num">${result.summary.impactCounts.moderate||0}</div><div class="lbl">보통</div></div>
      <div class="impact-item" style="background:#41b979"><div class="num">${result.summary.impactCounts.minor||0}</div><div class="lbl">경미</div></div>
    </div>
    ${result.violations.length > 0 ? `<div style="margin-top:20px">${violationsHtml}</div>` : '<div style="text-align:center;padding:32px;color:#41b979;font-size:16px;font-weight:700">위반 항목 없음!</div>'}
  </div>

  ${screenshotSection}

  <!-- 오탈자 -->
  <div class="section">
    <h2>오탈자 검사 결과</h2>
    <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
      <div style="background:#f5f3ff;padding:10px 16px;border-radius:8px;text-align:center;min-width:100px">
        <div style="font-size:22px;font-weight:800;color:#222222">${sp.koreanIssues||0}</div>
        <div style="font-size:11px;color:#8c8c8c">한글 오탈자</div>
      </div>
      <div style="background:#f4f4f4;padding:10px 16px;border-radius:8px;text-align:center;min-width:100px">
        <div style="font-size:22px;font-weight:800;color:#8c8c8c">${sp.totalWords||0}</div>
        <div style="font-size:11px;color:#8c8c8c">검사 어절 수</div>
      </div>
    </div>
    ${spellingHtml}
  </div>

  <!-- 데드링크 -->
  <div class="section">
    <h2>링크 검사 결과</h2>
    <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
      <div style="background:#fff5f4;padding:10px 16px;border-radius:8px;text-align:center;min-width:100px">
        <div style="font-size:22px;font-weight:800;color:#ef6253">${lk.dead?lk.dead.length:0}</div>
        <div style="font-size:11px;color:#8c8c8c">데드링크</div>
      </div>
      <div style="background:#fff8ef;padding:10px 16px;border-radius:8px;text-align:center;min-width:100px">
        <div style="font-size:22px;font-weight:800;color:#f0a34d">${lk.redirects?lk.redirects.length:0}</div>
        <div style="font-size:11px;color:#8c8c8c">리다이렉트</div>
      </div>
      <div style="background:#f1faf5;padding:10px 16px;border-radius:8px;text-align:center;min-width:100px">
        <div style="font-size:22px;font-weight:800;color:#41b979">${lk.live||0}</div>
        <div style="font-size:11px;color:#8c8c8c">정상 링크</div>
      </div>
      <div style="background:#f4f4f4;padding:10px 16px;border-radius:8px;text-align:center;min-width:100px">
        <div style="font-size:22px;font-weight:800;color:#8c8c8c">${lk.total||0}</div>
        <div style="font-size:11px;color:#8c8c8c">검사 링크 수</div>
      </div>
    </div>
    ${lk.dead && lk.dead.length > 0 ? `<h3 style="font-size:13px;font-weight:700;color:#ef6253;margin-bottom:8px">오류 링크 (${lk.dead.length}개)</h3>${deadLinksHtml}` : deadLinksHtml}
    ${redirectLinksHtml ? `<h3 style="font-size:13px;font-weight:700;color:#f0a34d;margin-top:16px;margin-bottom:8px">↪ 리다이렉트 링크 (${lk.redirects?lk.redirects.length:0}개)</h3>${redirectLinksHtml}` : ''}
  </div>

  ${w3c.checkedAt ? `
  <!-- W3C 표준 검사 -->
  <div class="section">
    <h2>W3C 표준 검사 결과 (Markup Validation)</h2>
    <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
      <div style="background:${(w3c.errorCount||0)>0?'#fff5f4':'#f1faf5'};padding:10px 16px;border-radius:8px;text-align:center;min-width:80px">
        <div style="font-size:22px;font-weight:800;color:${(w3c.errorCount||0)>0?'#ef6253':'#41b979'}">${w3c.errorCount||0}</div>
        <div style="font-size:11px;color:#8c8c8c">오류</div>
      </div>
      <div style="background:${(w3c.warningCount||0)>0?'#fff8ef':'#f1faf5'};padding:10px 16px;border-radius:8px;text-align:center;min-width:80px">
        <div style="font-size:22px;font-weight:800;color:${(w3c.warningCount||0)>0?'#f0a34d':'#41b979'}">${w3c.warningCount||0}</div>
        <div style="font-size:11px;color:#8c8c8c">경고</div>
      </div>
      ${(w3c.fatalCount||0)>0?`<div style="background:#fff5f4;padding:10px 16px;border-radius:8px;text-align:center;min-width:80px">
        <div style="font-size:22px;font-weight:800;color:#ef6253">${w3c.fatalCount}</div>
        <div style="font-size:11px;color:#8c8c8c">치명적</div>
      </div>`:''}
      <div style="padding:10px 16px;border-radius:8px;text-align:center">
        <span style="font-size:14px;font-weight:700;padding:6px 16px;border-radius:20px;background:${w3c.valid===true?'#f1faf5':w3c.valid===false?'#fff5f4':'#f4f4f4'};color:${w3c.valid===true?'#41b979':w3c.valid===false?'#ef6253':'#8c8c8c'}">
          ${w3c.valid===true?'유효 (Valid)':w3c.valid===false?'무효 (Invalid)':'미검사'}
        </span>
      </div>
    </div>
    ${w3cErrorsHtml}
    ${w3cWarningsHtml ? `<div style="margin-top:12px;margin-bottom:8px"><strong style="font-size:13px;color:#f0a34d">경고 목록 (${w3c.warnings.length}건)</strong></div>${w3cWarningsHtml}` : ''}
    <div style="font-size:10px;color:#8c8c8c;margin-top:10px">검사 기준: W3C Markup Validation Service (validator.w3.org/nu) | 검사 일시: ${new Date(w3c.checkedAt).toLocaleString('ko-KR')}</div>
  </div>` : ''}

  <div class="footer">
    <p>본 보고서는 가디언즈 오브 갤럭시 자동 검사 결과입니다. (axe-core + Playwright)</p>
    <p>자동 검사는 전체 이슈의 일부만 탐지할 수 있으며, 전문가 수동 검토를 병행하시기 바랍니다.</p>
    <p style="margin-top:6px;color:#cbd5e1">생성: ${new Date().toLocaleString('ko-KR')}</p>
  </div>
</div>
</body>
</html>`

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="a11y-report-${Date.now()}.html"`)
  res.send(html)
})

// ═══════════════════════════════════════════════════════
// ─── 민원안내 페이지 목록 조회 API ───────────────────
// ═══════════════════════════════════════════════════════

// 인메모리 저장소 (배치 스캔 세션 및 결과)
const batchSessions = new Map()
const evidenceStore = new Map()

// evidenceStore 크기 제한 헬퍼 (오래된 항목 자동 삭제로 메모리 과다 방지)
function addEvidence(id, data) {
  evidenceStore.set(id, data)
  if (evidenceStore.size > MAX_EVIDENCE_STORE) {
    // 가장 오래된 항목부터 삭제 (FIFO)
    const oldestKey = evidenceStore.keys().next().value
    evidenceStore.delete(oldestKey)
  }
}

// 배치 결과를 경량화하여 메모리 절약 (배치 테이블 표시용 summary만 유지)
function lightResult(result) {
  return {
    id: result.id,
    scannedAt: result.scannedAt,
    url: result.url,
    originalUrl: result.originalUrl,
    pageTitle: result.pageTitle,
    level: result.level,
    score: result.score,
    status: result.status,
    error: result.error,
    fileName: result.fileName,
    summary: result.summary,
    spelling: result.spelling ? {
      totalIssues: result.spelling.totalIssues ?? result.spelling.issues?.length ?? 0,
      totalWords: result.spelling.totalWords ?? 0
    } : null,
    links: result.links ? {
      dead: result.links.dead?.length ?? 0,
      redirects: result.links.redirects?.length ?? 0,
      live: result.links.live ?? 0,
      total: result.links.total ?? 0,
      engine: result.links.engine
    } : null,
    w3c: result.w3c ? {
      valid: result.w3c.valid,
      errorCount: result.w3c.errorCount ?? 0,
      warningCount: result.w3c.warningCount ?? 0
    } : null,
    krds: result.krds ? {
      score: result.krds.score ?? 0,
      passed: result.krds.passed ?? 0,
      total: result.krds.total ?? 0,
      failed: result.krds.failed ?? 0,
      items: (result.krds.items || []).map(i => ({
        category: i.category, name: i.name, level: i.level,
        passed: i.passed, detail: i.detail, recommend: i.recommend
      }))
    } : null,
    // PPTX 산출물용: violations + passes (id만)
    violations: (result.violations || []).map(v => ({
      id: v.id, impact: v.impact, help: v.help,
      tags: v.tags, nodes: (v.nodes || []).slice(0,3)
    })),
    passes: (result.passes || []).map(p =>
      typeof p === 'string' ? { id: p } : { id: p.id || p }
    ),
    screenshot: result.screenshot || null,
  }
}

// 민원 목록 조회 (plus.gov.kr API 활용 → www.gov.kr/mw 민원안내 URL 사용)
app.get('/api/minwon/list', async (req, res) => {
  const { page = 1, pageSize = 20, query = '' } = req.query
  const ps = Math.min(parseInt(pageSize) || 20, 1000)  // 최대 1000개 허용
  // GOV24_URL 기준으로 중복이 많으므로 실제 표시할 수보다 더 많이 가져옴
  // pageSize=1000일 때 충분히 수집하기 위해 최대 6000까지 허용
  const fetchSize = Math.min(ps * 6, 6000)
  const startCount = (parseInt(page) - 1) * ps

  try {
    const abortCtrl = new AbortController()
    const fetchTimer = setTimeout(() => abortCtrl.abort(), 10000)  // 10초 타임아웃
    const response = await fetch('https://plus.gov.kr/api/iwcas/guide/v1.0/search/mergeResult', {
      method: 'POST',
      signal: abortCtrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        'Referer': 'https://plus.gov.kr/minwon'
      },
      body: JSON.stringify({
        query: query || '',
        startCount: String(startCount),
        listCount: String(fetchSize),
        collections: 'IW_SERVICE',
        sortField: 'WEIGHT/DESC,RANK/DESC,INQ_CNT/DESC,TYPE_SN/ASC,UID/ASC',
        docId: ''
      })
    })
    clearTimeout(fetchTimer)

    const data = await response.json()
    const mergeResult = data.searchMergeResult?.MERGE_COLLECTION || []
    const totalCount = data.totalCount || data.searchMergeResult?.TOTAL_COUNT || 0

    // GOV24_URL 기준으로 www.gov.kr/mw URL 생성, 로그인 없이 접근 가능한 민원안내 페이지만 포함
    // GOV24_URL 예시: /mw/AA020InfoCappView.do?&CappBizCD=13100000026&tp_seq=01
    const seenUrls = new Set()
    const items = []
    for (const item of mergeResult) {
      if (!item.GOV24_URL) continue
      // CappBizCD 추출
      const bizCdMatch = item.GOV24_URL.match(/CappBizCD=(\w+)/)
      if (!bizCdMatch) continue
      const cappBizCd = bizCdMatch[1]
      // 로그인 필요 없는 민원안내 URL (AA020InfoCappView.do)
      const govUrl = `https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=${cappBizCd}`
      // CappBizCD 기준으로 중복 제거
      if (seenUrls.has(cappBizCd)) continue
      seenUrls.add(cappBizCd)
      items.push({
        id: cappBizCd,
        docId: item.DOCID,
        title: item.TITLE || '',
        content: item.CONTENT ? item.CONTENT.substring(0, 100) : '',
        category: item.L_CATEGORY ? item.L_CATEGORY.split('#')[1] || item.L_CATEGORY : '',
        subCategory: item.M_CATEGORY ? item.M_CATEGORY.split('#')[1] || item.M_CATEGORY : '',
        department: item.DEPARTMENT || '',
        url: govUrl,
        cappBizCd
      })
      if (items.length >= ps) break
    }

    res.json({
      total: totalCount,
      page: parseInt(page),
      pageSize: ps,
      items
    })
  } catch (err) {
    console.error('민원 목록 조회 오류:', err.message)
    res.status(500).json({ error: '민원 목록 조회 실패: ' + err.message })
  }
})

// ─── 민원 전체 URL 목록 수집 (배치 전체 검사용) ───────
// plus.gov.kr API를 페이지별로 순회하여 GOV24 URL 중복 제거 후 전부 수집
app.get('/api/minwon/all-urls', async (req, res) => {
  const { query = '' } = req.query
  try {
    const PAGE_BATCH = 200   // 1회 API 호출당 가져올 수
    let startCount = 0
    const seenCds = new Set()
    const allItems = []

    // 첫 번째 호출로 totalCount 파악
    const first = await fetchMinwonPage(query, 0, PAGE_BATCH)
    const total = first.total

    for (const item of first.items) {
      if (!seenCds.has(item.cappBizCd)) {
        seenCds.add(item.cappBizCd)
        allItems.push(item)
      }
    }
    startCount += PAGE_BATCH

    // 나머지 페이지 병렬 수집 (10개씩 묶어서)
    const remaining = Math.ceil((total - PAGE_BATCH) / PAGE_BATCH)
    const batches = []
    for (let i = 0; i < remaining; i++) {
      batches.push(startCount + i * PAGE_BATCH)
    }

    // 20개씩 병렬 처리
    const PARALLEL = 20
    for (let i = 0; i < batches.length; i += PARALLEL) {
      const chunk = batches.slice(i, i + PARALLEL)
      const results = await Promise.allSettled(
        chunk.map(sc => fetchMinwonPage(query, sc, PAGE_BATCH))
      )
      for (const r of results) {
        if (r.status === 'fulfilled') {
          for (const item of r.value.items) {
            if (!seenCds.has(item.cappBizCd)) {
              seenCds.add(item.cappBizCd)
              allItems.push(item)
            }
          }
        }
      }
    }

    res.json({ total: allItems.length, items: allItems })
  } catch (err) {
    console.error('전체 목록 수집 오류:', err.message)
    res.status(500).json({ error: '전체 목록 수집 실패: ' + err.message })
  }
})

// plus.gov.kr API 호출 헬퍼 (내부 함수)
async function fetchMinwonPage(query, startCount, listCount) {
  const response = await fetch('https://plus.gov.kr/api/iwcas/guide/v1.0/search/mergeResult', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      'Referer': 'https://plus.gov.kr/minwon'
    },
    body: JSON.stringify({
      query: query || '', startCount: String(startCount), listCount: String(listCount),
      collections: 'IW_SERVICE',
      sortField: 'WEIGHT/DESC,RANK/DESC,INQ_CNT/DESC,TYPE_SN/ASC,UID/ASC', docId: ''
    })
  })
  const data = await response.json()
  const mergeResult = data.searchMergeResult?.MERGE_COLLECTION || []
  const items = []
  for (const item of mergeResult) {
    if (!item.GOV24_URL) continue
    const bizCdMatch = item.GOV24_URL.match(/CappBizCD=(\w+)/)
    if (!bizCdMatch) continue
    const cappBizCd = bizCdMatch[1]
    items.push({
      id: cappBizCd, docId: item.DOCID, title: item.TITLE || '',
      content: item.CONTENT ? item.CONTENT.substring(0, 100) : '',
      category: item.L_CATEGORY ? item.L_CATEGORY.split('#')[1] || item.L_CATEGORY : '',
      subCategory: item.M_CATEGORY ? item.M_CATEGORY.split('#')[1] || item.M_CATEGORY : '',
      department: item.DEPARTMENT || '',
      url: `https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=${cappBizCd}`,
      cappBizCd
    })
  }
  return { total: data.totalCount || 0, items }
}

// ═══════════════════════════════════════════════════════
// ─── 엑셀 기반 차수별 민원 목록 API ──────────────────
// ═══════════════════════════════════════════════════════

// 엑셀에서 차수별 민원 항목 로드 (캐시)
let _minwonByStep = null
async function loadMinwonByStep() {
  if (_minwonByStep) return _minwonByStep
  const wb = new ExcelJS.Workbook()
  // 경로 후보: 환경변수 > APP_ROOT(exe 옆) > __dirname > process.cwd() > 절대경로
  const candidates = [
    process.env.EXCEL_PATH,
    join(APP_ROOT, 'data', 'minwon-list.xlsx'),          // exe 배포 패키지
    join(__dirname, 'data', 'minwon-list.xlsx'),          // 일반 node 실행
    join(process.cwd(), 'data', 'minwon-list.xlsx'),
    '/home/user/webapp/data/minwon-list.xlsx',
    '/app/data/minwon-list.xlsx'
  ].filter(Boolean)
  const excelPath = candidates.find(p => existsSync(p))
  if (!excelPath) {
    throw new Error(`민원 목록 엑셀 파일을 찾을 수 없습니다. 시도한 경로:\n${candidates.join('\n')}`)
  }
  console.log('[민원목록] 엑셀 로드:', excelPath)
  await wb.xlsx.readFile(excelPath)
  const ws = wb.getWorksheet(1)
  const byStep = { '1차': [], '2차': [], '3차': [] }
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const code = row.getCell(2).value
    const name = (row.getCell(3).value || '').toString().trim()
    const dept = (row.getCell(4).value || '').toString().trim()
    const step = (row.getCell(5).value || '').toString().trim()
    if (!code) continue
    const cappBizCd = String(code).trim()
    const url = `https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=${cappBizCd}`
    const entry = { cappBizCd, title: name, department: dept, url, step }
    if (byStep[step]) byStep[step].push(entry)
  }
  _minwonByStep = byStep
  return byStep
}

// GET /api/debug/browser  → Playwright/Chromium 실행 테스트
app.get('/api/debug/browser', async (req, res) => {
  const result = { ok: false, error: null, chromiumPath: null, env: {} }
  try {
    result.env = {
      NODE_VERSION: process.version,
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || '(미설정)',
      HOME: process.env.HOME || '(미설정)',
      PATH_PREVIEW: (process.env.PATH || '').substring(0, 200)
    }
    // Chromium 경로 확인
    const { execSync } = await import('child_process')
    try {
      result.chromiumPath = execSync('which chromium-browser || which chromium || which google-chrome || echo "NOT_FOUND"', { timeout: 3000 }).toString().trim()
    } catch(e) { result.chromiumPath = 'command failed: ' + e.message }

    // 실제 Playwright launch 테스트
    const testBrowser = await chromium.launch({
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'],
      timeout: 15000
    })
    const page = await testBrowser.newPage()
    await page.goto('about:blank')
    const title = await page.title()
    await testBrowser.close()
    result.ok = true
    result.title = title
  } catch(e) {
    result.error = e.message
  }
  res.json(result)
})

// GET /api/debug/connectivity  → 외부 URL 접속 가능 여부 테스트
app.get('/api/debug/connectivity', async (req, res) => {
  const targets = [
    'https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=13200000003',
    'https://example.com',
    'https://www.google.com',
  ]
  const results = {}
  for (const url of targets) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8000)
      const r = await fetch(url, { signal: controller.signal, redirect: 'follow' })
      clearTimeout(timer)
      results[url] = { ok: true, status: r.status }
    } catch (e) {
      results[url] = { ok: false, error: e.message }
    }
  }
  res.json(results)
})

// GET /api/minwon/steps  → 차수 목록 및 건수
app.get('/api/minwon/steps', async (req, res) => {
  try {
    const byStep = await loadMinwonByStep()
    res.json({
      steps: Object.keys(byStep).map(step => ({
        step,
        count: byStep[step].length
      }))
    })
  } catch (err) {
    console.error('차수 목록 오류:', err.message)
    res.status(500).json({ error: '차수 목록 조회 실패: ' + err.message })
  }
})

// GET /api/minwon/step/:step  → 해당 차수 민원 목록 (페이지네이션)
app.get('/api/minwon/step/:step', async (req, res) => {
  try {
    const { step } = req.params
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const pageSize = Math.min(Math.max(1, parseInt(req.query.pageSize) || 50), 1000)
    const byStep = await loadMinwonByStep()
    const list = byStep[step]
    if (!list) return res.status(400).json({ error: `알 수 없는 차수: ${step}` })
    const start = (page - 1) * pageSize
    const items = list.slice(start, start + pageSize)
    res.json({ step, total: list.length, page, pageSize, items })
  } catch (err) {
    console.error('차수별 목록 오류:', err.message)
    res.status(500).json({ error: '차수별 목록 조회 실패: ' + err.message })
  }
})

// POST /api/batch/start-step  → 특정 차수 전체 배치 검사 시작
app.post('/api/batch/start-step', async (req, res) => {
  const { step, options = {}, chunkSize = 1000 } = req.body
  if (!step) return res.status(400).json({ error: 'step 파라미터가 필요합니다.' })
  const safeChunk = Math.min(Math.max(parseInt(chunkSize) || 1000, 1), 1000)

  try {
    const byStep = await loadMinwonByStep()
    const allItems = byStep[step]
    if (!allItems || allItems.length === 0) {
      return res.status(404).json({ error: `${step} 차수에 해당하는 민원이 없습니다.` })
    }

    const sessionIds = []
    for (let i = 0; i < allItems.length; i += safeChunk) {
      const chunk = allItems.slice(i, i + safeChunk)
      const urls = chunk.map(item => ({
        url: item.url, title: item.title,
        category: item.step, department: item.department
      }))
      const sessionId = 'batch_' + step.replace('차', '') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2)
      const session = {
        id: sessionId,
        label: `${step} 차수 검사`,
        step,
        createdAt: new Date().toISOString(),
        total: urls.length,
        completed: 0,
        failed: 0,
        status: 'running',
        results: [],
        options,
        urls,
        chunkIndex: Math.floor(i / safeChunk),
        totalChunks: Math.ceil(allItems.length / safeChunk)
      }
      batchSessions.set(sessionId, session)
      sessionIds.push(sessionId)

      // 백그라운드 병렬 처리
      ;(async (sess, urlList) => {
        let jIdx = 0, done = 0
        let consecutiveConnErrors = 0  // 연속 연결 오류 카운터
        const MAX_CONSEC_ERRORS = 5    // 5회 연속 연결 오류 시 중단

        const workers = Array.from({ length: BATCH_CONCURRENCY }, async () => {
          while (true) {
            const j = jIdx++
            if (j >= urlList.length) break
            // 연속 연결 오류가 너무 많으면 중단 (gov.kr 차단 등)
            if (consecutiveConnErrors >= MAX_CONSEC_ERRORS) break
            const entry = urlList[j]
            const urlStr = typeof entry === 'string' ? entry : entry.url
            try {
              const result = await scanSinglePage(urlStr, options)
              if (typeof entry === 'object') {
                result.category = result.category || entry.category
                result.department = result.department || entry.department
              }
              addEvidence(result.id, result)
              // 스크린샷 별도 보관 (PPTX 생성용)
              if (result.screenshot) {
                if (!sess.screenshots) sess.screenshots = {}
                sess.screenshots[result.id] = result.screenshot
              }
              const lightResult = {
                id: result.id, url: result.url, pageTitle: result.pageTitle,
                score: result.score, status: result.status,
                summary: result.summary, category: result.category,
                department: result.department, step: sess.step,
                screenshot: result.screenshot || null,
                violations: (result.violations || []).map(v => ({ id: v.id, impact: v.impact, help: v.help, tags: v.tags, nodes: (v.nodes||[]).slice(0,3) })),
                passes: (result.passes || []).map(p => typeof p==='string' ? {id:p} : {id:p.id||p}),
                spelling: result.spelling ? { totalIssues: result.spelling.totalIssues } : null,
                links: result.links ? { dead: Array.isArray(result.links.dead) ? result.links.dead.length : (result.links.dead || 0) } : null,
                w3c: result.w3c ? { errors: result.w3c.errors } : null,
                krds: result.krds ? { score: result.krds.score, failed: result.krds.failed } : null,
                scannedAt: result.scannedAt
              }
              sess.results.push(lightResult)
              if (result.status === 'error') {
                sess.failed++
                // 연결 오류인 경우 카운터 증가
                if (result.error && (result.error.includes('연결이 끊어졌습니다') || result.error.includes('연결을 거부'))) {
                  consecutiveConnErrors++
                } else {
                  consecutiveConnErrors = 0  // 다른 오류면 리셋
                }
              } else {
                sess.completed++
                consecutiveConnErrors = 0  // 성공 시 리셋
              }
            } catch (err) {
              sess.failed++
              sess.results.push({
                url: urlStr, status: 'error', error: err.message,
                id: Date.now().toString(36) + Math.random().toString(36).slice(2),
                score: 0, summary: { violations: 0, passes: 0, incomplete: 0, inapplicable: 0, impactCounts: {} }
              })
              if (err.message.includes('ERR_CONNECTION_RESET') || err.message.includes('ERR_CONNECTION_REFUSED')) {
                consecutiveConnErrors++
              }
            }
            done++
            sess.progress = Math.round(done / urlList.length * 100)
          }
        })
        await Promise.allSettled(workers)
        sess.status = 'completed'
        sess.finishedAt = new Date().toISOString()
        if (consecutiveConnErrors >= MAX_CONSEC_ERRORS) {
          sess.status = 'aborted'
          sess.abortReason = `연속 ${MAX_CONSEC_ERRORS}회 연결 오류로 중단됨. 이 서버에서 대상 사이트 접속이 차단되었을 수 있습니다.`
          console.warn(`[배치중단] ${sess.label} sessionId=${sess.id} - 연속 연결 오류로 중단 (완료=${sess.completed} 실패=${sess.failed})`)
        } else {
          console.log(`[배치완료] ${sess.label} sessionId=${sess.id} 완료=${sess.completed} 실패=${sess.failed}`)
        }
      })(session, urls)
    }

    res.json({
      step,
      totalUrls: allItems.length,
      totalSessions: sessionIds.length,
      chunkSize: safeChunk,
      sessionIds,
      firstSessionId: sessionIds[0],
      message: `${step} 차수 ${allItems.length}개 URL을 ${sessionIds.length}개 세션으로 분할하여 검사를 시작합니다.`
    })
  } catch (err) {
    console.error('차수별 검사 시작 오류:', err.message)
    res.status(500).json({ error: '차수별 검사 시작 실패: ' + err.message })
  }
})

// ═══════════════════════════════════════════════════════
// ─── 배치 스캔 API ────────────────────────────────────
// ═══════════════════════════════════════════════════════

// ─── 차수 전체 단일 세션 검사 (번호 연속성 보장) ────────────
// 1000개 청크 없이 차수 전체를 하나의 세션으로 처리
app.post('/api/batch/start-step-full', async (req, res) => {
  const { step, options = {} } = req.body
  if (!step) return res.status(400).json({ error: 'step 파라미터가 필요합니다.' })

  try {
    const byStep = await loadMinwonByStep()
    const allItems = byStep[step]
    if (!allItems || allItems.length === 0) {
      return res.status(404).json({ error: `${step} 차수에 해당하는 민원이 없습니다.` })
    }

    const urls = allItems.map(item => ({
      url: item.url, title: item.title,
      category: item.step, department: item.department
    }))

    const sessionId = 'full_' + step.replace('차', '') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2)
    const session = {
      id: sessionId,
      label: `${step} 전체 검사 (${allItems.length}개)`,
      step,
      createdAt: new Date().toISOString(),
      total: urls.length,
      completed: 0,
      failed: 0,
      status: 'running',
      results: new Array(urls.length).fill(null),  // 인덱스 순서 보장
      options,
      urls,
      isFull: true   // 전체 단일 세션 표시
    }
    batchSessions.set(sessionId, session)

    // 백그라운드 병렬 처리 (인덱스 순서 유지)
    ;(async (sess, urlList) => {
      let jIdx = 0
      let consecutiveConnErrors = 0
      const MAX_CONSEC_ERRORS = 5

      const workers = Array.from({ length: BATCH_CONCURRENCY }, async () => {
        while (true) {
          const j = jIdx++
          if (j >= urlList.length) break
          if (consecutiveConnErrors >= MAX_CONSEC_ERRORS) break
          const entry = urlList[j]
          const urlStr = typeof entry === 'string' ? entry : entry.url
          try {
            const result = await scanSinglePage(urlStr, options)
            if (typeof entry === 'object') {
              result.category = result.category || entry.category
              result.department = result.department || entry.department
            }
            addEvidence(result.id, result)
            // 인덱스 j에 결과 저장 → 번호 순서 보장
            sess.results[j] = {
              id: result.id, url: result.url, pageTitle: result.pageTitle,
              score: result.score, status: result.status,
              summary: result.summary, category: result.category,
              department: result.department, step: sess.step,
              spelling: result.spelling ? { totalIssues: result.spelling.totalIssues, totalWords: result.spelling.totalWords, issues: result.spelling.issues } : null,
              links: result.links ? { dead: Array.isArray(result.links.dead) ? result.links.dead.length : (result.links.dead || 0) } : null,
              w3c: result.w3c ? { errorCount: result.w3c.errorCount, warningCount: result.w3c.warningCount, valid: result.w3c.valid, checkedAt: result.w3c.checkedAt } : null,
              krds: result.krds ? { score: result.krds.score, failed: result.krds.failed } : null,
              scannedAt: result.scannedAt
            }
            if (result.status === 'error') {
              sess.failed++
              if (result.error && (result.error.includes('연결이 끊어졌습니다') || result.error.includes('연결을 거부'))) {
                consecutiveConnErrors++
              } else { consecutiveConnErrors = 0 }
            } else {
              sess.completed++
              consecutiveConnErrors = 0
            }
          } catch (err) {
            sess.failed++
            sess.results[j] = {
              url: urlStr, status: 'error', error: err.message,
              id: Date.now().toString(36) + Math.random().toString(36).slice(2),
              score: 0, summary: { violations: 0, passes: 0, incomplete: 0, inapplicable: 0, impactCounts: {} },
              spelling: { totalIssues: 0, totalWords: 0 },
              links: { dead: 0 }, w3c: null, krds: null,
              scannedAt: new Date().toISOString()
            }
            if (err.message.includes('ERR_CONNECTION_RESET') || err.message.includes('ERR_CONNECTION_REFUSED')) {
              consecutiveConnErrors++
            }
          }
          // 진행도: null이 아닌 결과 수 기준
          const done = sess.results.filter(r => r !== null).length
          sess.progress = Math.round(done / urlList.length * 100)
        }
      })
      await Promise.allSettled(workers)

      // null 슬롯 제거 (조기 중단된 URL)
      sess.results = sess.results.filter(r => r !== null)

      if (consecutiveConnErrors >= MAX_CONSEC_ERRORS) {
        sess.status = 'aborted'
        sess.abortReason = `연속 ${MAX_CONSEC_ERRORS}회 연결 오류로 중단됨. 이 서버에서 대상 사이트 접속이 차단되었을 수 있습니다.`
        console.warn(`[전체검사중단] ${sess.label} sessionId=${sess.id}`)
      } else {
        sess.status = 'completed'
        console.log(`[전체검사완료] ${sess.label} sessionId=${sess.id} 완료=${sess.completed} 실패=${sess.failed}`)
      }
      sess.finishedAt = new Date().toISOString()
    })(session, urls)

    res.json({
      step,
      totalUrls: allItems.length,
      sessionId,
      message: `${step} 차수 전체 ${allItems.length}개를 단일 세션으로 검사를 시작합니다.`
    })
  } catch (err) {
    console.error('전체 단일 세션 검사 시작 오류:', err.message)
    res.status(500).json({ error: '전체 검사 시작 실패: ' + err.message })
  }
})
// 대상 URL을 W3C 공식 링크 검사기에 전달해 데드/리다이렉트 링크를 수집
async function checkLinksWithW3C(targetUrl) {
  const CHECK_URL = 'https://validator.w3.org/checklink'
  const params = new URLSearchParams({
    uri: targetUrl,
    hide_type: 'all',     // 리다이렉트 숨기기 (broken만 표시)
    depth: '0',           // 해당 페이지만 (recursive 없음)
    check: 'Check',
    _charset_: 'UTF-8',
    summary: 'on',
  })
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 60000)   // 최대 60초
    const resp = await fetch(`${CHECK_URL}?${params.toString()}`, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (A11y-Inspector/1.0; +https://github.com/a11y-inspector)',
        'Accept': 'text/html,application/xhtml+xml'
      }
    })
    clearTimeout(timer)
    const html = await resp.text()

    // HTML 파싱: <dt> 블록에서 링크 정보 추출
    const dead = []
    const redirects = []
    let total = 0

    // 전체 체크된 링크 수 파악
    const checkedMatch = html.match(/Checked\s+(\d+)\s+(?:link|document)/i)
    if (checkedMatch) total = parseInt(checkedMatch[1], 10)

    // broken/error 링크 추출
    // 패턴: <dt>...<span class='msg_loc'>Line: N</span>...<a href="URL">URL</a>...broken...</dt>
    //       <dd>...<strong>Status</strong>: CODE ...</dd>
    const dtBlocks = html.match(/<dt>[\s\S]*?<\/dd>/g) || []
    for (const block of dtBlocks) {
      const lineM   = block.match(/Line:\s*(\d+)/i)
      const urlM    = block.match(/<a href="(https?:\/\/[^"]+)"/)
      const statusM = block.match(/<strong>Status<\/strong>:\s*(\d+)/)
      const msgM    = block.match(/<dd[^>]*class=['"]message_explanation['"][^>]*>([\s\S]*?)<\/dd>/)
      const isBroken   = /broken|not found|cannot|refused|timed out|error/i.test(block)
      const isRedirect = /redirect/i.test(block)
      const redirectToM = block.match(/redirected[^<]*<a href="(https?:\/\/[^"]+)"/)

      const url    = urlM    ? urlM[1].split('"')[0]   : null
      const status = statusM ? parseInt(statusM[1], 10) : null
      const line   = lineM   ? parseInt(lineM[1], 10)   : null
      const msg    = msgM    ? msgM[1].replace(/<[^>]+>/g, '').trim().substring(0, 120) : null

      if (!url) continue

      if (isBroken) {
        dead.push({ url, status, line, error: msg || null, source: targetUrl })
      } else if (isRedirect) {
        redirects.push({
          url,
          status,
          line,
          redirectUrl: redirectToM ? redirectToM[1] : null,
          source: targetUrl
        })
      }
    }

    return {
      engine: 'w3c-checklink',
      checkedAt: new Date().toISOString(),
      dead,
      redirects,
      live: Math.max(0, total - dead.length - redirects.length),
      total,
      totalRaw: total,
      raw: html.length,   // 응답 크기 (디버깅용)
    }
  } catch (e) {
    console.error('[W3C LinkChecker] 오류:', e.message)
    return {
      engine: 'w3c-checklink',
      checkedAt: new Date().toISOString(),
      dead: [], redirects: [], live: 0, total: 0, totalRaw: 0,
      error: e.message
    }
  }
}

// ─── W3C Markup Validation (validator.w3.org/nu/) ──────
// HTML 소스를 받아 W3C nu API에 POST로 전송, JSON 결과 파싱
async function validateW3C(htmlSource, pageUrl) {
  try { const net = await OFFLINE.netStatus(); if (!net.online) return await OFFLINE.validateOffline(htmlSource) } catch (_) {}
  const W3C_API = 'https://validator.w3.org/nu/'
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30000) // 30초 타임아웃

    const res = await fetch(`${W3C_API}?out=json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'User-Agent': 'A11yInspector/1.0 (+https://github.com/loocrd-debug/a11y-inspector)'
      },
      body: htmlSource,
      signal: controller.signal
    })
    clearTimeout(timer)

    if (!res.ok) throw new Error(`W3C API HTTP ${res.status}`)
    const data = await res.json()

    const messages = data.messages || []

    // 타입별 분류
    const errors   = messages.filter(m => m.type === 'error')
    const warnings = messages.filter(m => m.type === 'info' && m.subType === 'warning')
    const infos    = messages.filter(m => m.type === 'info' && m.subType !== 'warning')

    // 오류 심각도별 분류
    const fatal    = errors.filter(m => m.subType === 'fatal')
    const nonFatal = errors.filter(m => m.subType !== 'fatal')

    return {
      valid: errors.length === 0,
      errorCount: errors.length,
      warningCount: warnings.length,
      fatalCount: fatal.length,
      errors: errors.map(m => {
        const ko = koW3C(m.message)
        return {
        type: m.type,
        subType: m.subType || '',
        message: ko.message,
        messageEn: ko.messageEn,
        extract: m.extract || '',
        lastLine: m.lastLine || null,
        lastColumn: m.lastColumn || null,
        firstLine: m.firstLine || null,
        firstColumn: m.firstColumn || null
      }}),
      warnings: warnings.map(m => {
        const ko = koW3C(m.message)
        return {
        type: m.type,
        subType: m.subType || '',
        message: ko.message,
        messageEn: ko.messageEn,
        extract: m.extract || '',
        lastLine: m.lastLine || null,
        lastColumn: m.lastColumn || null
      }}),
      checkedAt: new Date().toISOString(),
      url: pageUrl
    }
  } catch (err) {
    try { const off = await OFFLINE.validateOffline(htmlSource); off.engineNote = 'W3C 접속 실패 → ' + off.engineNote; return off } catch (_) {}
    return {
      valid: null,
      errorCount: 0,
      warningCount: 0,
      fatalCount: 0,
      errors: [],
      warnings: [],
      checkedAt: new Date().toISOString(),
      url: pageUrl,
      error: err.message
    }
  }
}

// ─── 로컬 오탈자 폴백 (오프라인 / Daum 실패 시 사용) ─────
// 인터넷 없이도 자주 틀리는 패턴을 정규식으로 검출합니다.
function localSpellCheck(text) {
  const issues = []
  // [패턴 목록] { pattern, type, suggest }
  const patterns = [
    // 자주 틀리는 맞춤법
    { re: /되요/g,        type: '철자 오류', suggest: '돼요',    tip: '"되어요"의 줄임말은 "돼요"' },
    { re: /안되/g,        type: '철자 오류', suggest: '안 돼',   tip: '"안 되다"는 띄어씀' },
    { re: /왠지/g,        type: '철자 오류', suggest: '왠지',    tip: '"웬지"가 아닌 "왠지"' },
    { re: /웬지/g,        type: '철자 오류', suggest: '왠지',    tip: '"왜인지"의 준말은 "왠지"' },
    { re: /몇일/g,        type: '철자 오류', suggest: '며칠',    tip: '"며칠"이 표준어' },
    { re: /어떻해/g,      type: '철자 오류', suggest: '어떻게 해', tip: '"어떻게 해"로 써야 함' },
    { re: /어떻하/g,      type: '철자 오류', suggest: '어떻게 하', tip: '"어떻게 하"로 써야 함' },
    { re: /할 수 있어요/g, type: '문맥 오류', suggest: null,     tip: '올바른 표현' },
    { re: /로서\b/g,      type: '문맥 오류', suggest: null,     tip: '"로서"(자격)와 "로써"(수단) 구분 필요' },
    { re: /로써\b/g,      type: '문맥 오류', suggest: null,     tip: '"로써"(수단)와 "로서"(자격) 구분 필요' },
    { re: /이에요\b/g,    type: '문맥 오류', suggest: null,     tip: '받침 없는 명사 뒤 → "예요", 받침 있는 → "이에요"' },
    { re: /할께요/g,      type: '철자 오류', suggest: '할게요',  tip: '"할게요"가 올바른 표기' },
    { re: /할꺼/g,        type: '철자 오류', suggest: '할 거',   tip: '"할 거"로 띄어 씀' },
    { re: /됬/g,          type: '철자 오류', suggest: '됐',     tip: '"되었"의 준말은 "됐"' },
    { re: /않해/g,        type: '철자 오류', suggest: '안 해',   tip: '부정은 "안 해"' },
    { re: /알맞은/g,      type: '문맥 오류', suggest: null,     tip: '형용사 → "알맞은" (O), 동사 → "알맞는" (X)' },
    { re: /틀리다\b/g,    type: '문맥 오류', suggest: null,     tip: '"다르다"와 "틀리다" 혼동 주의' },
    // 자주 틀리는 띄어쓰기
    { re: /한번에\b/g,    type: '띄어쓰기',  suggest: '한 번에', tip: '의존명사 "번"은 띄어 씀' },
    { re: /두번\b/g,      type: '띄어쓰기',  suggest: '두 번',   tip: '의존명사 "번"은 띄어 씀' },
    { re: /이상의\b/g,    type: '문맥 오류', suggest: null,      tip: '"이상"과 "초과" 혼동 주의' },
  ]

  const lines = text.split('\n')
  for (const { re, type, suggest, tip } of patterns) {
    re.lastIndex = 0
    let m
    const src = text
    while ((m = re.exec(src)) !== null) {
      const idx = m.index
      const before = src.substring(0, idx)
      const lineNo = before.split('\n').length
      // 컨텍스트: 앞뒤 20자
      const ctxStart = Math.max(0, idx - 20)
      const ctxEnd   = Math.min(src.length, idx + m[0].length + 20)
      const context  = src.substring(ctxStart, ctxEnd).replace(/\n/g, ' ')
      issues.push({
        token:    m[0],
        original: m[0],
        type,
        suggestions: suggest ? [suggest] : [],
        context,
        line: lineNo,
        tip,
        source: 'local'
      })
      // 같은 패턴 최대 5개
      if (issues.filter(i => i.token === m[0]).length >= 5) break
    }
  }
  return issues
}

// ─── KRDS (한국 디지털 서비스 표준) 준수 검사 ────────────
// JSON 외부 규칙(krds-rules.json) 기반으로 동작합니다.
// 규칙 파일이 없으면 KRDS_RULES 내장 배열을 사용합니다.
async function checkKRDS(page, htmlSource, pageUrl) {
  const results = []

  // ── DOM 데이터 수집 (한 번만 evaluate) ───────────────
  const domData = await page.evaluate(() => {
    const doc = document
    const htmlEl = doc.documentElement
    const lang = htmlEl ? htmlEl.getAttribute('lang') || htmlEl.getAttribute('xml:lang') || '' : ''
    const title = doc.title || ''
    const metaCharset = doc.querySelector('meta[charset]')?.getAttribute('charset') ||
                        doc.querySelector('meta[http-equiv="Content-Type"]')?.getAttribute('content') || ''
    const viewport = doc.querySelector('meta[name="viewport"]')?.getAttribute('content') || ''
    const favicon = doc.querySelector('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]')
    const skipLinks = Array.from(doc.querySelectorAll('a[href]')).filter(el => {
      const href = el.getAttribute('href') || ''
      const text = el.textContent?.trim() || ''
      const cls  = el.className || ''
      const id   = el.id || ''
      return href.startsWith('#') && /skip|jump|content|main|본문|바로가기|건너뛰기/i.test(text + cls + id)
    })
    const allText = doc.body?.innerText || ''
    const hasOfficialBanner = /이\s*누리집은\s*대한민국\s*공식\s*전자정부/.test(allText) ||
      !!doc.querySelector('.official-banner, #official-banner, [class*="gov-banner"], [class*="official"]')
    const header = doc.querySelector('header, [role="banner"], #header, .header')
    const footer = doc.querySelector('footer, [role="contentinfo"], #footer, .footer')
    const main   = doc.querySelector('main, [role="main"], #content, #main, .main')
    const nav    = doc.querySelector('nav, [role="navigation"]')
    const h1s    = doc.querySelectorAll('h1')
    const imgs   = Array.from(doc.querySelectorAll('img'))
    const missingAlt = imgs.filter(img => !img.hasAttribute('alt')).map(img => ({
      src: (img.getAttribute('src') || '').substring(0, 80), html: img.outerHTML.substring(0, 120)
    }))
    const inputs = Array.from(doc.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), select, textarea'))
    const noLabel = inputs.filter(inp => {
      const id = inp.id
      if (id && doc.querySelector(`label[for="${id}"]`)) return false
      if (inp.getAttribute('aria-label') || inp.getAttribute('aria-labelledby') || inp.getAttribute('title')) return false
      if (inp.getAttribute('placeholder') && inp.tagName === 'INPUT') return false
      if (inp.closest('label')) return false
      return true
    }).map(inp => ({ html: inp.outerHTML.substring(0, 120) }))
    const newWindowLinks = Array.from(doc.querySelectorAll('a[target="_blank"]'))
    const missingNewWindowWarning = newWindowLinks.filter(el => {
      const text  = el.textContent?.trim() || ''
      const title = el.getAttribute('title') || ''
      const aria  = el.getAttribute('aria-label') || ''
      return !/새\s*창|new\s*window|새\s*탭|new\s*tab/i.test(text + title + aria)
    }).map(el => ({ href: (el.getAttribute('href') || '').substring(0, 80), text: el.textContent?.trim().substring(0, 60) || '' }))
    const breadcrumb   = doc.querySelector('[aria-label*="breadcrumb"], [aria-label*="경로"], .breadcrumb, #breadcrumb, [class*="breadcrumb"], nav ol, nav ul')
    const privacyLink  = Array.from(doc.querySelectorAll('a')).find(a => /개인정보|privacy/i.test((a.textContent?.trim() || '') + (a.getAttribute('href') || '')))
    const copyrightText = /copyright|©|저작권/i.test(allText)
    const searchForm   = doc.querySelector('[role="search"], form[action*="search"], input[type="search"], input[name*="search"], input[name*="query"], input[name*="keyword"]')
    const logoImgs     = Array.from(doc.querySelectorAll('[class*="logo"] img, #logo img, header img, .header img'))
    const logoMissingAlt = logoImgs.filter(img => !img.getAttribute('alt') || img.getAttribute('alt').trim() === '').length
    const allLinks     = Array.from(doc.querySelectorAll('a[href]'))
    const meaninglessLinks = allLinks.filter(a => {
      const t = a.textContent?.trim() || ''
      const aria = a.getAttribute('aria-label') || ''
      if (aria) return false
      return /^(여기|클릭|click\s*here|more|바로가기|자세히|see\s*more|read\s*more)$/i.test(t)
    }).map(a => ({ text: a.textContent?.trim().substring(0, 60) || '', href: (a.getAttribute('href') || '').substring(0, 80) }))
    const tables = Array.from(doc.querySelectorAll('table'))
    const tablesWithoutHeader = tables.filter(t => !t.querySelector('th')).length
    const iframes = Array.from(doc.querySelectorAll('iframe'))
    const iframesMissingTitle = iframes.filter(f => !f.getAttribute('title') && !f.getAttribute('aria-label')).map(f => ({ src: (f.getAttribute('src') || '').substring(0, 80) }))
    return {
      lang, title, metaCharset, viewport,
      hasResponsiveViewport: /width=device-width/i.test(viewport),
      hasFavicon: !!favicon,
      skipLinksCount: skipLinks.length,
      hasOfficialBanner,
      hasHeader: !!header, hasFooter: !!footer, hasMain: !!main, hasNav: !!nav,
      h1Count: h1s.length, imgsTotal: imgs.length, missingAlt,
      noLabel, missingNewWindowWarning: missingNewWindowWarning.slice(0, 10),
      hasBreadcrumb: !!breadcrumb, hasPrivacyLink: !!privacyLink,
      hasCopyright: copyrightText, hasSearch: !!searchForm,
      logoMissingAlt, meaninglessLinks: meaninglessLinks.slice(0, 10),
      tablesWithoutHeader, tablesTotal: tables.length,
      iframesMissingTitle: iframesMissingTitle.slice(0, 5),
      // KRDS 컴포넌트 기반 검사
      krdsButtonName:    Array.from(doc.querySelectorAll('button,[role="button"]')).filter(el=>!el.textContent.trim()&&!el.getAttribute('aria-label')&&!el.getAttribute('aria-labelledby')).length,
      krdsButtonDisabled:Array.from(doc.querySelectorAll('button[disabled]')).filter(el=>!el.getAttribute('aria-disabled')).length,
      krdsLinkName:      Array.from(doc.querySelectorAll('a[href]')).filter(el=>!el.textContent.trim()&&!el.getAttribute('aria-label')&&!el.getAttribute('aria-labelledby')).length,
      krdsLinkExternal:  Array.from(doc.querySelectorAll('a[target="_blank"]')).filter(el=>!/새창|새 창|new window/i.test(el.textContent+(el.getAttribute('aria-label')||''))).length,
      krdsTabRole:       doc.querySelectorAll('[role="tablist"]').length,
      krdsTabAria:       Array.from(doc.querySelectorAll('[role="tab"]')).filter(el=>!el.hasAttribute('aria-selected')).length,
      krdsBadgeText:     Array.from(doc.querySelectorAll('.badge,[class*="badge"]')).filter(el=>el.textContent.trim().match(/^\d+$/)&&!el.getAttribute('aria-label')).length,
      krdsInputLabel:    Array.from(doc.querySelectorAll('input[type="checkbox"],input[type="radio"]')).filter(el=>{const id=el.id;return !id||!doc.querySelector('label[for="'+id+'"]');}).length,
      krdsInputRole:     Array.from(doc.querySelectorAll('[class*="checkbox"],[class*="toggle"],[class*="switch"]')).filter(el=>el.tagName!=='INPUT'&&!el.getAttribute('role')).length,
      krdsAlertRole:     Array.from(doc.querySelectorAll('.alert,.notice,[class*="alert"],[class*="notice"]')).filter(el=>!el.getAttribute('role')).length,
      krdsHeaderNav:     doc.querySelectorAll('header nav,header [role="navigation"],#header nav').length,
      krdsSkipNav:       Array.from(doc.querySelectorAll('a[href^="#"]')).filter(el=>/건너뛰기|skip|주요|본문/i.test(el.textContent)).length,
    }
  })

  // ── DOM 데이터를 domCheck 키로 매핑 ─────────────────
  const checkMap = {
    lang:              () => ({ passed: !!(domData.lang && /^ko|en|ja|zh/.test(domData.lang)), detail: domData.lang ? `lang="${domData.lang}"` : 'lang 속성 없음' }),
    title:             () => ({ passed: !!(domData.title && domData.title.trim().length > 0), detail: domData.title ? `"${domData.title.substring(0, 60)}"` : 'title 없음' }),
    charset:           () => ({ passed: /utf-?8/i.test(domData.metaCharset), detail: domData.metaCharset || '선언 없음' }),
    viewport:          () => ({ passed: !!domData.viewport, detail: domData.viewport || '없음' }),
    responsiveViewport:() => ({ passed: domData.hasResponsiveViewport, detail: domData.hasResponsiveViewport ? 'width=device-width 포함' : 'width=device-width 미설정' }),
    favicon:           () => ({ passed: domData.hasFavicon, detail: domData.hasFavicon ? '파비콘 있음' : '파비콘 없음' }),
    skipNav:           () => ({ passed: domData.skipLinksCount > 0, detail: domData.skipLinksCount > 0 ? `${domData.skipLinksCount}개 발견` : '건너뛰기 링크 없음' }),
    officialBanner:    () => ({ passed: domData.hasOfficialBanner, detail: domData.hasOfficialBanner ? '공식 배너 있음' : '공식 배너 없음' }),
    header:            () => ({ passed: domData.hasHeader, detail: domData.hasHeader ? 'header 요소 있음' : 'header 요소 없음' }),
    footer:            () => ({ passed: domData.hasFooter, detail: domData.hasFooter ? 'footer 요소 있음' : 'footer 요소 없음' }),
    main:              () => ({ passed: domData.hasMain, detail: domData.hasMain ? 'main 요소 있음' : 'main 요소 없음' }),
    nav:               () => ({ passed: domData.hasNav, detail: domData.hasNav ? 'nav 요소 있음' : 'nav 요소 없음' }),
    h1:                () => { const ok = domData.h1Count === 1; return { passed: ok, detail: domData.h1Count === 0 ? 'h1 없음' : domData.h1Count === 1 ? 'h1 1개 (정상)' : `h1 ${domData.h1Count}개 (중복)` } },
    imgAlt:            () => { const ok = domData.missingAlt.length === 0; return { passed: ok, detail: ok ? `전체 ${domData.imgsTotal}개 alt 누락 없음` : `alt 누락 ${domData.missingAlt.length}개/${domData.imgsTotal}개` } },
    formLabel:         () => { const ok = domData.noLabel.length === 0; return { passed: ok, detail: ok ? '모든 폼 요소에 레이블 연결됨' : `레이블 없는 폼 ${domData.noLabel.length}개` } },
    newWindow:         () => { const ok = domData.missingNewWindowWarning.length === 0; return { passed: ok, detail: ok ? '새 창 링크 모두 안내 있음' : `안내 없는 새 창 링크 ${domData.missingNewWindowWarning.length}개` } },
    breadcrumb:        () => ({ passed: domData.hasBreadcrumb, detail: domData.hasBreadcrumb ? '브레드크럼 있음' : '브레드크럼 없음' }),
    privacy:           () => ({ passed: domData.hasPrivacyLink, detail: domData.hasPrivacyLink ? '개인정보처리방침 링크 있음' : '개인정보처리방침 링크 없음' }),
    copyright:         () => ({ passed: domData.hasCopyright, detail: domData.hasCopyright ? '저작권 표시 있음' : '저작권 표시 없음' }),
    search:            () => ({ passed: domData.hasSearch, detail: domData.hasSearch ? '검색 기능 있음' : '검색 기능 없음' }),
    logoAlt:           () => ({ passed: domData.logoMissingAlt === 0, detail: domData.logoMissingAlt > 0 ? `로고 이미지 alt 없음 ${domData.logoMissingAlt}개` : '로고 alt 적절히 설정됨' }),
    linkText:          () => { const ok = domData.meaninglessLinks.length === 0; return { passed: ok, detail: ok ? '비의미적 링크 없음' : `비의미적 링크 ${domData.meaninglessLinks.length}개 (예: "${domData.meaninglessLinks[0]?.text}")` } },
    tableHeader:       () => { if (domData.tablesTotal === 0) return null; const ok = domData.tablesWithoutHeader === 0; return { passed: ok, detail: ok ? `전체 table ${domData.tablesTotal}개 모두 th 있음` : `th 없는 table ${domData.tablesWithoutHeader}개/${domData.tablesTotal}개` } },
    iframeTitle:       () => { if (domData.iframesMissingTitle.length === 0) return null; return { passed: false, detail: `title 없는 iframe ${domData.iframesMissingTitle.length}개` } },
    // KRDS 컴포넌트
    krdsButtonName:    () => { const n=domData.krdsButtonName||0; return { passed:n===0, detail:n===0?'모든 버튼에 접근 가능한 이름 있음':`이름 없는 버튼 ${n}개` } },
    krdsButtonDisabled:() => { const n=domData.krdsButtonDisabled||0; if(!n) return null; return { passed:false, detail:`aria-disabled 없는 disabled 버튼 ${n}개` } },
    krdsLinkName:      () => { const n=domData.krdsLinkName||0; return { passed:n===0, detail:n===0?'모든 링크에 이름 있음':`이름 없는 링크 ${n}개` } },
    krdsLinkExternal:  () => { const n=domData.krdsLinkExternal||0; if(!n) return null; return { passed:false, detail:`새창 안내 없는 외부 링크 ${n}개` } },
    krdsTabRole:       () => { const n=domData.krdsTabRole||0; if(!n) return null; return { passed:true, detail:`tablist ${n}개 발견` } },
    krdsTabAria:       () => { const n=domData.krdsTabAria||0; if(!domData.krdsTabRole) return null; return { passed:n===0, detail:n===0?'탭 aria-selected 정상':`aria-selected 없는 탭 ${n}개` } },
    krdsBadgeText:     () => { const n=domData.krdsBadgeText||0; if(!n) return null; return { passed:false, detail:`aria-label 없는 숫자 배지 ${n}개` } },
    krdsInputLabel:    () => { const n=domData.krdsInputLabel||0; return { passed:n===0, detail:n===0?'입력 요소 레이블 정상':`레이블 없는 입력 ${n}개` } },
    krdsInputRole:     () => { const n=domData.krdsInputRole||0; if(!n) return null; return { passed:false, detail:`role 없는 커스텀 입력 ${n}개` } },
    krdsAlertRole:     () => { const n=domData.krdsAlertRole||0; if(!n) return null; return { passed:false, detail:`role 없는 알림 영역 ${n}개` } },
    krdsHeaderNav:     () => { const n=domData.krdsHeaderNav||0; return { passed:n>0, detail:n>0?`헤더 내비게이션 ${n}개 있음`:'헤더 내 nav 없음' } },
    krdsSkipNav:       () => { const n=domData.krdsSkipNav||0; return { passed:n>0, detail:n>0?`건너뛰기 링크 ${n}개 있음`:'건너뛰기 링크 없음' } },
  }

  // ── 규칙 순회: JSON 파일 규칙 or 내장 규칙 ──────────
  const activeRules = KRDS_RULES.length > 0 ? KRDS_RULES : getBuiltinKrdsRules()
  for (const rule of activeRules) {
    const checker = checkMap[rule.domCheck]
    if (!checker) continue
    const res = checker()
    if (res === null) continue  // 해당 요소 없는 경우 건너뜀
    results.push({
      id:        rule.id,
      category:  rule.category,
      name:      rule.name,
      level:     rule.level,
      passed:    res.passed,
      detail:    res.detail,
      recommend: rule.recommend || '',
    })
  }

  // ── 결과 집계 ──────────────────────────────────────────
  const passed      = results.filter(r => r.passed === true).length
  const failed      = results.filter(r => r.passed === false).length
  const total       = results.length
  const score       = total > 0 ? Math.round((passed / total) * 100) : 0
  const mandatory   = results.filter(r => r.level === '필수')
  const recommended = results.filter(r => r.level === '권장')
  return {
    checkedAt: new Date().toISOString(),
    url: pageUrl,
    score, passed, failed, total,
    mandatory:   { total: mandatory.length,   passed: mandatory.filter(r => r.passed).length },
    recommended: { total: recommended.length, passed: recommended.filter(r => r.passed).length },
    items: results
  }
}

// 내장 KRDS 규칙 (krds-rules.json 없을 때 사용)
function getBuiltinKrdsRules() {
  return [
    { id:'lang',               category:'기본 구조',    name:'HTML lang 속성',          level:'필수', domCheck:'lang',               recommend:'html 태그에 lang="ko" 추가 필요' },
    { id:'title',              category:'기본 구조',    name:'페이지 title 태그',        level:'필수', domCheck:'title',              recommend:'의미있는 title 설정 필요' },
    { id:'charset',            category:'기본 구조',    name:'문자셋(charset) 선언',     level:'필수', domCheck:'charset',            recommend:'meta charset="UTF-8" 선언 필요' },
    { id:'viewport',           category:'기본 구조',    name:'viewport 메타 태그',       level:'필수', domCheck:'viewport',           recommend:'meta name="viewport" 추가 필요' },
    { id:'responsive-viewport',category:'기본 구조',    name:'반응형 viewport 설정',     level:'권장', domCheck:'responsiveViewport', recommend:'width=device-width 포함 권장' },
    { id:'favicon',            category:'아이덴티티',   name:'파비콘(favicon)',           level:'권장', domCheck:'favicon',            recommend:'link rel="icon" 설정 권장' },
    { id:'skip-nav',           category:'접근성·탐색',  name:'건너뛰기 링크',             level:'필수', domCheck:'skipNav',            recommend:'본문 바로가기 링크 추가 필요 (WCAG 2.4.1)' },
    { id:'official-banner',    category:'아이덴티티',   name:'대한민국 공식 전자정부 배너', level:'필수', domCheck:'officialBanner',    recommend:'공식 전자정부 배너 추가 필요' },
    { id:'header',             category:'레이아웃·구조', name:'헤더(header) 영역',        level:'필수', domCheck:'header',             recommend:'header 태그 또는 role="banner" 추가 필요' },
    { id:'footer',             category:'레이아웃·구조', name:'푸터(footer) 영역',        level:'필수', domCheck:'footer',             recommend:'footer 태그 또는 role="contentinfo" 추가 필요' },
    { id:'main',               category:'레이아웃·구조', name:'메인 콘텐츠 영역(main)',   level:'권장', domCheck:'main',               recommend:'main 태그 또는 role="main" 추가 권장' },
    { id:'nav',                category:'탐색',         name:'내비게이션(nav) 요소',      level:'권장', domCheck:'nav',                recommend:'nav 태그 또는 role="navigation" 추가 권장' },
    { id:'h1',                 category:'콘텐츠 구조',  name:'H1 제목 태그 (1개)',        level:'필수', domCheck:'h1',                 recommend:'h1 태그는 페이지당 정확히 1개여야 함' },
    { id:'img-alt',            category:'접근성·콘텐츠', name:'이미지 alt 속성',          level:'필수', domCheck:'imgAlt',             recommend:'모든 의미있는 이미지에 alt 속성 추가 필요 (WCAG 1.1.1)' },
    { id:'form-label',         category:'접근성·입력',  name:'폼 요소 레이블 연결',       level:'필수', domCheck:'formLabel',          recommend:'label[for] 또는 aria-label 연결 필요 (WCAG 1.3.1)' },
    { id:'new-window',         category:'접근성·탐색',  name:'새 창 열림 안내',           level:'권장', domCheck:'newWindow',          recommend:'target="_blank" 링크에 새 창 안내 필요' },
    { id:'breadcrumb',         category:'탐색',         name:'브레드크럼(현재위치) 표시', level:'권장', domCheck:'breadcrumb',         recommend:'현재 위치 브레드크럼 제공 권장' },
    { id:'privacy',            category:'법적 준수',    name:'개인정보처리방침 링크',     level:'필수', domCheck:'privacy',            recommend:'개인정보처리방침 링크 제공 필요 (전자정부법)' },
    { id:'copyright',          category:'법적 준수',    name:'저작권(copyright) 표시',   level:'권장', domCheck:'copyright',          recommend:'저작권 표시 권장' },
    { id:'search',             category:'탐색',         name:'검색 기능',                 level:'권장', domCheck:'search',             recommend:'검색 기능 제공 권장' },
    { id:'logo-alt',           category:'아이덴티티',   name:'로고 이미지 alt 텍스트',    level:'권장', domCheck:'logoAlt',            recommend:'헤더 로고에 기관명 alt 텍스트 설정 권장' },
    { id:'link-text',          category:'접근성·탐색',  name:'링크 텍스트 의미성',        level:'권장', domCheck:'linkText',           recommend:'비의미적 링크 텍스트 개선 권장' },
    { id:'table-header',       category:'접근성·콘텐츠', name:'표(table) 헤더 th 사용',  level:'권장', domCheck:'tableHeader',        recommend:'데이터 테이블에 th 헤더 구분 필요' },
    { id:'iframe-title',       category:'접근성',       name:'iframe title 속성',         level:'권장', domCheck:'iframeTitle',        recommend:'iframe에 title 속성 필요 (WCAG 4.1.2)' },

    // ── KRDS Figma 컴포넌트 기반 추가 규칙 ──────────────────
    // Button 컴포넌트 (KRDS: Primary/Secondary/Tertiary 버튼 접근성)
    { id:'krds-btn-name',      category:'KRDS 컴포넌트', name:'버튼 접근 가능한 이름',      level:'필수', domCheck:'krdsButtonName',     recommend:'KRDS Button: 모든 button/role=button 에 텍스트 또는 aria-label 필요' },
    { id:'krds-btn-disabled',  category:'KRDS 컴포넌트', name:'비활성 버튼 aria-disabled',  level:'권장', domCheck:'krdsButtonDisabled',  recommend:'KRDS Button Disabled 상태: disabled 대신 aria-disabled="true" 사용 권장' },

    // Link 컴포넌트 (KRDS: 링크 접근성)
    { id:'krds-link-name',     category:'KRDS 컴포넌트', name:'링크 접근 가능한 이름',      level:'필수', domCheck:'krdsLinkName',        recommend:'KRDS Link: 모든 a 태그에 텍스트 또는 aria-label 필요' },
    { id:'krds-link-external', category:'KRDS 컴포넌트', name:'외부 링크 새창 안내',        level:'권장', domCheck:'krdsLinkExternal',    recommend:'KRDS Link: target=_blank 링크에 "(새창)" 또는 aria-label 안내 필요' },

    // Tab 컴포넌트 (KRDS: 탭 접근성)
    { id:'krds-tab-role',      category:'KRDS 컴포넌트', name:'탭 role 속성',               level:'필수', domCheck:'krdsTabRole',         recommend:'KRDS Tab: tablist/tab/tabpanel role 구조 필요' },
    { id:'krds-tab-aria',      category:'KRDS 컴포넌트', name:'탭 aria-selected 상태',      level:'필수', domCheck:'krdsTabAria',         recommend:'KRDS Tab: 활성 탭에 aria-selected="true" 필요' },

    // Badge 컴포넌트 (KRDS: 배지 접근성)
    { id:'krds-badge-text',    category:'KRDS 컴포넌트', name:'배지 스크린리더 텍스트',     level:'권장', domCheck:'krdsBadgeText',        recommend:'KRDS Badge: 숫자/아이콘만 있는 배지에 aria-label 또는 sr-only 텍스트 권장' },

    // Checkbox/Toggle (KRDS: 입력 컴포넌트 접근성)
    { id:'krds-input-label',   category:'KRDS 컴포넌트', name:'입력 요소 레이블 연결',      level:'필수', domCheck:'krdsInputLabel',       recommend:'KRDS Checkbox/Toggle: input에 연결된 label 또는 aria-label 필요' },
    { id:'krds-input-role',    category:'KRDS 컴포넌트', name:'커스텀 입력 role 속성',      level:'권장', domCheck:'krdsInputRole',        recommend:'KRDS 커스텀 Checkbox/Toggle: role="checkbox" 및 aria-checked 속성 권장' },

    // Alert/Infobox (KRDS: 알림 접근성)
    { id:'krds-alert-role',    category:'KRDS 컴포넌트', name:'알림 영역 role 속성',        level:'권장', domCheck:'krdsAlertRole',        recommend:'KRDS Alert: role="alert" 또는 role="status" 속성 권장' },

    // Header (KRDS: 헤더 구조)
    { id:'krds-header-nav',    category:'KRDS 컴포넌트', name:'헤더 내비게이션 landmark',   level:'권장', domCheck:'krdsHeaderNav',        recommend:'KRDS Header: 주 내비게이션에 <nav> 또는 role="navigation" 필요' },
    { id:'krds-skip-nav',      category:'KRDS 컴포넌트', name:'건너뛰기 링크 가시성',       level:'권장', domCheck:'krdsSkipNav',          recommend:'KRDS Header: 건너뛰기 링크가 포커스 시 visible 상태여야 함' },
  ]
}

// 단일 페이지 스캔 (배치용 내부 함수)
async function scanSinglePage(url, options = {}) {
  const {
    level = 'wcag2aa',
    includeScreenshot = true,
    checkSpelling = true,
    checkLinks = false,
    useW3CLinks = false,      // W3C Link Checker 사용 여부
    checkW3C = false,
    containerOnly = false,    // true: <!-- cont-inner info-detail// --> 영역만 검사
    excludeCommon = false,    // 컨테이너만 검사 (헤더/푸터/네비 제외)
    checkKRDS: doCheckKRDS = false,  // KRDS 준수 검사 여부
    scanMode = 'professional',       // 'simple'(간편) | 'professional'(전문가)
  } = options
  
  let poolSlot = null
  let page = null
  try {
    // 브라우저 풀에서 인스턴스 획득
    poolSlot = await browserPool.acquire()
    const browser = poolSlot.browser
    page = await browser.newPage()
    // 간편 로그인 세션 쿠키 자동 주입 (v4.5)
    if (typeof loginSession !== 'undefined' && loginSession && loginSession.storageState && loginSession.storageState.cookies.length) {
      try { await page.context().addCookies(loginSession.storageState.cookies) } catch(_) {}
    }
    await page.setViewportSize({ width: 1280, height: 900 })

    // 이미지·폰트·미디어 차단 → 로드 속도 향상 (스크린샷 필요 시 이미지는 허용)
    // file:// 로컬파일은 광고/트래킹 차단 불필요, 나머지만 차단
    const isLocal = url.startsWith('file://')
    if (!includeScreenshot) {
      await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2,ttf,eot,mp4,mp3,pdf,flv,avi,mov,swf}', r => r.abort())
      if (!isLocal) await page.route('**/{gtag,analytics,ga,fbq,hotjar,clarity,matomo,pixel,beacon,telemetry}*', r => r.abort())
    } else {
      await page.route('**/*.{woff,woff2,ttf,eot,mp4,mp3,pdf,flv,avi,mov,swf}', r => r.abort())
    }
    if (!isLocal) {
      // 광고/트래킹 도메인 차단 (공통, 외부 URL만)
      await page.route('**/{doubleclick,googlesyndication,adservice,adsystem,moatads,scorecardresearch,quantserve,chartbeat,adnxs}**', r => r.abort())
    }

    const gotoTimeout = isLocal ? 10000 : 20000
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: gotoTimeout })

    // 페이지 타이틀 안전하게 취득 (리다이렉션 후에도 유효)
    let pageTitle = ''
    let pageUrl = url
    try {
      pageTitle = await page.title()
      try { pageUrl = decodeURIComponent(page.url()) } catch(_) { pageUrl = page.url() }
    } catch (e) {
      // 리다이렉션으로 context 파괴된 경우 URL만 유지
      pageUrl = url
    }

    // 스크린샷
    let screenshotBase64 = null
    if (includeScreenshot) {
      const buf = await page.screenshot({ fullPage: false, type: 'png' })
      screenshotBase64 = buf.toString('base64')
    }

    // 접근성 검사 — /api/scan과 동일한 모드 분기 적용
    await page.addScriptTag({ content: AXE_SOURCE })
    const SIMPLE_RULES_SCAN = [
      'image-alt','input-image-alt','button-name','link-name','label',
      'document-title','html-has-lang','color-contrast','skip-link',
      'heading-order','list','frame-title','duplicate-id-aria','meta-viewport','video-caption',
    ]
    const axeResults = await page.evaluate(async ([runLevel, mode, simpleRules, exCommon]) => {
      const opts = { reporter: 'v2' }
      if (mode === 'simple') {
        opts.runOnly = { type: 'rule', values: simpleRules }
      } else {
        if (runLevel === 'wcag2a') {
          opts.runOnly = { type: 'tag', values: ['wcag2a', 'best-practice'] }
        } else if (runLevel === 'wcag2aa') {
          opts.runOnly = { type: 'tag', values: ['wcag2a', 'wcag2aa', 'best-practice'] }
        } else if (runLevel === 'wcag2aaa') {
          opts.runOnly = { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag2aaa', 'best-practice'] }
        }
      }
      // 컨테이너만 검사: 공통영역(헤더/푸터/네비) DOM 제외
      const ctx = exCommon
        ? { exclude: [['header'],['footer'],['nav'],['aside'],['[role="banner"]'],['[role="contentinfo"]'],['[role="navigation"]'],['#header'],['#footer'],['#gnb'],['.header'],['.footer'],['.gnb'],['#skip'],['.skip-nav']] }
        : document
      return await window.axe.run(ctx, opts)
    }, [level, scanMode, SIMPLE_RULES_SCAN, excludeCommon])

    // ── HTML 소스 취득 (줄번호 계산 + W3C 검사 공유) ────
    const htmlSource = await page.content()
    const htmlLines  = htmlSource.split('\n')

    // violations + incomplete(검토필요) 모두 포함
    const mapNode = (n) => ({
      html: n.html,
      failureSummary: n.failureSummary,
      target: n.target,
      line: findHtmlLineNumber(n.html, htmlLines),
      pageUrl,
    })
    const violations = axeResults.violations.map(v => {
      const ko = koAxe(v.id, v.help, v.description)
      return {
      id: v.id, impact: v.impact, description: ko.description,
      help: ko.help, helpEn: ko.helpEn, helpUrl: v.helpUrl, tags: v.tags,
      pageUrl, resultType: 'violation',
      nodes: v.nodes.map(mapNode)
    }})
    const incompleteItems = axeResults.incomplete.map(v => {
      const ko = koAxe(v.id, v.help, v.description)
      return {
      id: v.id, impact: v.impact || 'needs-review', description: ko.description,
      help: ko.help, helpEn: ko.helpEn, helpUrl: v.helpUrl, tags: v.tags,
      pageUrl, resultType: 'incomplete',
      nodes: v.nodes.map(mapNode)
    }})
    const passes = axeResults.passes.length
    const incomplete = axeResults.incomplete.length
    const inapplicable = axeResults.inapplicable.length
    const impactCounts = { critical: 0, serious: 0, moderate: 0, minor: 0, needsReview: 0 }
    violations.forEach(v => { if (v.impact && v.impact !== 'needs-review') impactCounts[v.impact] = (impactCounts[v.impact] || 0) + 1 })
    impactCounts.needsReview = incomplete
    const allFindings = [...violations, ...incompleteItems]
    // score는 하위 호환성용 (UI 미표시)
    const _total2 = violations.length + passes
    const score = _total2 > 0 ? Math.max(0, Math.round(100 - ((impactCounts.critical*10 + impactCounts.serious*5 + impactCounts.moderate*2 + impactCounts.minor*1) / _total2 * 100))) : 100

    // 오탈자 검사 (Daum 맞춤법 검사기)
    // containerOnly=true 이면 <!-- cont-inner info-detail// --> 주석 사이 HTML만 검사
    let spellingResult = { issues: [], totalWords: 0, checkedAt: new Date().toISOString() }
    if (checkSpelling) {
      let pageLines
      if (containerOnly) {
        // HTML 소스에서 컨테이너 영역 추출 후 텍스트 파싱
        pageLines = await page.evaluate((src) => {
          // <!-- cont-inner info-detail// --> 주석 사이 내용 추출
          const m = src.match(/<!--\s*cont-inner\s+info-detail[^>]*?-->([\s\S]*?)<!--\s*cont-inner\s+info-detail[^>]*?\/\/\s*-->/)
          const region = m ? m[1] : src
          // 임시 div에 파싱해 텍스트 추출
          const div = document.createElement('div')
          div.innerHTML = region
          // NodeFilter 객체 직렬화 문제 회피: 세 번째 인자 없이 SHOW_TEXT만 사용 후 직접 필터
          const SKIP_TAGS = new Set(['script','style','noscript','code','pre'])
          const walker = document.createTreeWalker(div, 0x4 /* NodeFilter.SHOW_TEXT */)
          const texts = []
          let n
          while ((n = walker.nextNode())) {
            const tag = n.parentElement?.tagName?.toLowerCase()
            if (SKIP_TAGS.has(tag)) continue
            const t = n.textContent.trim()
            if (t.length > 1) texts.push(t)
          }
          return texts
        }, htmlSource)
      } else {
        pageLines = await page.evaluate(() => {
          if (!document.body) return []
          // NodeFilter 객체 직렬화 문제 회피: 세 번째 인자 없이 SHOW_TEXT만 사용 후 직접 필터
          const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'code', 'pre'])
          const walker = document.createTreeWalker(document.body, 0x4 /* NodeFilter.SHOW_TEXT */)
          const texts = []
          let n
          while ((n = walker.nextNode())) {
            const tag = n.parentElement?.tagName?.toLowerCase()
            if (SKIP_TAGS.has(tag)) continue
            const t = n.textContent.trim()
            if (t.length > 1) texts.push(t)
          }
          return texts
        })
      }

      const fullText = pageLines.join('\n')
      const wordCount = fullText.split(/\s+/).filter(w => w.length > 0).length

      const CHUNK_SIZE = 1500
      const MAX_CHUNKS = containerOnly ? 2 : 5   // 컨테이너만 모드는 청크 더 적게
      const chunks = []
      let lineOffset = 0
      let buf = []
      let bufLen = 0
      for (const line of pageLines) {
        if (bufLen + line.length + 1 > CHUNK_SIZE && buf.length > 0) {
          chunks.push({ text: buf.join('\n'), lineOffset })
          lineOffset += buf.length
          buf = []
          bufLen = 0
          if (chunks.length >= MAX_CHUNKS) break
        }
        buf.push(line)
        bufLen += line.length + 1
      }
      if (buf.length > 0 && chunks.length < MAX_CHUNKS) chunks.push({ text: buf.join('\n'), lineOffset })

      let koIssues = []
      let spellEngine2 = 'daum'
      try {
        koIssues = await checkDaumSpelling(chunks, pageUrl, browser)
      } catch (e) {
        console.warn('[오탈자] Daum 검사 실패, 로컬 폴백 사용:', e.message)
        spellEngine2 = 'local'
        koIssues = localSpellCheck(fullText)
      }
      spellingResult = {
        issues: koIssues.slice(0, 100),
        totalWords: wordCount,
        totalIssues: koIssues.length,
        koreanIssues: koIssues.length,
        engine: spellEngine2,
        engineNote: spellEngine2 === 'local' ? '오프라인 모드 (Daum 연결 실패)' : null,
        containerOnly,
        checkedAt: new Date().toISOString()
      }
    }


    // 데드링크 검사
    let linkResult = { dead: [], redirects: [], live: 0, total: 0, checkedAt: new Date().toISOString() }
    if (checkLinks) {
      if (useW3CLinks) {
        // ── W3C Link Checker 사용 ─────────────────────
        // containerOnly=true 이면 컨테이너 영역의 링크만 추출하여 개별 검사
        if (containerOnly) {
          const containerLinks = await page.evaluate((src) => {
            const m = src.match(/<!--\s*cont-inner\s+info-detail[^>]*?-->([\s\S]*?)<!--\s*cont-inner\s+info-detail[^>]*?\/\/\s*-->/)
            const region = m ? m[1] : ''
            if (!region) return []
            const div = document.createElement('div')
            div.innerHTML = region
            const links = []
            div.querySelectorAll('a[href]').forEach(el => {
              const href = el.getAttribute('href')
              const text = el.textContent?.trim().substring(0, 60) || ''
              if (href && /^https?:/.test(href)) links.push({ href, text })
            })
            return links
          }, htmlSource)
          const w3cFull = await checkLinksWithW3C(pageUrl)
          const containerHrefs = new Set(containerLinks.map(l => l.href))
          const filterByContainer = (arr) => containerHrefs.size
            ? arr.filter(item => containerHrefs.has(item.url))
            : arr
          linkResult = {
            ...w3cFull,
            dead: filterByContainer(w3cFull.dead),
            redirects: filterByContainer(w3cFull.redirects),
            containerOnly: true
          }
        } else {
          linkResult = await checkLinksWithW3C(pageUrl)
        }
      } else {
        // ── 내장 HEAD/GET 검사 ─────────────────────────
        // containerOnly=true 이면 컨테이너 영역의 링크만 수집
        let rawLinks
        if (containerOnly) {
          rawLinks = await page.evaluate((src) => {
            const m = src.match(/<!--\s*cont-inner\s+info-detail[^>]*?-->([\s\S]*?)<!--\s*cont-inner\s+info-detail[^>]*?\/\/\s*-->/)
            const region = m ? m[1] : ''
            if (!region) return []
            const div = document.createElement('div')
            div.innerHTML = region
            const links = []
            div.querySelectorAll('a[href]').forEach(el => {
              const href = el.getAttribute('href')
              const text = el.textContent?.trim().substring(0, 60) || ''
              if (href) links.push({ href, text })
            })
            return links
          }, htmlSource)
        } else {
          rawLinks = await page.evaluate(() => {
            const links = []
            document.querySelectorAll('a[href], link[href]').forEach(el => {
              const href = el.getAttribute('href')
              const text = el.textContent?.trim().substring(0, 60) || el.tagName
              if (href) links.push({ href, text })
            })
            return links
          })
        }
        const resolvedLinks = rawLinks
          .map(l => ({ ...l, resolved: normalizeUrl(l.href, pageUrl) }))
          .filter(l => l.resolved !== null)
        const uniqueUrls = [...new Set(resolvedLinks.map(l => l.resolved))]
        const linkTextMap = {}
        resolvedLinks.forEach(l => { if (!linkTextMap[l.resolved]) linkTextMap[l.resolved] = l.text })
        const { results, total } = await checkDeadLinks(uniqueUrls, pageUrl, page)
        const dead = results.filter(r => !r.ok).map(r => ({ ...r, text: linkTextMap[r.url] || '' }))
        const redirects = results.filter(r => r.ok && r.redirectUrl).map(r => ({ ...r, text: linkTextMap[r.url] || '' }))
        const live = results.filter(r => r.ok).length
        linkResult = { engine: 'internal', dead, redirects, live, total, totalRaw: rawLinks.length, containerOnly, checkedAt: new Date().toISOString() }
      }
    }

    // ── W3C Markup Validation ──────────────────────────
    let w3cResult = { valid: null, errorCount: 0, warningCount: 0, fatalCount: 0, errors: [], warnings: [] }
    if (checkW3C) {
      // htmlSource는 이미 위에서 취득
      w3cResult = await validateW3C(htmlSource, pageUrl)
    }

    // ── KRDS 준수 검사 ─────────────────────────────────
    let krdsResult = null
    if (doCheckKRDS) {
      try {
        krdsResult = await checkKRDS(page, htmlSource, pageUrl)
        try { await KRDS_DEEP.applyDeep(page, krdsResult) } catch (_) {}
      } catch (e) {
        console.error('[KRDS] 검사 오류:', e.message)
        krdsResult = { error: e.message, score: 0, passed: 0, failed: 0, total: 0, items: [] }
      }
    }

    await page.close()
    await browserPool.release(poolSlot)
    poolSlot = null

    return {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      scannedAt: new Date().toISOString(),
      url: pageUrl,
      originalUrl: url,
      pageTitle,
      level,
      score,
      summary: { violations: violations.length, passes, incomplete, inapplicable, impactCounts },
      violations,
      passes: (axeResults.passes || []).map(p => ({ id: p.id })),
      screenshot: screenshotBase64,
      spelling: spellingResult,
      links: linkResult,
      w3c: w3cResult,
      krds: krdsResult,
      status: 'completed'
    }
  } catch (err) {
    if (page) await page.close().catch(() => {})
    if (poolSlot) await browserPool.release(poolSlot).catch(() => {})
    // 연결 오류 메시지 친절하게 변환
    let errMsg = err.message
    if (errMsg.includes('ERR_CONNECTION_RESET'))  errMsg = '페이지 연결이 끊어졌습니다 (서버가 연결을 재설정했습니다)'
    else if (errMsg.includes('ERR_CONNECTION_REFUSED')) errMsg = '서버가 연결을 거부했습니다 (사이트가 다운되었을 수 있습니다)'
    else if (errMsg.includes('ERR_NAME_NOT_RESOLVED')) errMsg = 'DNS 조회 실패 (URL을 확인해주세요)'
    else if (errMsg.includes('Timeout') || errMsg.includes('timeout')) errMsg = '페이지 로딩 시간 초과 (20초) — 사이트가 느리거나 응답하지 않습니다'
    else if (errMsg.includes('Execution context was destroyed')) errMsg = '페이지 이동 중 컨텍스트가 변경되었습니다 (리다이렉션 발생)'
    return {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      scannedAt: new Date().toISOString(),
      url,
      originalUrl: url,
      pageTitle: '',
      level,
      score: 0,
      summary: { violations: 0, passes: 0, incomplete: 0, inapplicable: 0, impactCounts: {} },
      violations: [],
      screenshot: null,
      spelling: { issues: [], totalWords: 0, totalIssues: 0 },
      links: { dead: [], redirects: [], live: 0, total: 0 },
      w3c: { valid: null, errorCount: 0, warningCount: 0, fatalCount: 0, errors: [], warnings: [] },
      krds: null,
      status: 'error',
      error: errMsg
    }
  }
}

// 배치 스캔 시작
app.post('/api/batch/start', async (req, res) => {
  const { urls, options: rawOptions = {} } = req.body
  // scanMode 기본값 보장
  const options = { scanMode: 'professional', ...rawOptions }
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'urls 배열이 필요합니다.' })
  }
  // 최대 100,000개 지원 (메모리 경고 제공)
  const MAX_BATCH = 100000
  if (urls.length > MAX_BATCH) {
    return res.status(400).json({ error: `최대 ${MAX_BATCH.toLocaleString()}개 URL까지 가능합니다.` })
  }

  const sessionId = 'batch_' + Date.now() + '_' + Math.random().toString(36).slice(2)
  const session = {
    id: sessionId,
    label: `${urls.length.toLocaleString()}개 페이지 검사 (${new Date().toLocaleString('ko-KR')})`,
    createdAt: new Date().toISOString(),
    total: urls.length,
    completed: 0,
    failed: 0,
    status: 'running',
    results: [],
    options,
    urls
  }
  batchSessions.set(sessionId, session)

  res.json({ sessionId, total: urls.length, message: '배치 스캔이 시작되었습니다.' })

  // 백그라운드 실행 — 큐 기반 워커 (BATCH_CONCURRENCY 동시)
  ;(async () => {
    let idx = 0
    const workers = Array.from({ length: BATCH_CONCURRENCY }, async () => {
      while (true) {
        const i = idx++
        if (i >= urls.length) break
        const url = urls[i]
        try {
          const result = await scanSinglePage(url, options)
          // 전체 결과는 evidenceStore에 보관 (상세 조회용)
          addEvidence(result.id, result)
          // 스크린샷 별도 보관 (PPTX 생성용)
          if (result.screenshot) {
            if (!session.screenshots) session.screenshots = {}
            session.screenshots[result.id] = result.screenshot
          }
          // 배치 results는 경량화 버전만 (메모리 절약)
          session.results[i] = lightResult(result)
          if (result.status === 'error') session.failed++
          else session.completed++
        } catch (err) {
          session.failed++
          session.results[i] = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2),
            url, status: 'error', error: err.message,
            score: 0, summary: { violations:0,passes:0,incomplete:0,inapplicable:0,impactCounts:{} },
            spelling:{totalIssues:0,totalWords:0},
            links:{dead:0,redirects:0,live:0,total:0}, w3c:null, krds:null,
            scannedAt: new Date().toISOString()
          }
        }
        // 중간 진행도 업데이트
        const done = session.completed + session.failed
        session.progress = Math.round(done / urls.length * 100)
      }
    })
    await Promise.allSettled(workers)
    session.status = 'completed'
    session.finishedAt = new Date().toISOString()
    console.log(`[배치완료] ${sessionId}: ${session.completed}완료/${session.failed}오류`)
  })()
})

// ─── 전체 민원안내 페이지 일괄 검사 (all-urls 수집 후 자동 배치 시작) ──────
// 1) /api/minwon/all-urls 로 전체 URL 수집 (쿼리 옵션 지원)
// 2) 1000개 단위로 분할하여 여러 배치 세션 생성
// 3) 첫 번째 세션 ID 반환 + 전체 세션 목록도 함께 반환
app.post('/api/batch/start-all', async (req, res) => {
  const { query = '', options = {}, chunkSize = 1000 } = req.body
  const safeChunk = Math.min(Math.max(parseInt(chunkSize) || 1000, 1), 1000)

  try {
    // 전체 URL 수집
    const PAGE_BATCH = 200
    let startCount = 0
    const seenCds = new Set()
    const allItems = []

    const first = await fetchMinwonPage(query, 0, PAGE_BATCH)
    const total = first.total
    for (const item of first.items) {
      if (!seenCds.has(item.cappBizCd)) { seenCds.add(item.cappBizCd); allItems.push(item) }
    }
    startCount += PAGE_BATCH

    const remaining = Math.ceil((total - PAGE_BATCH) / PAGE_BATCH)
    const batches = []
    for (let i = 0; i < remaining; i++) batches.push(startCount + i * PAGE_BATCH)

    const PARALLEL = 20
    for (let i = 0; i < batches.length; i += PARALLEL) {
      const chunk = batches.slice(i, i + PARALLEL)
      const results = await Promise.allSettled(chunk.map(sc => fetchMinwonPage(query, sc, PAGE_BATCH)))
      for (const r of results) {
        if (r.status === 'fulfilled') {
          for (const item of r.value.items) {
            if (!seenCds.has(item.cappBizCd)) { seenCds.add(item.cappBizCd); allItems.push(item) }
          }
        }
      }
    }

    if (allItems.length === 0) {
      return res.status(404).json({ error: '검사할 URL이 없습니다.' })
    }

    // safeChunk 단위로 분할하여 배치 세션 생성
    const sessionIds = []
    for (let i = 0; i < allItems.length; i += safeChunk) {
      const chunk = allItems.slice(i, i + safeChunk)
      const urls = chunk.map(item => ({ url: item.url, title: item.title, category: item.category, department: item.department }))
      const sessionId = 'batch_' + Date.now() + '_' + Math.random().toString(36).slice(2)
      const session = {
        id: sessionId,
        createdAt: new Date().toISOString(),
        total: urls.length,
        completed: 0,
        failed: 0,
        status: 'running',
        results: [],
        options,
        urls,
        chunkIndex: Math.floor(i / safeChunk),
        totalChunks: Math.ceil(allItems.length / safeChunk)
      }
      batchSessions.set(sessionId, session)
      sessionIds.push(sessionId)

      // 각 세션을 백그라운드에서 병렬 처리 (BATCH_CONCURRENCY 개 동시)
      ;(async (sess, urlList) => {
        let jIdx = 0, done = 0
        const workers = Array.from({ length: BATCH_CONCURRENCY }, async () => {
          while (true) {
            const j = jIdx++
            if (j >= urlList.length) break
            const entry = urlList[j]
            const urlStr = typeof entry === 'string' ? entry : entry.url
            try {
              const result = await scanSinglePage(urlStr, options)
              if (typeof entry === 'object') {
                result.category = result.category || entry.category
                result.department = result.department || entry.department
              }
              addEvidence(result.id, result)
              // 스크린샷 별도 보관 (PPTX 생성용)
              if (result.screenshot) {
                if (!sess.screenshots) sess.screenshots = {}
                sess.screenshots[result.id] = result.screenshot
              }
              sess.results.push(lightResult(result))
              if (result.status === 'error') sess.failed++
              else sess.completed++
            } catch (err) {
              sess.failed++
              sess.results.push({ url: urlStr, status: 'error', error: err.message,
                id: Date.now().toString(36) + Math.random().toString(36).slice(2),
                score: 0, summary: {violations:0,passes:0,incomplete:0,inapplicable:0,impactCounts:{}} })
            }
            done++
            sess.progress = Math.round(done / urlList.length * 100)
          }
        })
        await Promise.allSettled(workers)
        sess.status = 'completed'
        sess.finishedAt = new Date().toISOString()
      })(session, urls)
    }

    res.json({
      totalUrls: allItems.length,
      totalSessions: sessionIds.length,
      chunkSize: safeChunk,
      sessionIds,
      firstSessionId: sessionIds[0],
      message: `${allItems.length}개 URL을 ${sessionIds.length}개 세션으로 분할하여 검사를 시작합니다.`
    })
  } catch (err) {
    console.error('전체 검사 시작 오류:', err.message)
    res.status(500).json({ error: '전체 검사 시작 실패: ' + err.message })
  }
})

// 서버 상태 확인 (sitescan 헬스체크용)
app.get('/api/batch/status-check', (req, res) => {
  res.json({ ok: true, sessions: batchSessions.size, version: APP_VERSION })
})

// 배치 스캔 상태 조회
app.get('/api/batch/:sessionId/status', (req, res) => {
  const session = batchSessions.get(req.params.sessionId)
  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' })
  const done = (session.completed||0) + (session.failed||0)
  res.json({
    id: session.id,
    status: session.status,
    total: session.total,
    completed: done,          // 폴링 UI에서 완료수로 사용 (성공+실패)
    succeeded: session.completed,
    failed: session.failed,
    progress: session.progress || 0,
    createdAt: session.createdAt,
    finishedAt: session.finishedAt,
    abortReason: session.abortReason || null
  })
})

// 배치 스캔 결과 조회
app.get('/api/batch/:sessionId/results', (req, res) => {
  const session = batchSessions.get(req.params.sessionId)
  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' })
  
  // 스크린샷 제외 (목록용)
  const results = session.results.map(r => ({
    ...r,
    screenshot: r.screenshot ? '[screenshot_available]' : null
  }))
  
  res.json({
    id: session.id,
    status: session.status,
    total: session.total,
    completed: session.completed,
    failed: session.failed,
    progress: session.progress || 0,
    createdAt: session.createdAt,
    finishedAt: session.finishedAt,
    results
  })
})

// 개별 증적 조회 (스크린샷 포함)
app.get('/api/evidence/:evidenceId', (req, res) => {
  const evidence = evidenceStore.get(req.params.evidenceId)
  if (!evidence) return res.status(404).json({ error: '증적을 찾을 수 없습니다.' })
  res.json(evidence)
})

// 개별 증적 HTML 보고서 다운로드
app.get('/api/evidence/:evidenceId/report', (req, res) => {
  const evidence = evidenceStore.get(req.params.evidenceId)
  if (!evidence) return res.status(404).json({ error: '증적을 찾을 수 없습니다.' })
  
  // 기존 report API와 동일한 HTML 생성 로직 재사용
  const html = generateReportHtml(evidence)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="evidence-${evidence.id}.html"`)
  res.send(html)
})

// 배치 전체 보고서 다운로드
app.get('/api/batch/:sessionId/report', (req, res) => {
  const session = batchSessions.get(req.params.sessionId)
  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' })
  if (session.status !== 'completed') return res.status(400).json({ error: '스캔이 아직 완료되지 않았습니다.' })

  const html = generateBatchReportHtml(session)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="batch-report-${session.id}.html"`)
  res.send(html)
})

// ─── 배치 결과 엑셀 다운로드 API ─────────────────────
app.get('/api/batch/:sessionId/excel', async (req, res) => {
  const session = batchSessions.get(req.params.sessionId)
  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' })

  try {
    const wb = new ExcelJS.Workbook()
    wb.creator = '가디언즈 오브 갤럭시'
    wb.created = new Date()

    // ── 시트 1: 종합 현황 ─────────────────────────────
    const summaryWs = wb.addWorksheet('종합 현황')
    summaryWs.columns = [
      { header: '항목', key: 'label', width: 28 },
      { header: '값', key: 'value', width: 40 }
    ]
    const headerStyle = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }, alignment: { horizontal: 'center' } }
    summaryWs.getRow(1).eachCell(c => Object.assign(c, headerStyle))

    const completedResults = session.results.filter(r => r.status !== 'error')
    const avgScore = completedResults.length > 0
      ? Math.round(completedResults.reduce((s, r) => s + (r.score || 0), 0) / completedResults.length) : 0
    const totalViol = session.results.reduce((s, r) => s + (r.summary?.violations || 0), 0)
    const totalSpell = session.results.reduce((s, r) => s + (r.spelling?.totalIssues || 0), 0)
    const totalDead = session.results.reduce((s, r) => s + (r.links?.dead?.length || 0), 0)
    const totalW3cErr = session.results.reduce((s, r) => s + (r.w3c?.errorCount || 0), 0)
    const totalW3cWarn = session.results.reduce((s, r) => s + (r.w3c?.warningCount || 0), 0)
    const w3cInvalid = session.results.filter(r => r.w3c?.valid === false).length
    const errored = session.results.filter(r => r.status === 'error').length

    const summaryData = [
      ['검사 세션 ID', session.id],
      ['검사 시작 일시', new Date(session.createdAt).toLocaleString('ko-KR')],
      ['검사 완료 일시', session.finishedAt ? new Date(session.finishedAt).toLocaleString('ko-KR') : '진행 중'],
      ['검사 대상 URL 수', session.total],
      ['성공', session.completed],
      ['오류', errored],
      ['─ 접근성 검사 ─', ''],
      ['평균 접근성 점수 (0~100)', avgScore],
      ['총 접근성 위반 건수', totalViol],
      ['WCAG 검사 수준', session.options?.level || 'wcag2aa'],
      ['─ 오탈자 검사 ─', ''],
      ['총 오탈자 건수', totalSpell],
      ['─ 링크 검사 ─', ''],
      ['총 데드링크 건수', totalDead],
      ['─ W3C 표준 검사 ─', ''],
      ['W3C 검사 수행 여부', session.results.some(r => r.w3c?.errorCount !== undefined && r.w3c.checkedAt) ? '예' : '미수행'],
      ['W3C 오류 발생 페이지 수', w3cInvalid],
      ['W3C 총 오류 건수', totalW3cErr],
      ['W3C 총 경고 건수', totalW3cWarn],
    ]
    summaryData.forEach(([label, value]) => {
      const row = summaryWs.addRow({ label, value })
      row.getCell('label').font = { bold: true }
      row.getCell('label').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
    })
    summaryWs.getColumn('label').border = { right: { style: 'thin', color: { argb: 'FFE2E8F0' } } }

    // ── 시트 2: 페이지별 결과 ─────────────────────────
    const ws = wb.addWorksheet('페이지별 결과')
    ws.columns = [
      { header: 'No.', key: 'no', width: 6 },
      { header: '페이지 제목', key: 'title', width: 36 },
      { header: 'URL (www.gov.kr/mw)', key: 'url', width: 52 },
      { header: '카테고리', key: 'category', width: 18 },
      { header: '부서', key: 'department', width: 18 },
      { header: '접근성 점수', key: 'score', width: 13 },
      { header: '위반 수', key: 'violations', width: 10 },
      { header: '통과 수', key: 'passes', width: 10 },
      { header: '치명적', key: 'critical', width: 9 },
      { header: '심각', key: 'serious', width: 9 },
      { header: '보통', key: 'moderate', width: 9 },
      { header: '경미', key: 'minor', width: 9 },
      { header: '오탈자 수', key: 'spelling', width: 10 },
      { header: '검사 어절 수', key: 'words', width: 12 },
      { header: '데드링크 수', key: 'deadLinks', width: 12 },
      { header: '리다이렉트 수', key: 'redirects', width: 13 },
      { header: '정상 링크 수', key: 'liveLinks', width: 12 },
      { header: '전체 링크 수', key: 'totalLinks', width: 12 },
      { header: 'W3C 오류', key: 'w3cErrors', width: 11 },
      { header: 'W3C 경고', key: 'w3cWarnings', width: 11 },
      { header: 'W3C 유효성', key: 'w3cValid', width: 12 },
      { header: '검사 상태', key: 'status', width: 10 },
      { header: '검사 일시', key: 'scannedAt', width: 22 },
      { header: '오류 메시지', key: 'errorMsg', width: 40 }
    ]

    // 헤더 스타일
    ws.getRow(1).eachCell(c => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false }
      c.border = { bottom: { style: 'medium', color: { argb: 'FF2563EB' } } }
    })
    ws.getRow(1).height = 22

    // 데이터 행
    session.results.forEach((r, idx) => {
      const imp = r.summary?.impactCounts || {}
      const sp = r.spelling || {}
      const lk = r.links || {}
      const w3c = r.w3c || {}
      const score = r.score ?? null
      const isError = r.status === 'error'

      const row = ws.addRow({
        no: idx + 1,
        title: r.pageTitle || '(오류)',
        url: r.url || r.originalUrl || '',
        category: r.category || '',
        department: r.department || '',
        score: score,
        violations: r.summary?.violations ?? '',
        passes: r.summary?.passes ?? '',
        critical: imp.critical || 0,
        serious: imp.serious || 0,
        moderate: imp.moderate || 0,
        minor: imp.minor || 0,
        spelling: sp.totalIssues ?? '',
        words: sp.totalWords ?? '',
        deadLinks: lk.dead?.length ?? '',
        redirects: lk.redirects?.length ?? '',
        liveLinks: lk.live ?? '',
        totalLinks: lk.total ?? '',
        w3cErrors: w3c.errorCount ?? '',
        w3cWarnings: w3c.warningCount ?? '',
        w3cValid: w3c.valid === null ? '' : w3c.valid ? '유효' : '무효',
        status: isError ? '오류' : '완료',
        scannedAt: r.scannedAt ? new Date(r.scannedAt).toLocaleString('ko-KR') : '',
        errorMsg: r.error || ''
      })

      // 행 배경 (짝수 줄 연회색)
      const bg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC'
      row.eachCell(c => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
        c.font = { size: 9 }
        c.alignment = { vertical: 'middle' }
      })

      // 점수 색상
      if (score !== null) {
        const scoreCell = row.getCell('score')
        scoreCell.font = { bold: true, size: 10, color: { argb: score >= 80 ? 'FF16A34A' : score >= 50 ? 'FFD97706' : 'FFDC2626' } }
        scoreCell.alignment = { horizontal: 'center', vertical: 'middle' }
      }

      // 위반 수 빨간색
      if ((r.summary?.violations || 0) > 0) {
        const vc = row.getCell('violations')
        vc.font = { bold: true, color: { argb: 'FFDC2626' }, size: 10 }
        vc.alignment = { horizontal: 'center', vertical: 'middle' }
      }

      // 치명적/심각 색상
      if ((imp.critical || 0) > 0) row.getCell('critical').font = { bold: true, color: { argb: 'FFDC2626' }, size: 9 }
      if ((imp.serious || 0) > 0) row.getCell('serious').font = { bold: true, color: { argb: 'FFEA580C' }, size: 9 }

      // 오탈자 색상
      if ((sp.totalIssues || 0) > 0) {
        row.getCell('spelling').font = { bold: true, color: { argb: 'FF7C3AED' }, size: 10 }
      }

      // 데드링크 색상
      if ((lk.dead?.length || 0) > 0) {
        row.getCell('deadLinks').font = { bold: true, color: { argb: 'FFDC2626' }, size: 10 }
      }

      // W3C 오류 색상
      if ((w3c.errorCount || 0) > 0) {
        row.getCell('w3cErrors').font = { bold: true, color: { argb: 'FFDC2626' }, size: 10 }
      }
      if ((w3c.warningCount || 0) > 0) {
        row.getCell('w3cWarnings').font = { bold: true, color: { argb: 'FFD97706' }, size: 10 }
      }
      if (w3c.valid === false) {
        row.getCell('w3cValid').font = { bold: true, color: { argb: 'FFDC2626' }, size: 9 }
      } else if (w3c.valid === true) {
        row.getCell('w3cValid').font = { bold: true, color: { argb: 'FF16A34A' }, size: 9 }
      }
      row.getCell('w3cValid').alignment = { horizontal: 'center', vertical: 'middle' }

      // 상태 색상
      const stCell = row.getCell('status')
      stCell.font = { bold: true, color: { argb: isError ? 'FFDC2626' : 'FF16A34A' }, size: 9 }
      stCell.alignment = { horizontal: 'center', vertical: 'middle' }

      // 숫자 중앙 정렬
      ;['no', 'score', 'violations', 'passes', 'critical', 'serious', 'moderate', 'minor',
        'spelling', 'words', 'deadLinks', 'redirects', 'liveLinks', 'totalLinks',
        'w3cErrors', 'w3cWarnings'].forEach(k => {
        row.getCell(k).alignment = { horizontal: 'center', vertical: 'middle' }
      })

      row.height = 18
    })

    // 자동 필터
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } }

    // 틀 고정 (1행)
    ws.views = [{ state: 'frozen', ySplit: 1 }]

    // ── 시트 3: 접근성 위반 상세 ─────────────────────────
    const violWs = wb.addWorksheet('접근성 위반 상세')
    violWs.columns = [
      { header: 'No.', key: 'no', width: 6 },
      { header: '페이지 제목', key: 'title', width: 32 },
      { header: 'URL', key: 'url', width: 48 },
      { header: '규칙 ID', key: 'ruleId', width: 22 },
      { header: '심각도', key: 'impact', width: 10 },
      { header: '위반 내용', key: 'help', width: 40 },
      { header: '설명', key: 'description', width: 50 },
      { header: '영향받는 요소 수', key: 'nodeCount', width: 16 },
      { header: '첫 번째 요소 HTML', key: 'firstHtml', width: 60 }
    ]
    violWs.getRow(1).eachCell(c => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7F1D1D' } }
      c.alignment = { horizontal: 'center', vertical: 'middle' }
    })
    violWs.getRow(1).height = 22

    const impactOrder = { critical: 1, serious: 2, moderate: 3, minor: 4 }
    const impactColorArgb = { critical: 'FFDC2626', serious: 'FFEA580C', moderate: 'FFD97706', minor: 'FF65A30D' }
    const impactLabelKo = { critical: '치명적', serious: '심각', moderate: '보통', minor: '경미' }
    let violRowIdx = 0
    session.results.forEach(r => {
      if (!r.violations || r.violations.length === 0) return
      const sorted = [...r.violations].sort((a, b) => (impactOrder[a.impact] || 9) - (impactOrder[b.impact] || 9))
      sorted.forEach(v => {
        const row = violWs.addRow({
          no: ++violRowIdx,
          title: r.pageTitle || '',
          url: r.url || '',
          ruleId: v.id,
          impact: impactLabelKo[v.impact] || v.impact,
          help: v.help,
          description: v.description,
          nodeCount: v.nodes?.length || 0,
          firstHtml: v.nodes?.[0]?.html?.substring(0, 200) || ''
        })
        const bg = violRowIdx % 2 === 0 ? 'FFFFFFFF' : 'FFFFF1F2'
        row.eachCell(c => {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
          c.font = { size: 9 }
          c.alignment = { vertical: 'middle', wrapText: false }
        })
        const impCell = row.getCell('impact')
        impCell.font = { bold: true, color: { argb: impactColorArgb[v.impact] || 'FF6B7280' }, size: 9 }
        impCell.alignment = { horizontal: 'center', vertical: 'middle' }
        row.getCell('no').alignment = { horizontal: 'center', vertical: 'middle' }
        row.height = 16
      })
    })
    violWs.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: violWs.columns.length } }
    violWs.views = [{ state: 'frozen', ySplit: 1 }]

    // ── 시트 4: 오탈자 상세 ──────────────────────────────
    const spellWs = wb.addWorksheet('오탈자 상세')
    spellWs.columns = [
      { header: 'No.', key: 'no', width: 6 },
      { header: '페이지 제목', key: 'title', width: 32 },
      { header: 'URL', key: 'url', width: 48 },
      { header: '오탈자', key: 'word', width: 18 },
      { header: '수정 제안', key: 'suggestion', width: 18 },
      { header: '설명', key: 'desc', width: 40 },
      { header: '문맥', key: 'context', width: 50 }
    ]
    spellWs.getRow(1).eachCell(c => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4C1D95' } }
      c.alignment = { horizontal: 'center', vertical: 'middle' }
    })
    spellWs.getRow(1).height = 22

    let spellRowIdx = 0
    session.results.forEach(r => {
      if (!r.spelling?.issues?.length) return
      r.spelling.issues.forEach(issue => {
        const row = spellWs.addRow({
          no: ++spellRowIdx,
          title: r.pageTitle || '',
          url: r.url || '',
          word: issue.word,
          suggestion: issue.suggestion,
          desc: issue.desc || '',
          context: issue.context ? `...${issue.context}...` : ''
        })
        const bg = spellRowIdx % 2 === 0 ? 'FFFFFFFF' : 'FFFAF5FF'
        row.eachCell(c => {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
          c.font = { size: 9 }
          c.alignment = { vertical: 'middle' }
        })
        row.getCell('word').font = { bold: true, color: { argb: 'FF7C3AED' }, size: 9 }
        row.getCell('suggestion').font = { bold: true, color: { argb: 'FF059669' }, size: 9 }
        row.getCell('no').alignment = { horizontal: 'center', vertical: 'middle' }
        row.height = 16
      })
    })
    spellWs.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: spellWs.columns.length } }
    spellWs.views = [{ state: 'frozen', ySplit: 1 }]

    // ── 시트 5: 데드링크 상세 ────────────────────────────
    const linkWs = wb.addWorksheet('데드링크 상세')
    linkWs.columns = [
      { header: 'No.', key: 'no', width: 6 },
      { header: '페이지 제목', key: 'title', width: 32 },
      { header: '페이지 URL', key: 'pageUrl', width: 48 },
      { header: '데드링크 URL', key: 'linkUrl', width: 56 },
      { header: '링크 텍스트', key: 'linkText', width: 28 },
      { header: 'HTTP 상태', key: 'status', width: 12 },
      { header: '오류 메시지', key: 'error', width: 36 }
    ]
    linkWs.getRow(1).eachCell(c => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7F1D1D' } }
      c.alignment = { horizontal: 'center', vertical: 'middle' }
    })
    linkWs.getRow(1).height = 22

    let linkRowIdx = 0
    session.results.forEach(r => {
      if (!r.links?.dead?.length) return
      r.links.dead.forEach(link => {
        const row = linkWs.addRow({
          no: ++linkRowIdx,
          title: r.pageTitle || '',
          pageUrl: r.url || '',
          linkUrl: link.url,
          linkText: link.text || '',
          status: link.status || '오류',
          error: link.error || ''
        })
        const bg = linkRowIdx % 2 === 0 ? 'FFFFFFFF' : 'FFFFF1F2'
        row.eachCell(c => {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
          c.font = { size: 9 }
          c.alignment = { vertical: 'middle' }
        })
        row.getCell('status').font = { bold: true, color: { argb: 'FFDC2626' }, size: 9 }
        row.getCell('status').alignment = { horizontal: 'center', vertical: 'middle' }
        row.getCell('no').alignment = { horizontal: 'center', vertical: 'middle' }
        row.height = 16
      })
    })
    linkWs.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: linkWs.columns.length } }
    linkWs.views = [{ state: 'frozen', ySplit: 1 }]

    // ── 시트 5: W3C 위반 상세 ────────────────────────────
    const w3cWs = wb.addWorksheet('W3C 위반 상세')
    w3cWs.columns = [
      { header: 'No.', key: 'no', width: 6 },
      { header: '페이지 제목', key: 'title', width: 32 },
      { header: 'URL', key: 'url', width: 48 },
      { header: '유형', key: 'type', width: 10 },
      { header: '세부유형', key: 'subType', width: 10 },
      { header: '오류 메시지', key: 'message', width: 60 },
      { header: '문제 코드', key: 'extract', width: 50 },
      { header: '행', key: 'lastLine', width: 8 },
      { header: '열', key: 'lastColumn', width: 8 }
    ]
    w3cWs.getRow(1).eachCell(c => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }
      c.alignment = { horizontal: 'center', vertical: 'middle' }
    })
    w3cWs.getRow(1).height = 22

    let w3cRowIdx = 0
    session.results.forEach(r => {
      const w3c = r.w3c
      if (!w3c || (!w3c.errors?.length && !w3c.warnings?.length)) return
      const allMsgs = [
        ...(w3c.errors || []).map(m => ({ ...m, _level: 'error' })),
        ...(w3c.warnings || []).map(m => ({ ...m, _level: 'warning' }))
      ]
      allMsgs.forEach(m => {
        const row = w3cWs.addRow({
          no: ++w3cRowIdx,
          title: r.pageTitle || '',
          url: r.url || '',
          type: m._level === 'error' ? '오류' : '경고',
          subType: m.subType === 'fatal' ? '치명적' : m.subType || '',
          message: m.message || '',
          extract: m.extract ? m.extract.substring(0, 200) : '',
          lastLine: m.lastLine || '',
          lastColumn: m.lastColumn || ''
        })
        const bg = w3cRowIdx % 2 === 0 ? 'FFFFFFFF' : 'FFEFF6FF'
        row.eachCell(c => {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
          c.font = { size: 9 }
          c.alignment = { vertical: 'middle', wrapText: false }
        })
        const typeCell = row.getCell('type')
        typeCell.font = {
          bold: true, size: 9,
          color: { argb: m._level === 'error' ? 'FFDC2626' : 'FFD97706' }
        }
        typeCell.alignment = { horizontal: 'center', vertical: 'middle' }
        if (m.subType === 'fatal') {
          row.getCell('subType').font = { bold: true, color: { argb: 'FF7C0000' }, size: 9 }
        }
        row.getCell('no').alignment = { horizontal: 'center', vertical: 'middle' }
        ;['lastLine','lastColumn'].forEach(k => row.getCell(k).alignment = { horizontal: 'center', vertical: 'middle' })
        row.height = 16
      })
    })
    w3cWs.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: w3cWs.columns.length } }
    w3cWs.views = [{ state: 'frozen', ySplit: 1 }]

    // 엑셀 출력
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const filename = `minwon-a11y-report-${dateStr}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
    await wb.xlsx.write(res)
    res.end()

  } catch (err) {
    console.error('엑셀 생성 오류:', err.message)
    res.status(500).json({ error: '엑셀 생성 실패: ' + err.message })
  }
})
// ─── 일괄 다운로드 API ───────────────────────────────────────────────────────

// 세션의 모든 개별 HTML 증적 보고서를 ZIP으로 묶어 다운로드
app.get('/api/batch/:sessionId/download-all-reports', async (req, res) => {
  const session = batchSessions.get(req.params.sessionId)
  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' })
  if (session.status !== 'completed') return res.status(400).json({ error: '스캔이 완료되지 않았습니다.' })

  try {
    const archiver = require('archiver')
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const label = (session.label || session.id).replace(/[^a-zA-Z0-9가-힣_-]/g, '_')
    const zipFilename = `reports_${label}_${dateStr}.zip`

    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zipFilename)}`)

    const archive = archiver('zip', { zlib: { level: 6 } })
    archive.on('error', err => { console.error('ZIP 오류:', err); res.end() })
    archive.pipe(res)

    let fileCount = 0
    for (const r of session.results) {
      if (r.status === 'error') continue
      const evidence = evidenceStore.get(r.id)
      if (!evidence) continue
      const html = generateReportHtml(evidence)
      const safeTitle = (r.pageTitle || r.id).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
      archive.append(Buffer.from(html, 'utf8'), { name: `${String(fileCount + 1).padStart(4, '0')}_${safeTitle}.html` })
      fileCount++
    }

    await archive.finalize()
    console.log(`일괄 HTML 다운로드: ${fileCount}개 파일, 세션=${session.id}`)
  } catch (err) {
    console.error('일괄 HTML 다운로드 오류:', err.message)
    if (!res.headersSent) res.status(500).json({ error: err.message })
  }
})

// 세션의 엑셀 + 배치 HTML 보고서를 하나의 ZIP으로 다운로드
app.get('/api/batch/:sessionId/download-all', async (req, res) => {
  const session = batchSessions.get(req.params.sessionId)
  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' })
  if (session.status !== 'completed') return res.status(400).json({ error: '스캔이 완료되지 않았습니다.' })

  try {
    const archiver = require('archiver')
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const label = (session.label || session.id).replace(/[^a-zA-Z0-9가-힣_-]/g, '_')
    const zipFilename = `all_${label}_${dateStr}.zip`

    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zipFilename)}`)

    const archive = archiver('zip', { zlib: { level: 6 } })
    archive.on('error', err => { console.error('ZIP 오류:', err); res.end() })
    archive.pipe(res)

    // 1) 엑셀 파일 생성 후 추가
    const wb = new ExcelJS.Workbook()
    wb.creator = '가디언즈 오브 갤럭시'
    wb.created = new Date()
    const summaryWs = wb.addWorksheet('종합 현황')
    summaryWs.columns = [
      { header: '항목', key: 'label', width: 28 },
      { header: '값', key: 'value', width: 40 }
    ]
    const hStyle = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }, alignment: { horizontal: 'center' } }
    summaryWs.getRow(1).eachCell(c => Object.assign(c, hStyle))
    const completedResults = session.results.filter(r => r.status !== 'error')
    const avgScore = completedResults.length > 0 ? Math.round(completedResults.reduce((s, r) => s + (r.score || 0), 0) / completedResults.length) : 0
    const totalViol = session.results.reduce((s, r) => s + (r.summary?.violations || 0), 0)
    ;[
      ['검사 세션 ID', session.id],
      ['검사 레이블', session.label || ''],
      ['검사 시작 일시', new Date(session.createdAt).toLocaleString('ko-KR')],
      ['검사 완료 일시', session.finishedAt ? new Date(session.finishedAt).toLocaleString('ko-KR') : ''],
      ['검사 대상 URL 수', session.total],
      ['성공', session.completed],
      ['오류', session.failed],
      ['평균 접근성 점수', avgScore],
      ['총 접근성 위반 건수', totalViol],
    ].forEach(([l, v]) => {
      const row = summaryWs.addRow({ label: l, value: v })
      row.getCell('label').font = { bold: true }
      row.getCell('label').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
    })
    const ws = wb.addWorksheet('페이지별 결과')
    ws.columns = [
      { header: 'No.', key: 'no', width: 6 }, { header: '페이지 제목', key: 'title', width: 36 },
      { header: 'URL', key: 'url', width: 52 }, { header: '카테고리', key: 'category', width: 18 },
      { header: '부서', key: 'department', width: 18 }, { header: '접근성 점수', key: 'score', width: 13 },
      { header: '위반 수', key: 'violations', width: 10 }, { header: '오탈자 수', key: 'spelling', width: 10 },
      { header: '데드링크 수', key: 'deadLinks', width: 12 }, { header: 'W3C 오류', key: 'w3cErrors', width: 11 },
      { header: '검사 상태', key: 'status', width: 10 }, { header: '검사 일시', key: 'scannedAt', width: 22 }
    ]
    ws.getRow(1).eachCell(c => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
      c.alignment = { horizontal: 'center', vertical: 'middle' }
    })
    ws.getRow(1).height = 22
    session.results.forEach((r, idx) => {
      const sp = r.spelling || {}; const lk = r.links || {}; const w3c = r.w3c || {}
      ws.addRow({
        no: idx + 1, title: r.pageTitle || '(오류)', url: r.url || '', category: r.category || '',
        department: r.department || '', score: r.score ?? '', violations: r.summary?.violations ?? '',
        spelling: sp.totalIssues ?? '', deadLinks: lk.dead?.length ?? '', w3cErrors: w3c.errorCount ?? '',
        status: r.status === 'error' ? '오류' : '완료',
        scannedAt: r.scannedAt ? new Date(r.scannedAt).toLocaleString('ko-KR') : ''
      }).height = 18
    })
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    const xlsxBuffer = await wb.xlsx.writeBuffer()
    archive.append(Buffer.from(xlsxBuffer), { name: `${label}_결과.xlsx` })

    // 2) 배치 HTML 종합 보고서 추가
    const batchHtml = generateBatchReportHtml(session)
    archive.append(Buffer.from(batchHtml, 'utf8'), { name: `${label}_종합보고서.html` })

    // 3) 개별 HTML 증적 추가 (reports/ 폴더)
    let fileCount = 0
    for (const r of session.results) {
      if (r.status === 'error') continue
      const evidence = evidenceStore.get(r.id)
      if (!evidence) continue
      const html = generateReportHtml(evidence)
      const safeTitle = (r.pageTitle || r.id).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
      archive.append(Buffer.from(html, 'utf8'), { name: `reports/${String(fileCount + 1).padStart(4, '0')}_${safeTitle}.html` })
      fileCount++
    }

    await archive.finalize()
    console.log(`전체 일괄 다운로드: 엑셀+종합보고서+${fileCount}개 개별보고서, 세션=${session.id}`)
  } catch (err) {
    console.error('전체 일괄 다운로드 오류:', err.message)
    if (!res.headersSent) res.status(500).json({ error: err.message })
  }
})

// 여러 세션(전환 차수 전체)을 하나의 ZIP으로 다운로드
app.post('/api/batch/download-multi', async (req, res) => {
  const { sessionIds, label: reqLabel } = req.body || {}
  if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
    return res.status(400).json({ error: 'sessionIds 배열이 필요합니다.' })
  }

  const sessions = sessionIds.map(id => batchSessions.get(id)).filter(Boolean)
  if (sessions.length === 0) return res.status(404).json({ error: '유효한 세션이 없습니다.' })
  const incompleteSessions = sessions.filter(s => s.status !== 'completed')
  if (incompleteSessions.length > 0) {
    return res.status(400).json({ error: `아직 완료되지 않은 세션이 ${incompleteSessions.length}개 있습니다.` })
  }

  try {
    const archiver = require('archiver')
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const zipLabel = (reqLabel || sessions[0].step || 'batch').replace(/[^a-zA-Z0-9가-힣_-]/g, '_')
    const zipFilename = `전체다운로드_${zipLabel}_${dateStr}.zip`

    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zipFilename)}`)

    const archive = archiver('zip', { zlib: { level: 5 } })
    archive.on('error', err => { console.error('ZIP 오류:', err); res.end() })
    archive.pipe(res)

    let totalFiles = 0
    for (const session of sessions) {
      const sessionLabel = (session.label || session.id).replace(/[^a-zA-Z0-9가-힣_-]/g, '_')
      const folder = sessionLabel

      // 엑셀
      const wb = new ExcelJS.Workbook()
      wb.creator = '가디언즈 오브 갤럭시'; wb.created = new Date()
      const ws = wb.addWorksheet('결과')
      ws.columns = [
        { header: 'No.', key: 'no', width: 6 }, { header: '페이지 제목', key: 'title', width: 36 },
        { header: 'URL', key: 'url', width: 52 }, { header: '접근성 점수', key: 'score', width: 13 },
        { header: '위반 수', key: 'violations', width: 10 }, { header: '오탈자 수', key: 'spelling', width: 10 },
        { header: '데드링크 수', key: 'deadLinks', width: 12 }, { header: '검사 상태', key: 'status', width: 10 }
      ]
      ws.getRow(1).eachCell(c => {
        c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
        c.alignment = { horizontal: 'center' }
      })
      session.results.forEach((r, idx) => {
        ws.addRow({
          no: idx + 1, title: r.pageTitle || '(오류)', url: r.url || '',
          score: r.score ?? '', violations: r.summary?.violations ?? '',
          spelling: r.spelling?.totalIssues ?? '', deadLinks: r.links?.dead?.length ?? '',
          status: r.status === 'error' ? '오류' : '완료'
        })
      })
      const xlsxBuf = await wb.xlsx.writeBuffer()
      archive.append(Buffer.from(xlsxBuf), { name: `${folder}/${sessionLabel}_결과.xlsx` })

      // 배치 종합 HTML
      const batchHtml = generateBatchReportHtml(session)
      archive.append(Buffer.from(batchHtml, 'utf8'), { name: `${folder}/${sessionLabel}_종합보고서.html` })

      // 개별 증적
      let fc = 0
      for (const r of session.results) {
        if (r.status === 'error') continue
        const evidence = evidenceStore.get(r.id)
        if (!evidence) continue
        const html = generateReportHtml(evidence)
        const safeTitle = (r.pageTitle || r.id).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
        archive.append(Buffer.from(html, 'utf8'), { name: `${folder}/reports/${String(fc + 1).padStart(4, '0')}_${safeTitle}.html` })
        fc++
      }
      totalFiles += fc
    }

    await archive.finalize()
    console.log(`다중 세션 일괄 다운로드: ${sessions.length}개 세션, ${totalFiles}개 증적`)
  } catch (err) {
    console.error('다중 세션 다운로드 오류:', err.message)
    if (!res.headersSent) res.status(500).json({ error: err.message })
  }
})

// ─── 단일 검사 Excel 보고서 ─────────────────────────────
app.post('/api/report/excel', async (req, res) => {
  const result = req.body
  if (!result || !result.url) return res.status(400).json({ error: '검사 결과가 필요합니다.' })
  try {
    const buf = await generateExcelReport([result], result.reportMeta || {})
    const d   = new Date().toISOString().slice(0,10)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('가디언즈_검사보고서_'+d+'.xlsx')}`)
    res.send(buf)
  } catch (e) {
    console.error('Excel 보고서 오류:', e)
    res.status(500).json({ error: e.message })
  }
})

// ─── 단일 검사 Word 보고서 ─────────────────────────────
app.post('/api/report/word', async (req, res) => {
  const result = req.body
  if (!result || !result.url) return res.status(400).json({ error: '검사 결과가 필요합니다.' })
  try {
    const buf = await generateWordReport([result], result.reportMeta || {})
    const d   = new Date().toISOString().slice(0,10)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('가디언즈_검사보고서_'+d+'.docx')}`)
    res.send(buf)
  } catch (e) {
    console.error('Word 보고서 오류:', e)
    res.status(500).json({ error: e.message })
  }
})

// ─── 배치 Word 보고서 ──────────────────────────────────
app.post('/api/batch/:sessionId/word', async (req, res) => {
  const { sessionId } = req.params
  const { meta = {} } = req.body || {}
  const session = batchSessions.get(sessionId)
  if (!session) return res.status(404).json({ error: '세션 없음' })
  try {
    const results = session.results || []
    const buf = await generateWordReport(results, meta)
    const d   = new Date().toISOString().slice(0,10)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('가디언즈_검사보고서_'+d+'.docx')}`)
    res.send(buf)
  } catch (e) {
    console.error('배치 Word 오류:', e)
    res.status(500).json({ error: e.message })
  }
})

function generateReportHtml(result) {
  const impactColor = { critical: '#ef6253', serious: '#f0a34d', moderate: '#f0a34d', minor: '#41b979' }
  const impactLabel = { critical: '치명적', serious: '심각', moderate: '보통', minor: '경미' }
  const scoreColor = result.score >= 80 ? '#41b979' : result.score >= 50 ? '#f0a34d' : '#ef6253'

  const violationsHtml = result.violations.map((v, i) => `
    <div style="border-left:4px solid ${impactColor[v.impact]||'#8c8c8c'};margin-bottom:16px;padding:12px 16px;background:#f4f4f4;border-radius:0 8px 8px 0;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <strong style="font-size:14px;color:#222222;">${i+1}. ${escapeHtml(v.help)}</strong>
        <span style="background:${impactColor[v.impact]||'#8c8c8c'};color:white;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;">${impactLabel[v.impact]||v.impact}</span>
      </div>
      <p style="color:#444444;font-size:12px;margin-bottom:6px;">${escapeHtml(v.description)}</p>
      <div style="font-size:11px;color:#8c8c8c;margin-bottom:6px;"><strong>규칙:</strong> ${v.id} | <a href="${v.helpUrl}" style="color:#222222;">가이드 →</a></div>
      ${v.fix ? `<div style="margin-top:8px;font-size:13px"><b>어떻게:</b> ${v.fix.how}${(v.nodes&&v.nodes[0]&&v.nodes[0].suggest&&v.nodes[0].suggest.after) ? `<pre style="margin:6px 0 0;padding:8px 10px;border-radius:6px;background:#f1faf5;border:1px solid #bfe8d0;font-size:11.5px;white-space:pre-wrap"><b style="color:#41b979">이 요소 맞춤 제안</b>${v.nodes[0].suggest.note ? ' · '+v.nodes[0].suggest.note : ''}\n${v.nodes[0].suggest.after.replace(/</g,'&lt;')}</pre>` : (v.fix.after ? `<pre style="margin:6px 0 0;padding:8px 10px;border-radius:6px;background:#f1faf5;border:1px solid #bfe8d0;font-size:11.5px;white-space:pre-wrap"><b style="color:#41b979">수정 예시</b>\n${v.fix.after.replace(/</g,'&lt;')}</pre>` : '')}</div>` : ''}
      <div style="background:#f4f4f4;border-radius:6px;padding:8px;font-size:11px;">
        ${v.nodes.slice(0,3).map(n=>`<div style="font-family:monospace;background:#ebebeb;padding:3px 6px;border-radius:3px;margin-top:4px;word-break:break-all;">${escapeHtml(n.html)}</div><div style="color:#8c8c8c;margin-top:2px;">${escapeHtml(n.failureSummary||'')}</div>`).join('')}
        ${v.nodes.length>3?`<div style="color:#8c8c8c;margin-top:4px;">... 외 ${v.nodes.length-3}개</div>`:''}
      </div>
    </div>`).join('')

  const sp = result.spelling || {}
  const _SPELL_TYPE_LABEL = { spell: '철자 오류', spacing: '띄어쓰기', ambiguous: '문맥 오류', stat: '통계 교정', korean: '한글', unknown: '기타' }
  const _SPELL_TYPE_COLOR = { spell: '#ef6253', spacing: '#f0a34d', ambiguous: '#f0a34d', stat: '#222222', korean: '#222222', unknown: '#8c8c8c' }
  const spellingHtml = (sp.issues && sp.issues.length > 0) ? sp.issues.map((issue, i) => {
    const tc = _SPELL_TYPE_COLOR[issue.type] || '#222222'
    const tl = _SPELL_TYPE_LABEL[issue.type] || '기타'
    const lineInfo = issue.line ? `줄 ${issue.line}${issue.col ? ', 열 '+issue.col : ''}` : ''
    return `
    <div style="border-left:4px solid ${tc};margin-bottom:12px;padding:10px 14px;background:#f4f4f4;border-radius:0 6px 6px 0;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-size:13px;color:#222222;">
          <strong style="color:#ef6253;">"${escapeHtml(issue.word)}"</strong>
          <span style="color:#8c8c8c;margin:0 6px;">→</span>
          <strong style="color:#41b979;">"${escapeHtml(issue.suggestion)}"</strong>
        </span>
        <span style="background:${tc};color:white;padding:1px 8px;border-radius:10px;font-size:10px;">${tl}</span>
      </div>
      ${issue.desc?`<div style="font-size:11px;color:#8c8c8c;margin-bottom:4px;">${escapeHtml(issue.desc)}</div>`:''}
      ${issue.context?`<div style="font-family:monospace;font-size:11px;background:#ebebeb;padding:3px 8px;border-radius:4px;color:#444444;margin-bottom:4px;">${escapeHtml(issue.context)}</div>`:''}
      <div style="font-size:11px;color:#8c8c8c;display:flex;gap:12px;flex-wrap:wrap;">
        ${lineInfo ? `<span>${lineInfo}</span>` : ''}
        ${issue.pageUrl ? `<span>${escapeHtml(issue.pageUrl)}</span>` : ''}
      </div>
    </div>`
  }).join('') : '<div style="text-align:center;padding:24px;color:#41b979;font-weight:600;">오탈자가 감지되지 않았습니다.</div>'


  const lk = result.links || {}
  const deadLinksHtml = (lk.dead && lk.dead.length > 0) ? lk.dead.map((link, i) => `
    <div style="border-left:4px solid #ef6253;margin-bottom:12px;padding:10px 14px;background:#fff5f4;border-radius:0 6px 6px 0;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <code style="font-size:11px;color:#222222;word-break:break-all;">${escapeHtml(link.url)}</code>
        <span style="background:#ef6253;color:white;padding:1px 8px;border-radius:10px;font-size:10px;white-space:nowrap;margin-left:8px;">${link.status||'오류'}</span>
      </div>
      ${link.text?`<div style="font-size:12px;color:#8c8c8c;">링크 텍스트: "${escapeHtml(link.text)}"</div>`:''}
      ${link.error?`<div style="font-size:11px;color:#ef6253;margin-top:2px;">${escapeHtml(link.error)}</div>`:''}
    </div>`).join('') : '<div style="text-align:center;padding:24px;color:#41b979;font-weight:600;">데드링크가 발견되지 않았습니다.</div>'

  const screenshotSection = result.screenshot ? `
    <div class="section"><h2>페이지 스크린샷</h2>
      <img src="data:image/png;base64,${result.screenshot}" style="max-width:100%;border:1px solid #ebebeb;border-radius:8px;" />
    </div>` : ''

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>증적 보고서 - ${escapeHtml(result.pageTitle || result.url)}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html{overflow-y:scroll}
  body{font-family:"Pretendard Variable",Pretendard,-apple-system,"Malgun Gothic","맑은 고딕",sans-serif;background:#fff;color:#222;letter-spacing:-.01em;line-height:1.5}
  .header{background:#fff!important;color:#222!important;padding:0;border-bottom:1px solid #ebebeb}
  .header > div{max-width:1180px!important;margin:0 auto;padding:36px 40px 28px}
  .header h1{font-size:34px;font-weight:800;letter-spacing:-.04em;margin-bottom:10px;color:#222}
  .header h1::before{content:"가디언즈";display:block;font-size:13px;font-weight:600;color:#8c8c8c;letter-spacing:0;margin-bottom:6px}
  .header .meta,.meta{font-size:13px;color:#8c8c8c;margin-top:3px;opacity:1}
  .container{max-width:1180px;margin:0 auto;padding:28px 40px 80px}
  .section{background:#fff;border-radius:0;padding:28px 0;margin-bottom:0;box-shadow:none;border-bottom:1px solid #ebebeb}
  .section h2{font-size:22px;font-weight:700;letter-spacing:-.03em;margin-bottom:18px;color:#222;border-bottom:0;padding-bottom:0}
  .section h3{font-size:15px;font-weight:700;margin:14px 0 8px}
  .score-num{font-size:72px;font-weight:800;color:#222;line-height:1;letter-spacing:-.05em}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid #ebebeb;border-radius:10px;overflow:hidden}
  .stat{text-align:left;padding:18px 20px;background:#fff;border-radius:0;border-right:1px solid #ebebeb}
  .stat:last-child{border-right:0}
  .stat-num{font-size:30px;font-weight:800;letter-spacing:-.04em}
  .impact-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
  .impact-item{padding:14px 16px;border-radius:10px;text-align:left;background:#f4f4f4!important}
  .impact-item .num{font-size:28px;font-weight:800;color:#222;letter-spacing:-.04em}
  .impact-item .lbl{font-size:12px;color:#8c8c8c;margin-top:2px}
  .summary-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}
  .sum-box{padding:16px 18px;border-radius:10px;text-align:left;border:1px solid #ebebeb!important;background:#fff!important}
  .badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;background:#f4f4f4!important;color:#222!important}
  .footer{text-align:left;color:#8c8c8c;font-size:12px;margin-top:28px;padding:20px 0 36px;border-top:1px solid #ebebeb}
  table{border-collapse:collapse;width:100%} th{text-align:left;color:#8c8c8c;font-weight:600;border-bottom:1px solid #ebebeb;padding:10px 8px;font-size:13px;background:#fff!important} td{border-bottom:1px solid #ebebeb;padding:10px 8px;font-size:13px;vertical-align:top}
  tr:hover td{background:#f4f4f4}
  a{color:#222}
  [style*="font-family:monospace"]{font-family:ui-monospace,Menlo,Consolas,monospace!important;background:#f4f4f4!important;border:1px solid #ebebeb;color:#222}
  [style*="border-left"]{border-left-width:2px!important}
  @media print{body{background:white}.header{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body>
<div class="header">
  <div style="max-width:960px;margin:0 auto">
    <h1>웹 품질 종합 검사 증적 보고서</h1>
    <div class="meta">URL: ${escapeHtml(result.url)}</div>
    <div class="meta">제목: ${escapeHtml(result.pageTitle||'알 수 없음')}</div>
    <div class="meta">검사 일시: ${new Date(result.scannedAt).toLocaleString('ko-KR')}</div>
    <div class="meta">🆔 증적 ID: ${result.id}</div>
    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
      <span class="badge" style="background:rgba(255,255,255,.2)">접근성 ${(result.level||'wcag2aa').toUpperCase()}</span>
      <span class="badge" style="background:rgba(255,255,255,.2)">오탈자 검사</span>
      <span class="badge" style="background:rgba(255,255,255,.2)">링크 검사</span>
      ${result.w3c?.checkedAt ? `<span class="badge" style="background:rgba(255,255,255,.2)">W3C 표준 검사</span>` : ''}
    </div>
  </div>
</div>
<div class="container">
  <div class="section">
    <h2>종합 검사 현황</h2>
    <div class="summary-grid">
      <div class="sum-box" style="background:#fff5f4;border-color:#f7c9c3">
        <div style="font-size:11px;font-weight:600;color:#ef6253;margin-bottom:4px">접근성 위반</div>
        <div style="font-size:32px;font-weight:800;color:#ef6253">${result.summary.violations}</div>
        <div style="font-size:11px;color:#8c8c8c">점수: ${result.score}/100</div>
      </div>
      <div class="sum-box" style="background:${sp.totalIssues>0?'#f4f4f4':'#f1faf5'};border-color:${sp.totalIssues>0?'#ebebeb':'#bfe8d0'}">
        <div style="font-size:11px;font-weight:600;color:${sp.totalIssues>0?'#222222':'#41b979'};margin-bottom:4px">오탈자</div>
        <div style="font-size:32px;font-weight:800;color:${sp.totalIssues>0?'#222222':'#41b979'}">${sp.totalIssues||0}</div>
        <div style="font-size:11px;color:#8c8c8c">총 ${sp.totalWords||0}개 단어 검사</div>
      </div>
      <div class="sum-box" style="background:${lk.dead&&lk.dead.length>0?'#fff5f4':'#f1faf5'};border-color:${lk.dead&&lk.dead.length>0?'#f7c9c3':'#bfe8d0'}">
        <div style="font-size:11px;font-weight:600;color:${lk.dead&&lk.dead.length>0?'#ef6253':'#41b979'};margin-bottom:4px">데드링크</div>
        <div style="font-size:32px;font-weight:800;color:${lk.dead&&lk.dead.length>0?'#ef6253':'#41b979'}">${lk.dead?lk.dead.length:0}</div>
        <div style="font-size:11px;color:#8c8c8c">총 ${lk.total||0}개 링크 검사</div>
      </div>
    </div>
    ${result.w3c?.checkedAt ? `
    <div style="margin-top:12px;padding:12px 16px;border-radius:8px;background:${(result.w3c?.errorCount||0)>0?'#fff5f4':'#f1faf5'};border:1px solid ${(result.w3c?.errorCount||0)>0?'#f7c9c3':'#bfe8d0'}">
      <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">
        <div style="font-size:11px;font-weight:700;color:#222222;min-width:120px">W3C 표준 검사</div>
        <div style="text-align:center;min-width:70px">
          <div style="font-size:20px;font-weight:800;color:${(result.w3c?.errorCount||0)>0?'#ef6253':'#41b979'}">${result.w3c?.errorCount||0}</div>
          <div style="font-size:10px;color:#8c8c8c">오류</div>
        </div>
        <div style="text-align:center;min-width:70px">
          <div style="font-size:20px;font-weight:800;color:${(result.w3c?.warningCount||0)>0?'#f0a34d':'#41b979'}">${result.w3c?.warningCount||0}</div>
          <div style="font-size:10px;color:#8c8c8c">경고</div>
        </div>
        <div style="text-align:center;min-width:70px">
          <span style="font-size:13px;font-weight:700;padding:4px 12px;border-radius:20px;background:${result.w3c?.valid===true?'#f1faf5':result.w3c?.valid===false?'#fff5f4':'#f4f4f4'};color:${result.w3c?.valid===true?'#41b979':result.w3c?.valid===false?'#ef6253':'#8c8c8c'}">
            ${result.w3c?.valid===true?'유효':result.w3c?.valid===false?'무효':'미검사'}
          </span>
        </div>
      </div>
    </div>` : ''}
  </div>
  <div class="section">
    <h2>접근성 검사 결과 (${(result.level||'wcag2aa').toUpperCase()})</h2>
    <div style="display:grid;grid-template-columns:1fr 2fr;gap:20px;align-items:center;margin-bottom:20px">
      <div style="text-align:center">
        <div class="score-num">${result.score}</div>
        <div style="font-size:14px;color:#8c8c8c">/ 100점</div>
      </div>
      <div class="stats">
        <div class="stat"><div class="stat-num" style="color:#ef6253">${result.summary.violations}</div><div style="font-size:11px;color:#8c8c8c">위반</div></div>
        <div class="stat"><div class="stat-num" style="color:#41b979">${result.summary.passes}</div><div style="font-size:11px;color:#8c8c8c">통과</div></div>
        <div class="stat"><div class="stat-num" style="color:#f0a34d">${result.summary.incomplete}</div><div style="font-size:11px;color:#8c8c8c">검토필요</div></div>
        <div class="stat"><div class="stat-num" style="color:#8c8c8c">${result.summary.inapplicable}</div><div style="font-size:11px;color:#8c8c8c">해당없음</div></div>
      </div>
    </div>
    <div class="impact-grid">
      <div class="impact-item" style="background:#ef6253"><div class="num">${result.summary.impactCounts.critical||0}</div><div class="lbl">치명적</div></div>
      <div class="impact-item" style="background:#f0a34d"><div class="num">${result.summary.impactCounts.serious||0}</div><div class="lbl">심각</div></div>
      <div class="impact-item" style="background:#f0a34d"><div class="num">${result.summary.impactCounts.moderate||0}</div><div class="lbl">보통</div></div>
      <div class="impact-item" style="background:#41b979"><div class="num">${result.summary.impactCounts.minor||0}</div><div class="lbl">경미</div></div>
    </div>
    ${result.violations.length > 0 ? `<div style="margin-top:20px">${violationsHtml}</div>` : '<div style="text-align:center;padding:32px;color:#41b979;font-size:16px;font-weight:700">위반 항목 없음!</div>'}
  </div>
  ${screenshotSection}
  <div class="section">
    <h2>오탈자 검사 결과</h2>
    <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
      <div style="background:#f5f3ff;padding:10px 16px;border-radius:8px;text-align:center;min-width:100px">
        <div style="font-size:22px;font-weight:800;color:#222222">${sp.koreanIssues||0}</div>
        <div style="font-size:11px;color:#8c8c8c">한글 오탈자</div>
      </div>
      <div style="background:#f4f4f4;padding:10px 16px;border-radius:8px;text-align:center;min-width:100px">
        <div style="font-size:22px;font-weight:800;color:#8c8c8c">${sp.totalWords||0}</div>
        <div style="font-size:11px;color:#8c8c8c">검사 어절 수</div>
      </div>
    </div>
    ${spellingHtml}
  </div>
  <div class="section">
    <h2>링크 검사 결과</h2>
    <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
      <div style="background:#fff5f4;padding:10px 16px;border-radius:8px;text-align:center;min-width:100px">
        <div style="font-size:22px;font-weight:800;color:#ef6253">${lk.dead?lk.dead.length:0}</div>
        <div style="font-size:11px;color:#8c8c8c">데드링크</div>
      </div>
      <div style="background:#f1faf5;padding:10px 16px;border-radius:8px;text-align:center;min-width:100px">
        <div style="font-size:22px;font-weight:800;color:#41b979">${lk.live||0}</div>
        <div style="font-size:11px;color:#8c8c8c">정상 링크</div>
      </div>
    </div>
    ${deadLinksHtml}
  </div>
  ${result.w3c?.checkedAt ? `
  <div class="section">
    <h2>W3C 표준 검사 결과</h2>
    <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
      <div style="background:${(result.w3c?.errorCount||0)>0?'#fff5f4':'#f1faf5'};padding:10px 16px;border-radius:8px;text-align:center;min-width:100px">
        <div style="font-size:22px;font-weight:800;color:${(result.w3c?.errorCount||0)>0?'#ef6253':'#41b979'}">${result.w3c?.errorCount||0}</div>
        <div style="font-size:11px;color:#8c8c8c">오류</div>
      </div>
      <div style="background:${(result.w3c?.warningCount||0)>0?'#fff8ef':'#f1faf5'};padding:10px 16px;border-radius:8px;text-align:center;min-width:100px">
        <div style="font-size:22px;font-weight:800;color:${(result.w3c?.warningCount||0)>0?'#f0a34d':'#41b979'}">${result.w3c?.warningCount||0}</div>
        <div style="font-size:11px;color:#8c8c8c">경고</div>
      </div>
      <div style="background:#f4f4f4;padding:10px 16px;border-radius:8px;text-align:center;min-width:100px">
        <div style="font-size:13px;font-weight:700;padding:4px 8px;border-radius:12px;display:inline-block;background:${result.w3c?.valid===true?'#f1faf5':result.w3c?.valid===false?'#fff5f4':'#ebebeb'};color:${result.w3c?.valid===true?'#41b979':result.w3c?.valid===false?'#ef6253':'#8c8c8c'}">
          ${result.w3c?.valid===true?'유효':result.w3c?.valid===false?'무효':'미검사'}
        </div>
        <div style="font-size:11px;color:#8c8c8c;margin-top:4px">유효성</div>
      </div>
      ${result.w3c?.fatalCount>0?`<div style="background:#fff5f4;padding:10px 16px;border-radius:8px;text-align:center;min-width:100px">
        <div style="font-size:22px;font-weight:800;color:#ef6253">${result.w3c?.fatalCount}</div>
        <div style="font-size:11px;color:#8c8c8c">치명적 오류</div>
      </div>`:''}
    </div>
    ${result.w3c?.errors?.length > 0 ? `
    <div style="margin-bottom:12px"><strong style="font-size:13px;color:#ef6253">오류 목록 (${result.w3c.errors.length}건)</strong></div>
    ${result.w3c.errors.slice(0,20).map((e,i) => `
    <div style="border-left:4px solid #ef6253;margin-bottom:10px;padding:10px 14px;background:#fff5f4;border-radius:0 6px 6px 0;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="flex:1">
          <div style="font-size:12px;font-weight:600;color:#222222;margin-bottom:4px">${escapeHtml(e.message)}</div>
          ${e.extract?`<div style="font-family:monospace;font-size:11px;background:#fff5f4;padding:3px 8px;border-radius:4px;color:#7f1d1d;word-break:break-all">${escapeHtml(e.extract)}</div>`:''}
        </div>
        ${e.lastLine?`<span style="font-size:10px;color:#8c8c8c;white-space:nowrap">L${e.lastLine}${e.lastColumn?':C'+e.lastColumn:''}</span>`:''}
      </div>
      ${e.subType==='fatal'?`<span style="background:#ef6253;color:white;font-size:10px;padding:1px 6px;border-radius:4px;margin-top:4px;display:inline-block">치명적</span>`:''}
    </div>`).join('')}
    ${result.w3c.errors.length > 20 ? `<div style="text-align:center;color:#8c8c8c;font-size:12px;padding:8px">... 외 ${result.w3c.errors.length-20}건 (엑셀 보고서 참조)</div>` : ''}
    ` : '<div style="text-align:center;padding:20px;color:#41b979;font-weight:600">W3C 오류가 없습니다.</div>'}
    ${result.w3c?.warnings?.length > 0 ? `
    <div style="margin-top:12px;margin-bottom:8px"><strong style="font-size:13px;color:#f0a34d">경고 목록 (${result.w3c.warnings.length}건)</strong></div>
    ${result.w3c.warnings.slice(0,10).map((w,i) => `
    <div style="border-left:4px solid #f0a34d;margin-bottom:8px;padding:8px 12px;background:#fff8ef;border-radius:0 6px 6px 0;">
      <div style="font-size:12px;color:#222222;">${escapeHtml(w.message)}</div>
      ${w.extract?`<div style="font-family:monospace;font-size:11px;background:#fff8ef;padding:2px 6px;border-radius:3px;color:#78350f;margin-top:3px;word-break:break-all">${escapeHtml(w.extract)}</div>`:''}
    </div>`).join('')}
    ${result.w3c.warnings.length > 10 ? `<div style="text-align:center;color:#8c8c8c;font-size:12px;padding:4px">... 외 ${result.w3c.warnings.length-10}건</div>` : ''}
    ` : ''}
    <div style="font-size:10px;color:#8c8c8c;margin-top:8px">검사 기준: W3C Markup Validation Service (validator.w3.org/nu) | 검사 일시: ${result.w3c?.checkedAt ? new Date(result.w3c.checkedAt).toLocaleString('ko-KR') : '-'}</div>
  </div>` : ''}
  <div class="footer">
    <p>본 보고서는 가디언즈 오브 갤럭시 자동 검사 증적입니다. (axe-core + Playwright)</p>
    <p>생성: ${new Date().toLocaleString('ko-KR')}</p>
  </div>
</div>
</body>
</html>`
}

function generateBatchReportHtml(session) {
  const results = session.results
  const avgScore = results.filter(r => r.score !== undefined).length > 0
    ? Math.round(results.filter(r => r.score !== undefined).reduce((sum, r) => sum + (r.score || 0), 0) / results.filter(r => r.score !== undefined).length)
    : 0
  const totalViolations = results.reduce((sum, r) => sum + (r.summary?.violations || 0), 0)
  const totalSpelling = results.reduce((sum, r) => sum + (r.spelling?.totalIssues || 0), 0)
  const totalDeadLinks = results.reduce((sum, r) => sum + (r.links?.dead?.length || 0), 0)
  const totalW3cErrors = results.reduce((sum, r) => sum + (r.w3c?.errorCount || 0), 0)
  const w3cInvalidCount = results.filter(r => r.w3c?.valid === false).length
  const w3cChecked = results.some(r => r.w3c?.checkedAt)
  const errored = results.filter(r => r.status === 'error').length

  const rowsHtml = results.map((r, i) => {
    const scoreColor = r.score >= 80 ? '#41b979' : r.score >= 50 ? '#f0a34d' : '#ef6253'
    const status = r.status === 'error' ? '오류' : '완료'
    const w3cCell = w3cChecked
      ? `<td style="padding:10px 12px;text-align:center;font-size:12px;">
          ${r.w3c?.checkedAt
            ? `<span style="color:${(r.w3c?.errorCount||0)>0?'#ef6253':'#41b979'};font-weight:700">${r.w3c?.errorCount||0}</span><span style="color:#8c8c8c;font-size:10px">/</span><span style="color:${r.w3c?.valid===false?'#ef6253':r.w3c?.valid===true?'#41b979':'#8c8c8c'};font-weight:600;font-size:11px">${r.w3c?.valid===true?'유효':r.w3c?.valid===false?'무효':'?'}</span>`
            : '<span style="color:#8c8c8c">-</span>'}</td>`
      : ''
    return `
    <tr style="border-bottom:1px solid #ebebeb;${i%2===0?'background:#fff':'background:#f4f4f4'}">
      <td style="padding:10px 12px;font-size:12px;color:#8c8c8c">${i+1}</td>
      <td style="padding:10px 12px;">
        <div style="font-size:13px;font-weight:600;color:#222222;margin-bottom:2px">${escapeHtml(r.pageTitle||'제목없음')}</div>
        <div style="font-size:11px;color:#8c8c8c;word-break:break-all">${escapeHtml(r.url||r.originalUrl||'')}</div>
      </td>
      <td style="padding:10px 12px;text-align:center">
        <span style="font-size:20px;font-weight:800;color:${scoreColor}">${r.score !== undefined ? r.score : '-'}</span>
      </td>
      <td style="padding:10px 12px;text-align:center;color:#ef6253;font-weight:700">${r.summary?.violations || '-'}</td>
      <td style="padding:10px 12px;text-align:center;color:#222222;font-weight:700">${r.spelling?.totalIssues ?? '-'}</td>
      <td style="padding:10px 12px;text-align:center;color:#ef6253;font-weight:700">${r.links?.dead?.length ?? '-'}</td>
      ${w3cCell}
      <td style="padding:10px 12px;text-align:center;font-size:12px">${status}</td>
    </tr>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>배치 검사 종합 보고서 - ${escapeHtml(session.id)}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html{overflow-y:scroll}
  body{font-family:"Pretendard Variable",Pretendard,-apple-system,"Malgun Gothic","맑은 고딕",sans-serif;background:#fff;color:#222;letter-spacing:-.01em;line-height:1.5}
  .header{background:#fff!important;color:#222!important;padding:0;border-bottom:1px solid #ebebeb}
  .header > div{max-width:1180px!important;margin:0 auto;padding:36px 40px 28px}
  .header h1{font-size:34px;font-weight:800;letter-spacing:-.04em;margin-bottom:10px;color:#222}
  .header h1::before{content:"가디언즈";display:block;font-size:13px;font-weight:600;color:#8c8c8c;letter-spacing:0;margin-bottom:6px}
  .header .meta,.meta{font-size:13px;color:#8c8c8c;margin-top:3px;opacity:1}
  .container{max-width:1180px;margin:0 auto;padding:28px 40px 80px}
  .section{background:#fff;border-radius:0;padding:28px 0;margin-bottom:0;box-shadow:none;border-bottom:1px solid #ebebeb}
  .section h2{font-size:22px;font-weight:700;letter-spacing:-.03em;margin-bottom:18px;color:#222;border-bottom:0;padding-bottom:0}
  .section h3{font-size:15px;font-weight:700;margin:14px 0 8px}
  .score-num{font-size:72px;font-weight:800;color:#222;line-height:1;letter-spacing:-.05em}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid #ebebeb;border-radius:10px;overflow:hidden}
  .stat{text-align:left;padding:18px 20px;background:#fff;border-radius:0;border-right:1px solid #ebebeb}
  .stat:last-child{border-right:0}
  .stat-num{font-size:30px;font-weight:800;letter-spacing:-.04em}
  .impact-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
  .impact-item{padding:14px 16px;border-radius:10px;text-align:left;background:#f4f4f4!important}
  .impact-item .num{font-size:28px;font-weight:800;color:#222;letter-spacing:-.04em}
  .impact-item .lbl{font-size:12px;color:#8c8c8c;margin-top:2px}
  .summary-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}
  .sum-box{padding:16px 18px;border-radius:10px;text-align:left;border:1px solid #ebebeb!important;background:#fff!important}
  .badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;background:#f4f4f4!important;color:#222!important}
  .footer{text-align:left;color:#8c8c8c;font-size:12px;margin-top:28px;padding:20px 0 36px;border-top:1px solid #ebebeb}
  table{border-collapse:collapse;width:100%} th{text-align:left;color:#8c8c8c;font-weight:600;border-bottom:1px solid #ebebeb;padding:10px 8px;font-size:13px;background:#fff!important} td{border-bottom:1px solid #ebebeb;padding:10px 8px;font-size:13px;vertical-align:top}
  tr:hover td{background:#f4f4f4}
  a{color:#222}
  [style*="font-family:monospace"]{font-family:ui-monospace,Menlo,Consolas,monospace!important;background:#f4f4f4!important;border:1px solid #ebebeb;color:#222}
  [style*="border-left"]{border-left-width:2px!important}
  @media print{body{background:white}.header{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body>
<div class="header">
  <div style="max-width:1100px;margin:0 auto">
    <h1>배치 검사 종합 증적 보고서</h1>
    <div class="meta">대상: 정부24(www.gov.kr/mw) 민원안내 페이지</div>
    <div class="meta">검사 일시: ${new Date(session.createdAt).toLocaleString('ko-KR')} ~ ${session.finishedAt ? new Date(session.finishedAt).toLocaleString('ko-KR') : '진행중'}</div>
    <div class="meta">🆔 세션 ID: ${escapeHtml(session.id)}</div>
    <div class="meta">총 ${session.total}개 페이지 | 완료 ${session.completed}개 | 실패 ${session.failed}개</div>
  </div>
</div>
<div class="container">
  <div class="section">
    <h2>종합 KPI</h2>
    <div class="kpi-grid">
      <div class="kpi" style="background:#eff6ff;color:#1d4ed8">
        <div class="kpi-num">${session.total}</div>
        <div class="kpi-lbl">검사 페이지 수</div>
      </div>
      <div class="kpi" style="background:${avgScore>=80?'#f1faf5':avgScore>=50?'#fff8ef':'#fff5f4'};color:${avgScore>=80?'#41b979':avgScore>=50?'#f0a34d':'#ef6253'}">
        <div class="kpi-num">${avgScore}</div>
        <div class="kpi-lbl">평균 접근성 점수</div>
      </div>
      <div class="kpi" style="background:#fff5f4;color:#ef6253">
        <div class="kpi-num">${totalViolations}</div>
        <div class="kpi-lbl">총 접근성 위반</div>
      </div>
      <div class="kpi" style="background:#f4f4f4;color:#222222">
        <div class="kpi-num">${totalSpelling}</div>
        <div class="kpi-lbl">총 오탈자</div>
      </div>
      <div class="kpi" style="background:#fff5f4;color:#ef6253">
        <div class="kpi-num">${totalDeadLinks}</div>
        <div class="kpi-lbl">총 데드링크</div>
      </div>
      ${w3cChecked ? `
      <div class="kpi" style="background:${w3cInvalidCount>0?'#fff5f4':'#f1faf5'};color:${w3cInvalidCount>0?'#ef6253':'#41b979'}">
        <div class="kpi-num">${totalW3cErrors}</div>
        <div class="kpi-lbl">W3C 오류 (${w3cInvalidCount}페이지 무효)</div>
      </div>` : ''}
    </div>
  </div>
  <div class="section">
    <h2>페이지별 검사 결과</h2>
    <table>
      <thead>
        <tr>
          <th style="width:40px">#</th>
          <th style="text-align:left">페이지</th>
          <th style="width:80px">점수</th>
          <th style="width:70px">위반</th>
          <th style="width:70px">오탈자</th>
          <th style="width:80px">데드링크</th>
          ${w3cChecked ? '<th style="width:90px">W3C 오류/유효성</th>' : ''}
          <th style="width:70px">상태</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>
  <div class="footer">
    <p>본 보고서는 가디언즈 오브 갤럭시 배치 자동 검사 증적입니다. (axe-core + Playwright)</p>
    <p>생성: ${new Date().toLocaleString('ko-KR')}</p>
  </div>
</div>
</body>
</html>`
}

// ─── 서버 시작 ───────────────────────────────────────

// ═══════════════════════════════════════════════════════════
//  웹 호환성 검사 (Cross-Browser Compatibility) — v3.9
//  Chrome / Edge / Safari(WebKit) / Firefox 렌더링 + 오류 + 증적
// ═══════════════════════════════════════════════════════════
const COMPAT_LAUNCH_ARGS = ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--mute-audio']
const compatStore = new Map()  // id → 검사 결과 (PPTX용)
const MAX_COMPAT_STORE = 300   // 대량 검사 지원 (v5.2)

function compatBrowsersPath() {
  return process.env.PLAYWRIGHT_BROWSERS_PATH || require('path').join(APP_ROOT, 'chromium')
}

function compatEngineStatus() {
  const fs = require('fs')
  const bp = compatBrowsersPath()
  const has = (prefix) => {
    try { return fs.readdirSync(bp).some(d => d.startsWith(prefix)) } catch(_) { return false }
  }
  return {
    chromium: has('chromium-'),
    webkit:   has('webkit-'),
    firefox:  has('firefox-'),
  }
}


// 폴더 내 HTML 파일 나열 (다중 로컬 검사용)
app.post('/api/compat-folder', (req, res) => {
  const fs = require('fs')
  const p  = require('path')
  try {
    const { folder } = req.body || {}
    if (!folder) return res.status(400).json({ error: '폴더 경로가 필요합니다' })
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
      return res.status(400).json({ error: '폴더를 찾을 수 없습니다: ' + folder })
    }
    const files = []
    const walk = (dir, depth) => {
      if (depth > 3 || files.length >= 100) return
      for (const name of fs.readdirSync(dir)) {
        const fp = p.join(dir, name)
        try {
          const st = fs.statSync(fp)
          if (st.isDirectory()) walk(fp, depth + 1)
          else if (/\.(html?|xhtml)$/i.test(name)) files.push(fp)
        } catch(_) {}
        if (files.length >= 100) break
      }
    }
    walk(folder, 0)
    console.log(`[호환성] 폴더 검색: ${folder} → HTML ${files.length}개`)
    res.json({ ok: true, folder, files, count: files.length })
  } catch (err) {
    res.status(500).json({ error: '폴더 검색 오류: ' + err.message })
  }
})

// 엔진 상태 조회
app.get('/api/compat-engines', (req, res) => {
  res.json({ engines: compatEngineStatus(), browsersPath: compatBrowsersPath() })
})

// WebKit/Firefox 온디맨드 설치
app.post('/api/compat-install', async (req, res) => {
  const { execFile } = require('child_process')
  const cli = require('path').join(APP_ROOT, 'node_modules', 'playwright', 'cli.js')
  const st  = compatEngineStatus()
  const targets = []
  if (!st.webkit)  targets.push('webkit')
  if (!st.firefox) targets.push('firefox')
  if (!targets.length) return res.json({ ok: true, message: '이미 설치되어 있습니다', engines: st })

  console.log('[호환성] 브라우저 엔진 설치 시작:', targets.join(', '))
  execFile(process.execPath, [cli, 'install', ...targets], {
    timeout: 15 * 60 * 1000,
    env: { ...process.env },
    maxBuffer: 20 * 1024 * 1024
  }, (err, stdout, stderr) => {
    if (err) {
      console.error('[호환성] 설치 실패:', err.message)
      return res.json({ ok: false, error: '설치 실패: ' + err.message, engines: compatEngineStatus() })
    }
    console.log('[호환성] 엔진 설치 완료')
    res.json({ ok: true, message: '설치 완료', engines: compatEngineStatus() })
  })
})

// 단일 브라우저에서 페이지 검사
async function compatScanOne(browserKey, url) {
  const started = Date.now()
  const out = {
    browser: browserKey, ok: false, engine: '', loadMs: 0,
    httpStatus: null, consoleErrors: [], pageErrors: [], failedRequests: [],
    screenshot: null, error: null, verdict: '실패'
  }
  let browser = null
  try {
    // 브라우저별 launch 전략
    if (browserKey === 'chrome') {
      try { browser = await chromium.launch({ channel: 'chrome', headless: true, args: COMPAT_LAUNCH_ARGS }); out.engine = 'Chrome(설치판)' }
      catch(_) { browser = await chromium.launch({ headless: true, args: COMPAT_LAUNCH_ARGS }); out.engine = 'Chromium(번들)' }
    } else if (browserKey === 'edge') {
      try { browser = await chromium.launch({ channel: 'msedge', headless: true, args: COMPAT_LAUNCH_ARGS }); out.engine = 'Edge(설치판)' }
      catch(_) { browser = await chromium.launch({ headless: true, args: COMPAT_LAUNCH_ARGS }); out.engine = 'Chromium(Edge 대체)' }
    } else if (browserKey === 'safari') {
      browser = await webkit.launch({ headless: true }); out.engine = 'WebKit(Safari 엔진)'
    } else if (browserKey === 'firefox') {
      browser = await firefox.launch({ headless: true }); out.engine = 'Firefox'
    } else {
      throw new Error('알 수 없는 브라우저: ' + browserKey)
    }

    const _ctxOpts = { viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true }
    if (typeof loginSession !== 'undefined' && loginSession) _ctxOpts.storageState = loginSession.storageState
    const context = await browser.newContext(_ctxOpts)
    const page = await context.newPage()

    page.on('console', msg => { if (msg.type() === 'error' && out.consoleErrors.length < 20) out.consoleErrors.push(msg.text().slice(0, 300)) })
    page.on('pageerror', err => { if (out.pageErrors.length < 20) out.pageErrors.push(String(err.message || err).slice(0, 300)) })
    page.on('requestfailed', rq => {
      const f = rq.failure()
      if (out.failedRequests.length < 15) out.failedRequests.push({ url: rq.url().slice(0, 200), reason: f ? f.errorText : '' })
    })

    const resp = await page.goto(url, { waitUntil: 'load', timeout: 45000 })
    out.httpStatus = resp ? resp.status() : null
    await page.waitForTimeout(2500)  // 렌더링 안정화

    const shot = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: false })
    out.screenshot = shot.toString('base64')
    out.loadMs = Date.now() - started
    out.ok = true

    // 판정
    const httpOk = out.httpStatus && out.httpStatus < 400
    const errCnt = out.consoleErrors.length + out.pageErrors.length
    out.verdict = !httpOk ? '실패' : errCnt === 0 ? '정상' : '오류 감지'

    await browser.close(); browser = null
  } catch (err) {
    out.error = String(err.message || err).slice(0, 300)
    out.loadMs = Date.now() - started
    if (/Executable doesn't exist|browserType.launch/.test(out.error)) {
      out.error = '브라우저 엔진 미설치 — [엔진 설치] 버튼으로 설치하세요'
    }
    if (browser) await browser.close().catch(() => {})
  }
  return out
}

// 호환성 검사 실행
app.post('/api/compat-scan', async (req, res) => {
  try {
    const { url, browsers } = req.body || {}
    if (!url) return res.status(400).json({ error: 'URL이 필요합니다' })
    const targets = (Array.isArray(browsers) && browsers.length ? browsers : ['chrome','edge','safari','firefox'])
      .filter(b => ['chrome','edge','safari','firefox'].includes(b))

    let pageUrl = url.trim()
    if (/^[a-zA-Z]:[\\/]/.test(pageUrl)) {
      // Windows 로컬 파일 경로 → file:/// URL 변환
      pageUrl = 'file:///' + pageUrl.replace(/\\/g, '/')
    } else if (!/^https?:\/\//i.test(pageUrl) && !/^file:/i.test(pageUrl)) {
      pageUrl = 'https://' + pageUrl
    }

    console.log(`[호환성] 검사 시작: ${pageUrl} (${targets.join(', ')})`)

    // 순차 실행 (메모리 절약 — 브라우저 3~4개 동시 실행 방지)
    const results = []
    for (const b of targets) {
      console.log(`[호환성]   ${b} 검사 중...`)
      results.push(await compatScanOne(b, pageUrl))
    }

    // 페이지 제목 (성공한 첫 결과에서)
    let pageTitle = pageUrl
    const okOne = results.find(r => r.ok)

    const id = 'compat_' + Date.now()
    const record = {
      id, url: pageUrl, pageTitle,
      scannedAt: new Date().toISOString(),
      results,
      summary: {
        total: results.length,
        normal: results.filter(r => r.verdict === '정상').length,
        warning: results.filter(r => r.verdict === '오류 감지').length,
        failed: results.filter(r => r.verdict === '실패').length,
      }
    }
    if (compatStore.size >= MAX_COMPAT_STORE) compatStore.delete(compatStore.keys().next().value)
    compatStore.set(id, record)

    console.log(`[호환성] 완료: 정상 ${record.summary.normal} / 오류 ${record.summary.warning} / 실패 ${record.summary.failed}`)
    res.json(record)
  } catch (err) {
    console.error('[호환성] 오류:', err.message)
    res.status(500).json({ error: '호환성 검사 오류: ' + err.message })
  }
})

// 호환성 PPTX 증적 문서 생성
app.post('/api/compat-pptx', async (req, res) => {
  try {
    const { ids, meta } = req.body || {}
    const records = (ids || []).map(i => compatStore.get(i)).filter(Boolean)
    if (!records.length) return res.status(400).json({ error: '검사 결과가 없습니다. 먼저 호환성 검사를 실행하세요.' })

    const buf = await generateCompatPptx(records, meta || {})
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    res.setHeader('Content-Disposition', `attachment; filename="compat-report-${Date.now()}.pptx"`)
    res.send(buf)
  } catch (err) {
    console.error('[호환성 PPTX] 오류:', err.message)
    res.status(500).json({ error: 'PPTX 생성 오류: ' + err.message })
  }
})

async function generateCompatPptx(records, meta = {}) {
  const fs = require('fs')
  const { execFile } = require('child_process')
  const execFileAsync = require('util').promisify(execFile)
  const ts = Date.now()
  const tmpDir   = require('os').tmpdir()
  const dataFile = require('path').join(tmpDir, 'gcompat_' + ts + '.json')
  const outFile  = require('path').join(tmpDir, 'gcompat_' + ts + '_out.pptx')
  const mediaDir = require('path').join(APP_ROOT, 'pptx_assets', 'media')

  fs.writeFileSync(dataFile, JSON.stringify({ type: 'compat', records, meta }, null, 2), 'utf-8')

  const nodeScript = require('path').join(APP_ROOT, 'pptx_node.js')
  const nodeExe    = require('path').join(APP_ROOT, 'runtime', 'node.exe')
  const nodeCmd    = (process.platform === 'win32' && fs.existsSync(nodeExe)) ? nodeExe : process.execPath

  try {
    const { stdout } = await execFileAsync(nodeCmd, [nodeScript, dataFile, outFile, mediaDir],
      { timeout: 600000, maxBuffer: 50 * 1024 * 1024 })
    if (stdout) console.log('[호환성 PPTX]', stdout.trim())
  } finally {
    try { fs.unlinkSync(dataFile) } catch(_) {}
  }
  const buf = fs.readFileSync(outFile)
  try { fs.unlinkSync(outFile) } catch(_) {}
  return buf
}



// ═══════════════════════════════════════════════════════════
//  KRDS 전용 검사 (접근성 검사 제외, KRDS 규칙만) — v4.3
//  난이도: required(필수 17) / standard(표준 29) / full(전체 36)
// ═══════════════════════════════════════════════════════════
const krdsStore = new Map()
const MAX_KRDS_STORE = 300   // 대량 검사 지원 (v5.2)
const KRDS_TIER_LABEL = { required: '필수 검사', standard: '표준 검사', full: '전체 검사' }

function filterKrdsByTier(items, tier) {
  if (tier === 'required') return items.filter(i => i.level === '필수')
  if (tier === 'standard') return items.filter(i => i.level === '필수' || !String(i.id).startsWith('krds-'))
  return items
}

// KRDS 단독 검사 (axe 없이 — 빠름)
app.post('/api/krds-scan', async (req, res) => {
  let browser = null
  try {
    const { url, tier = 'standard', excludeCommon = false } = req.body || {}
    if (!url) return res.status(400).json({ error: 'URL이 필요합니다' })

    let pageUrl = url.trim()
    if (/^[a-zA-Z]:[\\/]/.test(pageUrl)) {
      pageUrl = 'file:///' + pageUrl.replace(/\\/g, '/')
    } else if (!/^https?:\/\//i.test(pageUrl) && !/^file:/i.test(pageUrl)) {
      pageUrl = 'https://' + pageUrl
    }

    console.log(`[KRDS 단독] 검사: ${pageUrl} (${KRDS_TIER_LABEL[tier] || tier})`)

    browser = await chromium.launch({ headless: true, args: COMPAT_LAUNCH_ARGS })
    const ctxOpts = { viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true }
    if (loginSession) ctxOpts.storageState = loginSession.storageState  // 로그인 세션 적용
    const context = await browser.newContext(ctxOpts)
    const page = await context.newPage()
    const resp = await page.goto(pageUrl, { waitUntil: 'load', timeout: 45000 })
    await page.waitForTimeout(2000)

    const pageTitle = await page.title().catch(() => pageUrl)
    const htmlSource = await page.content().catch(() => '')

    // 기존 checkKRDS 재사용 (전체 실행 후 tier 필터)
    const full = await checkKRDS(page, htmlSource, pageUrl)
    try { await KRDS_DEEP.applyDeep(page, full) } catch (_) {}
    let items = filterKrdsByTier(full.items || [], tier)
    // 컨테이너만 검사: 모든 페이지가 공유하는 공통영역(헤더/푸터 등) 규칙 제외
    const COMMON_RULE_IDS = ['header','footer','nav','skip-nav','official-banner','breadcrumb',
      'search','copyright','privacy','logo-alt','krds-header-nav','krds-skip-nav']
    if (excludeCommon) items = items.filter(i => !COMMON_RULE_IDS.includes(i.id))

    const passed = items.filter(i => i.passed === true).length
    const partial = items.filter(i => i.passed === false && i.partial).length
    const failed = items.filter(i => i.passed === false && !i.partial).length
    const total  = items.length
    const score  = total > 0 ? Math.round(((passed + partial * 0.5) / total) * 100) : 0   // 정밀 판정: 준수 1 · 부분 0.5 · 미준수 0

    let tokens = null; try { tokens = await KRDS_TOKENS.tokenScan(page) } catch (e) { tokens = { error: e.message } }
    const shot = await page.screenshot({ type: 'jpeg', quality: 70 }).catch(() => null)
    await browser.close(); browser = null

    const id = 'krds_' + Date.now() + Math.random().toString(36).slice(2, 6)
    const record = {
      id, url: pageUrl, pageTitle,
      tier, tierLabel: (KRDS_TIER_LABEL[tier] || tier) + (excludeCommon ? ' · 컨테이너만' : ''),
      scannedAt: new Date().toISOString(),
      httpStatus: resp ? resp.status() : null,
      score, passed, partial, failed, total, scoring: '준수 1 · 부분 준수 0.5 · 미준수 0', deep: true,
      items, tokens,
      screenshot: shot ? shot.toString('base64') : null,
    }
    if (krdsStore.size >= MAX_KRDS_STORE) krdsStore.delete(krdsStore.keys().next().value)
    krdsStore.set(id, record)

    console.log(`[KRDS 단독] 완료: 준수율 ${score}% (${passed}/${total})`)
    // 응답은 스크린샷 제외한 경량 + 스크린샷 별도 포함 (화면 표시용)
    res.json(record)
  } catch (err) {
    if (browser) await browser.close().catch(() => {})
    console.error('[KRDS 단독] 오류:', err.message)
    res.status(500).json({ error: 'KRDS 검사 오류: ' + err.message })
  }
})

// KRDS 전용 PPTX 결과서
app.post('/api/krds-pptx', async (req, res) => {
  try {
    const fs = require('fs')
    const { ids, meta } = req.body || {}
    const records = (ids || []).map(i => krdsStore.get(i)).filter(Boolean)
    if (!records.length) return res.status(400).json({ error: '검사 결과가 없습니다. 먼저 KRDS 검사를 실행하세요.' })
    if (records.length < (ids || []).length)
      console.warn(`[KRDS PPTX] 요청 ${ids.length}건 중 ${records.length}건만 보관 중 (초과분 소실)`)

    const { execFile } = require('child_process')
    const execFileAsync = require('util').promisify(execFile)
    const ts = Date.now()
    const tmpDir   = require('os').tmpdir()
    const dataFile = require('path').join(tmpDir, 'gkrds_' + ts + '.json')
    const outFile  = require('path').join(tmpDir, 'gkrds_' + ts + '_out.pptx')
    const mediaDir = require('path').join(APP_ROOT, 'pptx_assets', 'media')

    fs.writeFileSync(dataFile, JSON.stringify({ type: 'krds', records, meta: meta || {} }, null, 2), 'utf-8')

    const nodeScript = require('path').join(APP_ROOT, 'pptx_node.js')
    const nodeExe    = require('path').join(APP_ROOT, 'runtime', 'node.exe')
    const nodeCmd    = (process.platform === 'win32' && fs.existsSync(nodeExe)) ? nodeExe : process.execPath

    try {
      const { stdout } = await execFileAsync(nodeCmd, [nodeScript, dataFile, outFile, mediaDir],
        { timeout: 600000, maxBuffer: 50 * 1024 * 1024 })
      if (stdout) console.log('[KRDS PPTX]', stdout.trim())
    } finally {
      try { fs.unlinkSync(dataFile) } catch(_) {}
    }
    const buf = fs.readFileSync(outFile)
    try { fs.unlinkSync(outFile) } catch(_) {}

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    res.setHeader('Content-Disposition', `attachment; filename="krds-report-${Date.now()}.pptx"`)
    res.send(buf)
  } catch (err) {
    console.error('[KRDS PPTX] 오류:', err.message)
    res.status(500).json({ error: 'PPTX 생성 오류: ' + err.message })
  }
})



// ═══════════════════════════════════════════════════════════
//  로그인 세션 지원 — v4.4
//  아이디/비밀번호만 입력하면 자동으로 로그인 → 세션 저장 →
//  이후 KRDS/호환성 검사가 로그인된 상태로 진행
// ═══════════════════════════════════════════════════════════
let loginSession = null  // { storageState, loginUrl, savedAt, username }

app.get('/api/login-status', (req, res) => {
  res.json(loginSession
    ? { active: true, loginUrl: loginSession.loginUrl, username: loginSession.username, savedAt: loginSession.savedAt }
    : { active: false })
})

app.post('/api/login-clear', (req, res) => {
  loginSession = null
  console.log('[로그인] 세션 해제')
  res.json({ ok: true })
})

// 자동 로그인: 비밀번호 필드를 찾고, 그 주변의 아이디 필드를 자동 감지
app.post('/api/login-setup', async (req, res) => {
  let browser = null
  try {
    const { loginUrl, username, password } = req.body || {}
    if (!loginUrl || !username || !password) {
      return res.status(400).json({ error: '로그인 페이지 URL, 아이디, 비밀번호가 모두 필요합니다' })
    }
    let pageUrl = loginUrl.trim()
    if (!/^https?:\/\//i.test(pageUrl)) pageUrl = 'https://' + pageUrl

    console.log(`[로그인] 시도: ${pageUrl} (${username})`)
    browser = await chromium.launch({ headless: true, args: COMPAT_LAUNCH_ARGS })
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })
    const page = await context.newPage()
    await page.goto(pageUrl, { waitUntil: 'load', timeout: 45000 })
    await page.waitForTimeout(1500)

    // ① 비밀번호 필드 찾기 (보이는 것 우선)
    const pwFields = await page.$$('input[type="password"]')
    let pwField = null
    for (const f of pwFields) { if (await f.isVisible().catch(()=>false)) { pwField = f; break } }
    if (!pwField && pwFields.length) pwField = pwFields[0]
    if (!pwField) throw new Error('비밀번호 입력 필드를 찾지 못했습니다. 로그인 페이지 URL을 확인하세요.')

    // ② 아이디 필드: 같은 form 내 text/email/tel 중 비밀번호보다 앞의 보이는 필드
    const idField = await page.evaluateHandle((pw) => {
      const form = pw.closest('form') || document
      const cands = Array.from(form.querySelectorAll(
        'input[type="text"], input[type="email"], input[type="tel"], input:not([type])'
      )).filter(el => el.offsetParent !== null && !el.readOnly && !el.disabled)
      // 비밀번호 필드보다 앞에 있는 마지막 후보 (일반적 배치)
      const before = cands.filter(el => (pw.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING))
      return before.length ? before[before.length-1] : (cands[0] || null)
    }, pwField)
    const idEl = idField.asElement()
    if (!idEl) throw new Error('아이디 입력 필드를 찾지 못했습니다.')

    // ③ 입력 + 제출
    await idEl.fill(username)
    await pwField.fill(password)
    const beforeUrl = page.url()

    // 제출: form의 submit 버튼 → 없으면 Enter
    const submitted = await page.evaluate((pw) => {
      const form = pw.closest('form')
      if (!form) return false
      const btn = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])')
      if (btn) { btn.click(); return true }
      return false
    }, pwField)
    if (!submitted) await pwField.press('Enter')

    await page.waitForLoadState('load', { timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(3000)

    // ④ 성공 판정: URL 변경 또는 비밀번호 필드 소멸
    const afterUrl = page.url()
    const stillPw = await page.$$eval('input[type="password"]',
      els => els.some(e => e.offsetParent !== null)).catch(() => false)
    const success = (afterUrl !== beforeUrl) || !stillPw

    // 로그인 후 화면 증거 캡처
    const shot = await page.screenshot({ type: 'jpeg', quality: 60 }).catch(() => null)

    if (!success) {
      await browser.close()
      return res.json({ ok: false,
        error: '로그인이 완료되지 않은 것 같습니다 (URL 변화 없음). 아이디/비밀번호를 확인하거나, CAPTCHA·2단계 인증이 있는 사이트는 지원되지 않습니다.',
        screenshot: shot ? shot.toString('base64') : null })
    }

    // ⑤ 세션(쿠키+스토리지) 저장
    const storageState = await context.storageState()
    await browser.close(); browser = null

    loginSession = { storageState, loginUrl: pageUrl, username, savedAt: new Date().toISOString() }
    console.log(`[로그인] 성공 — 세션 저장 (쿠키 ${storageState.cookies.length}개)`)
    res.json({ ok: true, afterUrl, cookies: storageState.cookies.length,
      screenshot: shot ? shot.toString('base64') : null })
  } catch (err) {
    if (browser) await browser.close().catch(() => {})
    console.error('[로그인] 오류:', err.message)
    res.status(500).json({ error: '로그인 실패: ' + err.message })
  }
})



// ═══════════════════════════════════════════════════════════
//  웹 보안 점검 (수동/읽기 전용) — v5.6
//  페이지를 열어 읽기만 하여 7개 항목 점검 (서버에 무해)
// ═══════════════════════════════════════════════════════════
const securityStore = new Map()
const MAX_SECURITY_STORE = 300

// 민감정보 노출 패턴 (소스에서 탐지)
const SECRET_PATTERNS = [
  { re: /(?:api[_-]?key|apikey|access[_-]?token|secret[_-]?key)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/gi, label: 'API 키/토큰 추정 문자열' },
  { re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g, label: '개인 키(Private Key)' },
  { re: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/gi, label: '비밀번호 추정 값' },
  { re: /AKIA[0-9A-Z]{16}/g, label: 'AWS 액세스 키 추정' },
  { re: /<!--[\s\S]{0,400}?(?:TODO|FIXME|password|비밀번호|테스트|내부|admin)[\s\S]{0,400}?-->/gi, label: '민감 정보가 담긴 주석' },
]

function checkSecurity(respHeaders, cookies, htmlSource, pageUrl, isHttps) {
  const items = []
  const H = {}
  for (const k in (respHeaders || {})) H[k.toLowerCase()] = respHeaders[k]

  // ① HTTPS 적용
  items.push({
    id: 'https', category: '전송 보안', name: 'HTTPS 적용', level: '필수',
    passed: isHttps,
    detail: isHttps ? 'HTTPS로 통신합니다' : 'HTTP로 통신 — 전송 구간이 암호화되지 않습니다',
    recommend: isHttps ? '' : 'TLS 인증서를 적용하고 HTTP→HTTPS 리다이렉트를 설정하세요',
  })

  // ② 보안 헤더 5종
  const secHeaders = [
    { key: 'content-security-policy',     nm: 'Content-Security-Policy',    tip: 'XSS·데이터 주입 완화를 위해 CSP를 설정하세요' },
    { key: 'strict-transport-security',   nm: 'HSTS',                       tip: 'HTTPS 강제를 위해 Strict-Transport-Security를 설정하세요' },
    { key: 'x-frame-options',             nm: 'X-Frame-Options',            tip: '클릭재킹 방어를 위해 DENY 또는 SAMEORIGIN을 설정하세요' },
    { key: 'x-content-type-options',      nm: 'X-Content-Type-Options',     tip: 'MIME 스니핑 차단을 위해 nosniff를 설정하세요' },
    { key: 'referrer-policy',             nm: 'Referrer-Policy',            tip: '참조 정보 유출 완화를 위해 Referrer-Policy를 설정하세요' },
  ]
  for (const sh of secHeaders) {
    const has = !!H[sh.key]
    items.push({
      id: 'hdr-' + sh.key, category: '보안 헤더', name: sh.nm, level: sh.key==='content-security-policy'?'필수':'권장',
      passed: has,
      detail: has ? `설정됨: ${String(H[sh.key]).slice(0, 60)}` : '헤더가 없습니다',
      recommend: has ? '' : sh.tip,
    })
  }

  // ③ 쿠키 보안 속성
  if (cookies && cookies.length) {
    const insecure = cookies.filter(c => !c.secure || !c.httpOnly)
    items.push({
      id: 'cookie', category: '쿠키 보안', name: '쿠키 보안 속성(Secure·HttpOnly)', level: '권장',
      passed: insecure.length === 0,
      detail: insecure.length === 0
        ? `쿠키 ${cookies.length}개 모두 보안 속성 적용`
        : `${insecure.length}/${cookies.length}개 쿠키에 Secure 또는 HttpOnly 누락`,
      recommend: insecure.length === 0 ? '' : '세션 쿠키에 Secure·HttpOnly·SameSite 속성을 설정하세요',
    })
  } else {
    items.push({
      id: 'cookie', category: '쿠키 보안', name: '쿠키 보안 속성(Secure·HttpOnly)', level: '권장',
      passed: null, detail: '쿠키가 없습니다 (해당 없음)', recommend: '',
    })
  }

  // ④ 민감정보 노출
  const hits = []
  for (const p of SECRET_PATTERNS) {
    const m = (htmlSource || '').match(p.re)
    if (m && m.length) hits.push(`${p.label} ${m.length}건`)
  }
  items.push({
    id: 'secrets', category: '정보 노출', name: '민감정보 노출', level: '필수',
    passed: hits.length === 0,
    detail: hits.length === 0 ? '소스에서 민감정보 패턴이 발견되지 않았습니다' : ('발견: ' + hits.join(', ')),
    recommend: hits.length === 0 ? '' : '키·비밀번호·내부 주석을 소스에서 제거하고 서버측으로 이동하세요',
  })

  // ⑤ 서버정보 노출
  const server = H['server'] || ''
  const powered = H['x-powered-by'] || ''
  const verExposed = /[0-9]+\.[0-9]+/.test(server) || !!powered
  items.push({
    id: 'server-info', category: '정보 노출', name: '서버 정보 노출', level: '권장',
    passed: !verExposed,
    detail: verExposed ? `노출: ${[server, powered].filter(Boolean).join(' / ').slice(0, 70)}` : '서버 버전 정보가 노출되지 않았습니다',
    recommend: verExposed ? 'Server·X-Powered-By 헤더에서 버전 정보를 숨기세요' : '',
  })

  // ⑥ 외부링크 안전성 (target=_blank + rel=noopener 누락)
  const blankLinks = (htmlSource || '').match(/<a\b[^>]*target\s*=\s*['"]_blank['"][^>]*>/gi) || []
  const unsafe = blankLinks.filter(a => !/rel\s*=\s*['"][^'"]*noopener/i.test(a))
  items.push({
    id: 'tabnabbing', category: '링크 보안', name: '외부링크 안전성(rel=noopener)', level: '권장',
    passed: unsafe.length === 0,
    detail: unsafe.length === 0
      ? (blankLinks.length ? `새 창 링크 ${blankLinks.length}개 모두 안전` : '새 창 링크가 없습니다')
      : `${unsafe.length}/${blankLinks.length}개 새 창 링크에 rel="noopener" 누락`,
    recommend: unsafe.length === 0 ? '' : 'target="_blank" 링크에 rel="noopener noreferrer"를 추가하세요',
  })

  // ⑦ 혼합 콘텐츠 (HTTPS 페이지의 HTTP 리소스)
  if (isHttps) {
    const mixed = (htmlSource || '').match(/(?:src|href)\s*=\s*['"]http:\/\/[^'"]+['"]/gi) || []
    items.push({
      id: 'mixed-content', category: '전송 보안', name: '혼합 콘텐츠', level: '권장',
      passed: mixed.length === 0,
      detail: mixed.length === 0 ? 'HTTP로 불러오는 리소스가 없습니다' : `HTTP 리소스 ${mixed.length}건 (브라우저가 차단/경고할 수 있음)`,
      recommend: mixed.length === 0 ? '' : '모든 리소스를 https:// 또는 프로토콜 상대경로(//)로 변경하세요',
    })
  } else {
    items.push({
      id: 'mixed-content', category: '전송 보안', name: '혼합 콘텐츠', level: '권장',
      passed: null, detail: 'HTTP 페이지 (해당 없음)', recommend: '',
    })
  }

  return items
}

app.post('/api/security-scan', async (req, res) => {
  let browser = null
  try {
    const { url } = req.body || {}
    if (!url) return res.status(400).json({ error: 'URL이 필요합니다' })

    let pageUrl = url.trim()
    if (/^[a-zA-Z]:[\\/]/.test(pageUrl)) {
      pageUrl = 'file:///' + pageUrl.replace(/\\/g, '/')
    } else if (!/^https?:\/\//i.test(pageUrl) && !/^file:/i.test(pageUrl)) {
      pageUrl = 'https://' + pageUrl
    }
    const isHttps = /^https:\/\//i.test(pageUrl)

    console.log(`[보안 점검] 검사: ${pageUrl}`)
    browser = await chromium.launch({ headless: true, args: COMPAT_LAUNCH_ARGS })
    const ctxOpts = { viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true }
    if (loginSession) ctxOpts.storageState = loginSession.storageState
    const context = await browser.newContext(ctxOpts)
    const page = await context.newPage()

    const resp = await page.goto(pageUrl, { waitUntil: 'load', timeout: 45000 })
    await page.waitForTimeout(1500)

    const respHeaders = resp ? resp.headers() : {}
    const pageTitle = await page.title().catch(() => pageUrl)
    const htmlSource = await page.content().catch(() => '')
    const cookies = await context.cookies().catch(() => [])

    const items = checkSecurity(respHeaders, cookies, htmlSource, pageUrl, isHttps)

    const passed = items.filter(i => i.passed === true).length
    const failed = items.filter(i => i.passed === false).length
    const na     = items.filter(i => i.passed === null).length
    const total  = items.length - na          // 해당없음 제외한 유효 항목
    const score  = total > 0 ? Math.round((passed / total) * 100) : 0

    const shot = await page.screenshot({ type: 'jpeg', quality: 70 }).catch(() => null)
    await browser.close(); browser = null

    const id = 'sec_' + Date.now() + Math.random().toString(36).slice(2, 6)
    let displayUrl = pageUrl
    try { displayUrl = decodeURIComponent(pageUrl) } catch(_) {}
    const record = {
      id, url: displayUrl, pageTitle,
      scannedAt: new Date().toISOString(),
      httpStatus: resp ? resp.status() : null,
      score, passed, failed, na, total,
      items,
      screenshot: shot ? shot.toString('base64') : null,
    }
    if (securityStore.size >= MAX_SECURITY_STORE) securityStore.delete(securityStore.keys().next().value)
    securityStore.set(id, record)

    console.log(`[보안 점검] 완료: ${score}점 (${passed}/${total})`)
    res.json(record)
  } catch (err) {
    if (browser) await browser.close().catch(() => {})
    console.error('[보안 점검] 오류:', err.message)
    res.status(500).json({ error: '보안 점검 오류: ' + err.message })
  }
})

app.post('/api/security-pptx', async (req, res) => {
  try {
    const fs = require('fs')
    const { ids, meta } = req.body || {}
    const records = (ids || []).map(i => securityStore.get(i)).filter(Boolean)
    if (!records.length) return res.status(400).json({ error: '검사 결과가 없습니다. 먼저 보안 점검을 실행하세요.' })
    if (records.length < (ids || []).length)
      console.warn(`[보안 PPTX] 요청 ${ids.length}건 중 ${records.length}건만 보관 중`)

    const { execFile } = require('child_process')
    const execFileAsync = require('util').promisify(execFile)
    const ts = Date.now()
    const tmpDir   = require('os').tmpdir()
    const dataFile = require('path').join(tmpDir, 'gsec_' + ts + '.json')
    const outFile  = require('path').join(tmpDir, 'gsec_' + ts + '_out.pptx')
    const mediaDir = require('path').join(APP_ROOT, 'pptx_assets', 'media')

    fs.writeFileSync(dataFile, JSON.stringify({ type: 'security', records, meta: meta || {} }, null, 2), 'utf-8')

    const nodeScript = require('path').join(APP_ROOT, 'pptx_node.js')
    const nodeExe    = require('path').join(APP_ROOT, 'runtime', 'node.exe')
    const nodeCmd    = (process.platform === 'win32' && fs.existsSync(nodeExe)) ? nodeExe : process.execPath

    try {
      const { stdout } = await execFileAsync(nodeCmd, [nodeScript, dataFile, outFile, mediaDir],
        { timeout: 600000, maxBuffer: 50 * 1024 * 1024 })
      if (stdout) console.log('[보안 PPTX]', stdout.trim())
    } finally {
      try { fs.unlinkSync(dataFile) } catch(_) {}
    }
    const buf = fs.readFileSync(outFile)
    try { fs.unlinkSync(outFile) } catch(_) {}

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    res.setHeader('Content-Disposition', `attachment; filename="security-report-${Date.now()}.pptx"`)
    res.send(buf)
  } catch (err) {
    console.error('[보안 PPTX] 오류:', err.message)
    res.status(500).json({ error: 'PPTX 생성 오류: ' + err.message })
  }
})


// ── ④ 신뢰도: 엔진 버전·수동확인 항목 (criteria.json 단일 원천)
const AXE_VERSION = (() => { try { return require('axe-core/package.json').version } catch (_) { return 'unknown' } })()
const PW_VERSION  = (() => { try { return require('playwright/package.json').version } catch (_) { return 'unknown' } })()
const CRITERIA = (() => {
  try {
    const fs = require('fs'), path = require('path')
    for (const p of [path.join(APP_ROOT, 'public', 'criteria.json'), path.join(__dirname, 'public', 'criteria.json')])
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch (_) {}
  return { inspections: [] }
})()
const CRITERIA_A11Y = (CRITERIA.inspections || []).find(i => i.id === 'a11y') || { items: [] }
const FIXES = (() => {
  try {
    const fs = require('fs'), path = require('path')
    for (const p of [path.join(APP_ROOT, 'public', 'fixes.json'), path.join(__dirname, 'public', 'fixes.json')])
      if (fs.existsSync(p)) { const j = JSON.parse(fs.readFileSync(p, 'utf8')); delete j._; return j }
  } catch (_) {}
  return {}
})()
const SUGGEST = (() => { try { return require(require('path').join(__dirname, 'suggest.js')).GuardiansSuggest } catch (_) { try { return require(require('path').join(APP_ROOT, 'suggest.js')).GuardiansSuggest } catch (__) { return null } } })()
const OFFLINE = require(require('path').join(__dirname, 'offline.cjs'))
app.get('/api/netstatus', async (req, res) => res.json(await OFFLINE.netStatus(req.query.force === '1')))
try { require(require('path').join(__dirname, 'ai.cjs'))(app, APP_ROOT, OFFLINE) } catch (e) { console.warn('[AI 모듈 로드 실패]', e.message) }
// ── 스크린 리더 시뮬레이션 (v6.19)
const READER = require(require('path').join(__dirname, 'reader.cjs'))
const KRDS_DEEP = require(require('path').join(__dirname, 'krds_deep.cjs'))
const KRDS_TOKENS = require(require('path').join(__dirname, 'krds_tokens.cjs'))
app.post('/api/reader', async (req, res) => {
  try {
    let { url, device } = req.body || {}; if (!url) return res.status(400).json({ error: 'URL이 필요합니다' })
    url = String(url).trim(); if (!/^https?:\/\//i.test(url)) url = 'https://' + url
    res.json(await READER.readerScan(url, device || 'desktop'))
  } catch (e) { res.status(500).json({ error: '스크린 리더 시뮬레이션 실패: ' + e.message }) }
})
app.get('/api/reader/devices', (req, res) => res.json(Object.entries(READER.DEVICES).map(([k, v]) => ({ key: k, name: v.name, viewport: v.viewport }))))
const koFailure = s => String(s || '').replace(/^Fix any of the following:/m, '다음 중 하나를 고치세요:').replace(/^Fix all of the following:/m, '다음을 모두 고치세요:')
const CRITERIA_MANUAL = CRITERIA_A11Y.items.filter(i => i.auto === false).map(i => ({ no: i.no, name: i.name, what: i.what, ref: i.ref }))
const RULE_TO_KWCAG = (() => { const m = {}; for (const it of CRITERIA_A11Y.items) for (const r of (it.rules || [])) m[r] = { no: it.no, name: it.name, ref: it.ref }; return m })()
app.get('/api/criteria', (req, res) => res.json(CRITERIA))

const PORT = process.env.PORT || 3000
// ── ⑤ 예약·자동 검사 모듈
let GUARDIANS_NOTIFY = null
try { GUARDIANS_NOTIFY = require(join(__dirname, 'notify.cjs'))(app, APP_ROOT).notify } catch (e) { console.warn('[알림 모듈 로드 실패]', e.message) }
try { require(join(__dirname, 'krds_standard.cjs'))(app, APP_ROOT, { notify: GUARDIANS_NOTIFY, isAdmin: req => { const t = process.env.GUARDIANS_ADMIN_TOKEN; if (t) return req.headers['x-admin-token'] === t; return /127\.0\.0\.1|::1$/.test(req.socket.remoteAddress || '') } }) } catch (e) { console.error('[KRDS 기준] 로드 실패', e.message) }
try { require(join(__dirname, 'krds_watch.cjs'))(app, APP_ROOT, { notify: GUARDIANS_NOTIFY }) } catch (e) { console.error('[KRDS 추적] 로드 실패', e.message) }
try { require(join(__dirname, 'scheduler.cjs'))(app, APP_ROOT, () => PORT) } catch (e) { console.warn('[예약 모듈 로드 실패]', e.message) }
createServer(app).listen(PORT, '0.0.0.0', () => {
  console.log('')
  console.log('┌─────────────────────────────────────────────────┐')
  console.log('│  🛡️  가디언즈 오브 갤럭시  v2.0                  │')
  console.log('├─────────────────────────────────────────────────┤')
  console.log(`│  ✅ 서버 실행 중                                 │`)
  console.log(`│  🌐 접속 주소: http://localhost:${PORT}            │`)
  console.log(`│  📋 민원 검사: http://localhost:${PORT}/minwon.html│`)
  console.log('├─────────────────────────────────────────────────┤')
  console.log('│  종료하려면 Ctrl+C 를 누르세요                  │')
  console.log('└─────────────────────────────────────────────────┘')
  console.log('')
  // 서버 시작 시 엑셀 미리 로드 (캐시 워밍업 + 경로 검증)
  loadMinwonByStep()
    .then(d => console.log(`📋 민원 목록 로드 완료: 1차=${d['1차'].length}, 2차=${d['2차'].length}, 3차=${d['3차'].length}`))
    .catch(e => console.error(`⚠️ 민원 목록 로드 실패 (API는 동작하나 검사 시작 불가): ${e.message}`))
})


// ═══════════════════════════════════════════════════════════
//  SITESCAN API — 사이트 일괄 검사용 URL 수집
// ═══════════════════════════════════════════════════════════

// ─── 크롤링: 사이트 내 링크 자동 수집 ──────────────────────
app.post('/api/sitescan/crawl', async (req, res) => {
  const { baseUrl, maxPages = 200, pathFilter = [], keywordFilter = [] } = req.body
  if (!baseUrl) return res.status(400).json({ error: 'baseUrl이 필요합니다.' })

  // https:// 없으면 자동 보완
  const normalizedBase = baseUrl.startsWith('http') ? baseUrl : 'https://' + baseUrl

  try {
    const { chromium } = require('playwright')
    const browser = await chromium.launch({ headless: true })
    let page
    if (req.body.useLogin && typeof loginSession !== 'undefined' && loginSession) {
      const _lctx = await browser.newContext({ storageState: loginSession.storageState, ignoreHTTPSErrors: true })
      page = await _lctx.newPage()
      console.log('[크롤] 로그인 세션 사용')
    } else {
      page = await browser.newPage()
    }

    // 첫 페이지 방문 후 리다이렉트된 실제 origin 기준으로 크롤링
    let baseOrigin
    try {
      await page.goto(normalizedBase, { waitUntil: 'networkidle', timeout: 20000 })
      baseOrigin = new URL(page.url()).origin
    } catch(_) {
      baseOrigin = new URL(normalizedBase).origin
    }

    const visited = new Set()
    const queue   = [normalizedBase]
    const found   = []

    while (queue.length > 0 && found.length < maxPages) {
      const url = queue.shift()
      // 방문 키: pathname + search (쿼리스트링 포함)
      let visitKey
      try { visitKey = new URL(url).pathname + new URL(url).search } catch(_) { visitKey = url }
      if (visited.has(visitKey)) continue
      visited.add(visitKey)

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
        // JS 렌더링 완료 대기 (최대 2초)
        await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {})
        found.push(page.url())  // 리다이렉트 후 최종 URL 저장

        // 링크 수집 (쿼리스트링 포함 전체 href)
        let links = []
        try {
          links = await page.evaluate(() =>
            Array.from(document.querySelectorAll('a[href]'))
              .map(el => el.href)
              .filter(h => h.startsWith('http'))
          )
        } catch(_) {}

        for (const link of links) {
          try {
            const u = new URL(link)
            // 같은 도메인만
            if (u.origin !== baseOrigin) continue
            // 방문 키로 중복 체크
            const key = u.pathname + u.search
            if (visited.has(key)) continue
            // 이미 큐에 있으면 스킵
            if (queue.some(q => { try { return new URL(q).pathname + new URL(q).search === key } catch(_){return false} })) continue

            // 경로 필터 적용
            if (pathFilter.length > 0) {
              const matchesFilter = pathFilter.some(p => u.pathname.includes(p))
              // 탐색용 상위 경로 허용 (기준 URL과 같은 경로 depth 이하)
              const basePathDepth = new URL(normalizedBase).pathname.split('/').length
              const linkPathDepth = u.pathname.split('/').length
              const isShallower   = linkPathDepth <= basePathDepth
              if (!matchesFilter && !isShallower) continue
            }

            queue.push(link)
          } catch (_) {}
        }
      } catch (_) { /* 페이지 오류 무시 */ }
    }

    await browser.close()

    // 최종 필터 적용
    const filtered = applyUrlFilters(found, pathFilter, keywordFilter)
    res.json({ urls: filtered, total: filtered.length, crawled: found.length })
  } catch (e) {
    console.error('[sitescan/crawl]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ─── sitemap.xml 파싱 ───────────────────────────────────────
app.post('/api/sitescan/sitemap', async (req, res) => {
  const { sitemapUrl, pathFilter = [], keywordFilter = [] } = req.body
  if (!sitemapUrl) return res.status(400).json({ error: 'sitemapUrl이 필요합니다.' })

  // https:// 없으면 자동 보완
  const normalizedSitemap = sitemapUrl.startsWith('http') ? sitemapUrl : 'https://' + sitemapUrl

  try {
    const https  = require('https')
    const http   = require('http')
    const { parseStringPromise } = require('xml2js')

    // URL fetch 함수
    const fetchText = (url) => new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http
      client.get(url, { headers: { 'User-Agent': 'Guardians-SiteScanner/2.9' } }, res2 => {
        let data = ''
        res2.on('data', c => data += c)
        res2.on('end', () => resolve(data))
      }).on('error', reject)
    })

    const parseUrls = async (url) => {
      const xml  = await fetchText(url)
      let parsed
      try { parsed = await parseStringPromise(xml) } catch (e) { return [] }

      const urls = []
      // sitemapindex (여러 sitemap 포함)
      if (parsed.sitemapindex?.sitemap) {
        for (const sm of parsed.sitemapindex.sitemap) {
          const smUrl = sm.loc?.[0]
          if (smUrl) {
            const sub = await parseUrls(smUrl).catch(() => [])
            urls.push(...sub)
          }
        }
      }
      // urlset
      if (parsed.urlset?.url) {
        for (const u of parsed.urlset.url) {
          const loc = u.loc?.[0]
          if (loc) urls.push(loc.trim())
        }
      }
      return urls
    }

    const allUrls  = await parseUrls(normalizedSitemap)
    const filtered = applyUrlFilters(allUrls, pathFilter, keywordFilter)
    res.json({ urls: filtered, total: filtered.length, parsed: allUrls.length })
  } catch (e) {
    console.error('[sitescan/sitemap]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ─── 파일(Excel/CSV/TXT) URL 파싱 ──────────────────────────
const multerSS = require('multer')({ storage: require('multer').memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

app.post('/api/sitescan/parse-file', multerSS.single('file'), async (req, res) => {
  const { pathFilter = '[]', keywordFilter = '[]' } = req.body
  const pf = JSON.parse(pathFilter), kf = JSON.parse(keywordFilter)

  if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' })

  try {
    const ext  = (fixUploadName(req.file.originalname) || '').split('.').pop().toLowerCase()
    const buf  = req.file.buffer
    let allUrls = []

    if (ext === 'xlsx' || ext === 'xls') {
      const ExcelJS = require('exceljs')
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(buf)
      wb.eachSheet(ws => {
        ws.eachRow(row => {
          row.eachCell(cell => {
            const v = String(cell.value || '').trim()
            if (v.startsWith('http')) allUrls.push(v)
          })
        })
      })
    } else if (ext === 'csv' || ext === 'txt') {
      const lines = buf.toString('utf-8').split(/\r?\n/)
      for (const line of lines) {
        const parts = line.split(/[,\t]/)
        for (const p of parts) {
          const v = p.trim().replace(/^["']|["']$/g, '')
          if (v.startsWith('http')) allUrls.push(v)
        }
      }
    } else {
      return res.status(400).json({ error: '지원 형식: xlsx, csv, txt' })
    }

    // 중복 제거
    allUrls = [...new Set(allUrls)]
    const filtered = applyUrlFilters(allUrls, pf, kf)
    res.json({ urls: filtered, total: filtered.length, parsed: allUrls.length })
  } catch (e) {
    console.error('[sitescan/parse-file]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ─── 공통 필터 함수 ─────────────────────────────────────────
function applyUrlFilters(urls, pathFilter = [], keywordFilter = []) {
  // 둘 다 비어있으면 전체 반환
  if (!pathFilter.length && !keywordFilter.length) return urls

  return urls.filter(url => {
    try {
      const u = new URL(url)
      // 경로 필터 — pathname에 하나라도 포함되면 통과
      if (pathFilter.length > 0) {
        const pf = Array.isArray(pathFilter) ? pathFilter : [pathFilter]
        const passPath = pf.some(p => p && u.pathname.includes(p))
        if (!passPath) return false
      }
      // 키워드 필터 — URL 전체에 하나라도 포함되면 통과
      if (keywordFilter.length > 0) {
        const kf = Array.isArray(keywordFilter) ? keywordFilter : [keywordFilter]
        const passKw = kf.some(k => k && url.includes(k))
        if (!passKw) return false
      }
      return true
    } catch (_) { return false }
  })
}


// ═══════════════════════════════════════════════════════════
//  프로젝트(산출물 묶음) — 여러 검사 결과를 하나로 관리
// ═══════════════════════════════════════════════════════════
const projectStore = new Map()  // projectId → { id, name, meta, sessions[], createdAt }

// ─── 프로젝트 생성 ──────────────────────────────────────────
app.post('/api/project/create', (req, res) => {
  const { name = '새 프로젝트', meta = {} } = req.body
  const id = 'proj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
  const project = { id, name, meta, sessions: [], createdAt: new Date().toISOString() }
  projectStore.set(id, project)
  console.log(`[프로젝트 생성] ${id} — ${name}`)
  res.json(project)
})

// ─── 프로젝트 목록 ──────────────────────────────────────────
app.get('/api/project/list', (req, res) => {
  const list = [...projectStore.values()].map(p => ({
    id: p.id, name: p.name, meta: p.meta,
    sessionCount: p.sessions.length,
    totalPages: p.sessions.reduce((s, sid) => {
      const sess = batchSessions.get(sid)
      return s + (sess ? (sess.results || []).length : 0)
    }, 0),
    createdAt: p.createdAt,
  }))
  res.json(list)
})

// ─── 세션을 프로젝트에 추가 ─────────────────────────────────
app.post('/api/project/:projectId/add-session', (req, res) => {
  const { projectId } = req.params
  const { sessionId } = req.body
  const project = projectStore.get(projectId)
  if (!project) return res.status(404).json({ error: '프로젝트 없음' })
  if (!batchSessions.has(sessionId)) return res.status(404).json({ error: '세션 없음' })
  if (!project.sessions.includes(sessionId)) project.sessions.push(sessionId)
  res.json({ ok: true, sessionCount: project.sessions.length })
})

// ─── 프로젝트 세션 목록 조회 ───────────────────────────────
app.get('/api/project/:projectId/sessions', (req, res) => {
  const project = projectStore.get(req.params.projectId)
  if (!project) return res.status(404).json({ error: '프로젝트 없음' })
  const sessions = project.sessions.map(sid => {
    const s = batchSessions.get(sid)
    if (!s) return { id: sid, status: 'expired' }
    return {
      id: s.id, label: s.label, status: s.status,
      total: s.total, completed: s.completed, failed: s.failed,
      createdAt: s.createdAt,
    }
  })
  res.json({ project: { id: project.id, name: project.name, meta: project.meta }, sessions })
})

// ─── 프로젝트 전체 결과 합치기 → Excel ─────────────────────
app.get('/api/project/:projectId/excel', async (req, res) => {
  const project = projectStore.get(req.params.projectId)
  if (!project) return res.status(404).json({ error: '프로젝트 없음' })
  try {
    const allResults = collectProjectResults(project)
    const meta = { ...project.meta, project: project.name, generatedAt: new Date().toLocaleString('ko-KR') }
    const buf  = await generateExcelReport(allResults, meta)
    const d    = new Date().toISOString().slice(0, 10)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(project.name + '_' + d + '.xlsx')}`)
    res.send(buf)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ─── 프로젝트 전체 결과 합치기 → Word ──────────────────────
app.post('/api/project/:projectId/word', async (req, res) => {
  const project = projectStore.get(req.params.projectId)
  if (!project) return res.status(404).json({ error: '프로젝트 없음' })
  try {
    const allResults = collectProjectResults(project)
    const meta = { ...project.meta, ...( req.body.meta || {}), project: project.name }
    const buf  = await generateWordReport(allResults, meta)
    const d    = new Date().toISOString().slice(0, 10)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(project.name + '_' + d + '.docx')}`)
    res.send(buf)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ─── 선택된 세션만 합치기 → Excel/Word ─────────────────────
app.post('/api/project/merge', async (req, res) => {
  const { sessionIds = [], meta = {}, format = 'excel' } = req.body
  if (!sessionIds.length) return res.status(400).json({ error: '세션 ID가 없습니다.' })
  try {
    const allResults = sessionIds.flatMap(sid => {
      const s = batchSessions.get(sid)
      return s ? (s.results || []).filter(r => r && r.url) : []
    })
    const d = new Date().toISOString().slice(0, 10)
    if (format === 'word') {
      const buf = await generateWordReport(allResults, meta)
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('합산보고서_' + d + '.docx')}`)
      res.send(buf)
    } else {
      const buf = await generateExcelReport(allResults, meta)
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('합산보고서_' + d + '.xlsx')}`)
      res.send(buf)
    }
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ─── 프로젝트 삭제 ─────────────────────────────────────────
app.delete('/api/project/:projectId', (req, res) => {
  projectStore.delete(req.params.projectId)
  res.json({ ok: true })
})

// ─── 프로젝트 결과 수집 헬퍼 ───────────────────────────────
function collectProjectResults(project) {
  return project.sessions.flatMap(sid => {
    const s = batchSessions.get(sid)
    return s ? (s.results || []).filter(r => r && r.url) : []
  })
}

// ═══════════════════════════════════════════════════════════
//  generateExcelReport — 시트 분리 + 색상 + 조항번호
// ═══════════════════════════════════════════════════════════
async function generateExcelReport(results, meta = {}) {
  const wb  = new ExcelJS.Workbook()
  wb.creator  = meta.inspector || '가디언즈 오브 갤럭시 v2.8'
  wb.created  = new Date()
  wb.modified = new Date()

  const HDR_FILL   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C3674' } }
  const HDR_FONT   = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
  const SUBHDR_FILL= { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EBF5' } }
  const SUBHDR_FONT= { bold: true, size: 10 }
  const BORDER_THIN= { top:{style:'thin',color:{argb:'FFD0D7E3'}}, bottom:{style:'thin',color:{argb:'FFD0D7E3'}}, left:{style:'thin',color:{argb:'FFD0D7E3'}}, right:{style:'thin',color:{argb:'FFD0D7E3'}} }
  const IMPACT_FILL = { critical:'FFDC2626', serious:'FFEA580C', moderate:'FFD97706', minor:'FF65A30D' }
  const IMPACT_KO   = { critical:'치명적', serious:'심각', moderate:'보통', minor:'경미' }

  function applyHdr(ws, cols) {
    const row = ws.getRow(1)
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      cell.value = c.header
      cell.fill  = HDR_FILL
      cell.font  = HDR_FONT
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      cell.border = BORDER_THIN
      ws.getColumn(i + 1).width = c.width || 16
    })
    row.height = 22
  }

  function styleRow(ws, rowIdx, fillArgb) {
    const row = ws.getRow(rowIdx)
    row.eachCell(cell => {
      if (fillArgb) cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb: fillArgb } }
      cell.border = BORDER_THIN
      cell.alignment = { vertical: 'middle', wrapText: true }
    })
    row.height = 18
  }

  const now    = new Date().toLocaleString('ko-KR')
  const orgStr = [meta.org, meta.dept].filter(Boolean).join(' ')
  const projStr= meta.project || ''

  // ── 시트 1: 요약 ────────────────────────────────────────
  const wsSummary = wb.addWorksheet('요약', { properties:{ tabColor:{ argb:'FF2C3674' } } })
  wsSummary.mergeCells('A1:F1')
  const titleCell = wsSummary.getCell('A1')
  titleCell.value = '가디언즈 오브 갤럭시 — 웹 품질 종합 검사 보고서'
  titleCell.font  = { bold:true, size:15, color:{argb:'FF2C3674'} }
  titleCell.alignment = { horizontal:'center', vertical:'middle' }
  wsSummary.getRow(1).height = 36

  const metaRows = [
    ['기관명', orgStr || '미입력'], ['프로젝트', projStr || '미입력'],
    ['담당자', meta.inspector || '미입력'], ['검사 일시', now],
    ['검사 기준', 'WCAG 2.1 (axe-core) / KRDS / W3C Markup'],
  ]
  metaRows.forEach(([k, v], i) => {
    const r = wsSummary.getRow(i + 2)
    r.getCell(1).value = k; r.getCell(2).value = v
    r.getCell(1).fill  = SUBHDR_FILL; r.getCell(1).font = SUBHDR_FONT
    r.getCell(1).border = BORDER_THIN; r.getCell(2).border = BORDER_THIN
    r.height = 18
  })
  wsSummary.getColumn(1).width = 16; wsSummary.getColumn(2).width = 40

  wsSummary.getRow(9).getCell(1).value = ''
  applyHdr(wsSummary, [
    { header:'검사 URL', width:40 }, { header:'페이지 제목', width:28 },
    { header:'점수', width:8 }, { header:'등급', width:8 },
    { header:'접근성 위반', width:12 }, { header:'오탈자', width:10 },
    { header:'데드링크', width:10 }, { header:'W3C 오류', width:10 }, { header:'KRDS', width:10 },
  ].map((c,i) => ({...c})))

  // 요약 시트는 행 9부터 데이터 시작
  const summaryRow9 = wsSummary.getRow(9)
  ;['검사 URL','페이지 제목','점수','등급','접근성 위반','오탈자','데드링크','W3C 오류','KRDS 미준수'].forEach((h,i) => {
    summaryRow9.getCell(i+1).value = h
    summaryRow9.getCell(i+1).fill  = HDR_FILL
    summaryRow9.getCell(i+1).font  = HDR_FONT
    summaryRow9.getCell(i+1).border = BORDER_THIN
    summaryRow9.getCell(i+1).alignment = { horizontal:'center', vertical:'middle' }
  })
  summaryRow9.height = 22

  results.forEach((r, ri) => {
    const viol  = r.summary?.violations  || 0
    const spell = r.spelling?.totalIssues || 0
    const dead  = Array.isArray(r.links?.dead) ? r.links.dead.length : (r.links?.dead || 0)
    const w3cE  = r.w3c?.errorCount || 0
    const krds  = (r.krds?.items || []).filter(i => !i.passed).length
    const score = r.score || 0
    const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D'
    const gradeColor = { A:'FF16A34A', B:'FF2563EB', C:'FFD97706', D:'FFDC2626' }
    const row = wsSummary.getRow(9 + ri + 1)
    row.getCell(1).value = r.url || r.fileName || ''
    row.getCell(2).value = r.pageTitle || '-'
    row.getCell(3).value = score
    row.getCell(4).value = grade
    row.getCell(5).value = viol
    row.getCell(6).value = spell
    row.getCell(7).value = dead
    row.getCell(8).value = w3cE
    row.getCell(9).value = krds
    row.getCell(3).numFmt = '0"점"'
    row.getCell(4).font = { bold:true, color:{ argb: gradeColor[grade] } }
    if (viol > 0) row.getCell(5).font = { color:{ argb:'FFDC2626' } }
    styleRow(wsSummary, 9 + ri + 1, ri % 2 === 0 ? 'FFFAFBFF' : 'FFFFFFFF')
  })

  // ── 시트 2: 접근성 위반 (데이터 있을 때만 생성) ──────────
  const totalViolations = results.reduce((s,r) => s + (r.violations||[]).length, 0)
  if (totalViolations > 0) {
  const wsA11y = wb.addWorksheet('접근성 위반', { properties:{ tabColor:{ argb:'FFDC2626' } } })
  applyHdr(wsA11y, [
    { header:'#', width:5 }, { header:'검사 URL', width:36 }, { header:'규칙 ID', width:18 },
    { header:'위반 내용', width:36 }, { header:'심각도', width:10 }, { header:'WCAG 조항', width:14 },
    { header:'영향 요소 수', width:12 }, { header:'HTML 예시', width:40 }, { header:'수정 방법', width:36 },
  ])
  let a11yRowIdx = 2
  results.forEach(r => {
    (r.violations || []).forEach((v, vi) => {
      const wcagTags = (v.tags || []).filter(t => t.startsWith('wcag')).join(', ')
      const row = wsA11y.getRow(a11yRowIdx++)
      row.getCell(1).value  = vi + 1
      row.getCell(2).value  = r.url || r.fileName || ''
      row.getCell(3).value  = v.id
      row.getCell(4).value  = v.help
      row.getCell(5).value  = IMPACT_KO[v.impact] || v.impact
      row.getCell(6).value  = wcagTags
      row.getCell(7).value  = v.nodes?.length || 0
      row.getCell(8).value  = v.nodes?.[0]?.html?.substring(0, 200) || ''
      row.getCell(9).value  = v.nodes?.[0]?.failureSummary?.substring(0, 200) || ''
      if (IMPACT_FILL[v.impact]) {
        row.getCell(5).fill  = { type:'pattern', pattern:'solid', fgColor:{ argb: IMPACT_FILL[v.impact] } }
        row.getCell(5).font  = { color:{ argb:'FFFFFFFF' }, bold:true }
      }
      styleRow(wsA11y, a11yRowIdx - 1, null)
    })
  })
  } // end if totalViolations

  // ── 시트 3: 오탈자 (데이터 있을 때만) ───────────────────
  const totalSpelling = results.reduce((s,r) => s + (r.spelling?.issues||[]).length, 0)
  if (totalSpelling > 0) {
  const wsSpell = wb.addWorksheet('오탈자', { properties:{ tabColor:{ argb:'FF8B5CF6' } } })
  applyHdr(wsSpell, [
    { header:'#', width:5 }, { header:'검사 URL', width:36 }, { header:'오탈자', width:16 },
    { header:'수정 제안', width:16 }, { header:'유형', width:12 }, { header:'문맥', width:50 },
    { header:'검사 엔진', width:14 },
  ])
  let spellRowIdx = 2
  results.forEach(r => {
    (r.spelling?.issues || []).forEach((s, si) => {
      const row = wsSpell.getRow(spellRowIdx++)
      row.getCell(1).value = si + 1
      row.getCell(2).value = r.url || r.fileName || ''
      row.getCell(3).value = s.token || s.original || s.word || ''
      row.getCell(4).value = (s.suggestions || [])[0] || s.suggestion || ''
      row.getCell(5).value = s.type || ''
      row.getCell(6).value = s.context || s.desc || ''
      row.getCell(7).value = s.source === 'local' ? '로컬(오프라인)' : 'Daum'
      row.getCell(3).font = { color:{ argb:'FFDC2626' }, bold:true }
      row.getCell(4).font = { color:{ argb:'FF059669' }, bold:true }
      styleRow(wsSpell, spellRowIdx - 1, si % 2 === 0 ? 'FFFDF5FF' : 'FFFFFFFF')
    })
  })
  } // end if totalSpelling

  // ── 시트 4: 링크 검사 (데이터 있을 때만) ────────────────
  const totalDeadLinks = results.reduce((s,r) => s + (Array.isArray(r.links?.dead) ? r.links.dead.length : 0), 0)
  if (totalDeadLinks > 0) {
  const wsLinks = wb.addWorksheet('링크 검사', { properties:{ tabColor:{ argb:'FFF59E0B' } } })
  applyHdr(wsLinks, [
    { header:'#', width:5 }, { header:'검사 URL', width:36 }, { header:'링크 URL', width:50 },
    { header:'HTTP 상태', width:12 }, { header:'유형', width:12 }, { header:'링크 텍스트', width:24 },
    { header:'오류 내용', width:36 },
  ])
  let linkRowIdx = 2
  results.forEach(r => {
    const dead = Array.isArray(r.links?.dead) ? r.links.dead : []
    dead.forEach((l, li) => {
      const row = wsLinks.getRow(linkRowIdx++)
      row.getCell(1).value = li + 1
      row.getCell(2).value = r.url || r.fileName || ''
      row.getCell(3).value = l.url || ''
      row.getCell(4).value = l.status || '오류'
      row.getCell(5).value = '데드링크'
      row.getCell(6).value = l.text || ''
      row.getCell(7).value = l.error || ''
      row.getCell(4).font = { color:{ argb:'FFDC2626' }, bold:true }
      styleRow(wsLinks, linkRowIdx - 1, 'FFFFF1F1')
    })
  })
  } // end if totalDeadLinks

  // ── 시트 5: KRDS (데이터 있을 때만) ─────────────────────
  const totalKRDS = results.reduce((s,r) => s + (r.krds?.items||[]).filter(i=>!i.passed).length, 0)
  if (totalKRDS > 0) {
  const wsKRDS = wb.addWorksheet('KRDS', { properties:{ tabColor:{ argb:'FFF43F5E' } } })
  applyHdr(wsKRDS, [
    { header:'#', width:5 }, { header:'검사 URL', width:36 }, { header:'카테고리', width:16 },
    { header:'검사 항목', width:28 }, { header:'수준', width:8 }, { header:'결과', width:8 },
    { header:'세부 내용', width:36 }, { header:'개선 권고사항', width:40 },
  ])
  let krdsRowIdx = 2
  results.forEach(r => {
    (r.krds?.items || []).filter(i => !i.passed).forEach((item, ki) => {
      const row = wsKRDS.getRow(krdsRowIdx++)
      row.getCell(1).value = ki + 1
      row.getCell(2).value = r.url || r.fileName || ''
      row.getCell(3).value = item.category || ''
      row.getCell(4).value = item.name || ''
      row.getCell(5).value = item.level || ''
      row.getCell(6).value = '미준수'
      row.getCell(7).value = item.detail || ''
      row.getCell(8).value = item.recommend || ''
      row.getCell(5).font = { color: item.level === '필수' ? { argb:'FFDC2626' } : { argb:'FFD97706' }, bold:true }
      row.getCell(6).font = { color:{ argb:'FFDC2626' }, bold:true }
      styleRow(wsKRDS, krdsRowIdx - 1, ki % 2 === 0 ? 'FFFFF5F5' : 'FFFFFFFF')
    })
  })
  } // end if totalKRDS

  // ── 시트 6: W3C 마크업 (데이터 있을 때만) ──────────────
  const totalW3C = results.reduce((s,r) => s + (r.w3c?.errors||[]).length + (r.w3c?.warnings||[]).length, 0)
  if (totalW3C > 0) {
  const wsW3C = wb.addWorksheet('W3C 마크업', { properties:{ tabColor:{ argb:'FF3B82F6' } } })
  applyHdr(wsW3C, [
    { header:'#', width:5 }, { header:'검사 URL', width:36 }, { header:'유형', width:8 },
    { header:'내용', width:50 }, { header:'줄 번호', width:10 }, { header:'칸 번호', width:10 },
  ])
  let w3cRowIdx = 2
  results.forEach(r => {
    const msgs = [...(r.w3c?.errors || []).map(e=>({...e,type:'오류'})), ...(r.w3c?.warnings || []).map(w=>({...w,type:'경고'}))]
    msgs.forEach((m, mi) => {
      const row = wsW3C.getRow(w3cRowIdx++)
      row.getCell(1).value = mi + 1
      row.getCell(2).value = r.url || r.fileName || ''
      row.getCell(3).value = m.type
      row.getCell(4).value = m.message || ''
      row.getCell(5).value = m.line || ''
      row.getCell(6).value = m.col  || ''
      if (m.type === '오류') row.getCell(3).font = { color:{ argb:'FFDC2626' }, bold:true }
      else row.getCell(3).font = { color:{ argb:'FFD97706' }, bold:true }
      styleRow(wsW3C, w3cRowIdx - 1, null)
    })
  })
  } // end if totalW3C

  return wb.xlsx.writeBuffer()
}

// ═══════════════════════════════════════════════════════════
//  generateWordReport — 공식 문서 형식 .docx
// ═══════════════════════════════════════════════════════════
async function generateWordReport(results, meta = {}) {
  // docx — 여러 경로 후보로 로드 시도 (Windows/Mac/Linux 공통)
  let docx
  const _path = require('path')
  // server.cjs 실행 위치 기반으로 탐색 (Windows 배포환경 최우선)
  // APP_ROOT 기준 직접 경로를 최우선으로
  const docxPaths = [
    _path.join(APP_ROOT, 'node_modules', 'docx', 'dist', 'index.cjs'),
    _path.join(APP_ROOT, 'node_modules', 'docx', 'dist', 'index.umd.cjs'),
    _path.join(APP_ROOT, 'node_modules', 'docx'),
    _path.join(__dirname, 'node_modules', 'docx', 'dist', 'index.cjs'),
    _path.join(__dirname, 'node_modules', 'docx', 'dist', 'index.umd.cjs'),
    _path.join(__dirname, 'node_modules', 'docx'),
    _path.join(process.cwd(), 'node_modules', 'docx', 'dist', 'index.cjs'),
    _path.join(process.cwd(), 'node_modules', 'docx'),
    'docx',
  ]

  const _docxErrors = []
  for (const p of docxPaths) {
    try {
      const m = require(p)
      if (m && m.Document) { docx = m; console.log('[Word] docx 로드 성공:', p); break }
    } catch(e) { _docxErrors.push(p + ': ' + e.message) }
  }
  if (!docx || !docx.Document) {
    const errDetail = _docxErrors.slice(0,4).join('\n  ')
    console.error('[Word] docx 로드 실패:\n  ' + errDetail)
    throw new Error('Word 보고서 생성 실패: docx 패키지를 찾을 수 없습니다.\n\n시도한 경로 (처음 4개):\n  ' + errDetail)
  }

  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
    PageBreak, Header, Footer, PageNumber, NumberFormat,
  } = docx

  const now    = new Date().toLocaleString('ko-KR')
  const orgStr = [meta.org, meta.dept].filter(Boolean).join(' ')

  const NAVY  = '2C3674'
  const RED   = 'DC2626'
  const AMBER = 'D97706'
  const GREEN = '16A34A'
  const GRAY  = 'F3F4F6'

  function hCell(text, bgColor = NAVY, w = 1500) {
    return new TableCell({
      width: { size: w, type: WidthType.DXA },
      shading: { fill: bgColor, type: ShadingType.SOLID },
      children: [new Paragraph({
        children: [new TextRun({ text: String(text), bold: true, color: bgColor === NAVY ? 'FFFFFF' : '1E293B', size: 18 })],
        alignment: AlignmentType.CENTER,
      })],
    })
  }

  function dCell(text, w = 1500, bold = false, color = '1E293B') {
    return new TableCell({
      width: { size: w, type: WidthType.DXA },
      children: [new Paragraph({
        children: [new TextRun({ text: String(text ?? ''), bold, color, size: 18 })],
      })],
    })
  }

  const sections = []

  // ── 표지 ─────────────────────────────────────────────────
  sections.push(new Paragraph({ text: '', spacing: { before: 2000 } }))
  sections.push(new Paragraph({
    children: [new TextRun({ text: '웹 품질 종합 검사 보고서', bold: true, size: 56, color: NAVY })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
  }))
  sections.push(new Paragraph({
    children: [new TextRun({ text: 'Guardians of Galaxy v2.8', size: 24, color: '6B7280' })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 800 },
  }))

  if (orgStr || meta.project) {
    sections.push(new Paragraph({
      children: [new TextRun({ text: orgStr || '', bold: true, size: 32, color: NAVY })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }))
    if (meta.project) sections.push(new Paragraph({
      children: [new TextRun({ text: meta.project, size: 26, color: '374151' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }))
  }
  sections.push(new Paragraph({ text: '', spacing: { before: 1600 } }))
  sections.push(new Paragraph({
    children: [new TextRun({ text: `검사 일시: ${now}`, size: 22, color: '6B7280' })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 160 },
  }))
  if (meta.inspector) sections.push(new Paragraph({
    children: [new TextRun({ text: `담당자: ${meta.inspector}`, size: 22, color: '6B7280' })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 160 },
  }))
  sections.push(new Paragraph({ children: [new PageBreak()] }))

  // ── 1. 개요 ───────────────────────────────────────────────
  sections.push(new Paragraph({ text: '1. 검사 개요', heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }))
  const overviewTable = new Table({
    width: { size: 9000, type: WidthType.DXA },
    rows: [
      new TableRow({ children: [hCell('항목', NAVY, 2000), hCell('내용', NAVY, 7000)] }),
      new TableRow({ children: [dCell('기관명', 2000, true), dCell(orgStr || '-', 7000)] }),
      new TableRow({ children: [dCell('프로젝트', 2000, true), dCell(meta.project || '-', 7000)] }),
      new TableRow({ children: [dCell('담당자', 2000, true), dCell(meta.inspector || '-', 7000)] }),
      new TableRow({ children: [dCell('검사 일시', 2000, true), dCell(now, 7000)] }),
      new TableRow({ children: [dCell('도구', 2000, true), dCell('Guardians of Galaxy v2.8 (axe-core + Playwright)', 7000)] }),
      new TableRow({ children: [dCell('검사 기준', 2000, true), dCell('WCAG 2.1 A/AA/AAA · KRDS (행안부) · W3C HTML5 · 링크검사 · 오탈자', 7000)] }),
      new TableRow({ children: [dCell('검사 페이지 수', 2000, true), dCell(`${results.length}개`, 7000)] }),
    ],
  })
  sections.push(overviewTable)
  sections.push(new Paragraph({ text: '', spacing: { after: 400 } }))

  // ── 2. 종합 결과 ──────────────────────────────────────────
  sections.push(new Paragraph({ text: '2. 종합 검사 결과', heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }))
  const summaryRows = [
    new TableRow({ children: [
      hCell('URL', NAVY, 3600), hCell('점수', NAVY, 800), hCell('등급', NAVY, 800),
      hCell('접근성위반', NAVY, 1200), hCell('오탈자', NAVY, 900), hCell('데드링크', NAVY, 900), hCell('KRDS미준수', NAVY, 800),
    ]}),
    ...results.map(r => {
      const viol  = r.summary?.violations  || 0
      const spell = r.spelling?.totalIssues || 0
      const dead  = Array.isArray(r.links?.dead) ? r.links.dead.length : (r.links?.dead || 0)
      const krds  = (r.krds?.items || []).filter(i => !i.passed).length
      const score = r.score || 0
      const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D'
      const gradeColor = { A: GREEN, B: '2563EB', C: AMBER, D: RED }
      return new TableRow({ children: [
        dCell((r.url || r.fileName || '').substring(0, 60), 3600),
        dCell(`${score}점`, 800, true),
        dCell(grade, 800, true, gradeColor[grade]),
        dCell(viol,  1200, viol > 0, viol > 0 ? RED : GREEN),
        dCell(spell, 900,  spell > 0, spell > 0 ? RED : GREEN),
        dCell(dead,  900,  dead > 0, dead > 0 ? RED : GREEN),
        dCell(krds,  800,  krds > 0, krds > 0 ? RED : GREEN),
      ]})
    }),
  ]
  sections.push(new Table({ width: { size: 9000, type: WidthType.DXA }, rows: summaryRows }))
  sections.push(new Paragraph({ text: '', spacing: { after: 400 } }))

  // ── 3. 페이지별 상세 결과 ────────────────────────────────
  sections.push(new Paragraph({ text: '3. 페이지별 상세 결과', heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }))

  results.forEach((r, ri) => {
    sections.push(new Paragraph({
      children: [new TextRun({ text: `${ri + 1}. ${r.pageTitle || r.url || r.fileName || ''}`, bold: true, size: 22, color: NAVY })],
      spacing: { before: 300, after: 160 },
    }))
    sections.push(new Paragraph({
      children: [new TextRun({ text: `URL: ${r.url || r.fileName || ''}`, size: 18, color: '6B7280' })],
      spacing: { after: 200 },
    }))

    // 접근성 위반 상위 10개
    const viols = (r.violations || []).slice(0, 10)
    if (viols.length > 0) {
      sections.push(new Paragraph({ text: '■ 접근성 위반 항목', heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 120 } }))
      const violRows = [
        new TableRow({ children: [hCell('#', NAVY, 400), hCell('위반 내용', NAVY, 2800), hCell('심각도', NAVY, 800), hCell('WCAG 조항', NAVY, 1200), hCell('영향 요소 수', NAVY, 900), hCell('수정 방법', NAVY, 2900)] }),
        ...viols.map((v, vi) => {
          const wcag = (v.tags || []).filter(t => t.startsWith('wcag')).join(', ')
          const impColor = { critical: RED, serious: 'EA580C', moderate: AMBER, minor: '65A30D' }
          return new TableRow({ children: [
            dCell(vi + 1, 400),
            dCell(v.help || '', 2800),
            dCell(IMPACT_KO[v.impact] || v.impact, 800, true, impColor[v.impact] || '1E293B'),
            dCell(wcag, 1200, false, '2563EB'),
            dCell(v.nodes?.length || 0, 900),
            dCell((v.nodes?.[0]?.failureSummary || '').substring(0, 120), 2900),
          ]})
        }),
      ]
      sections.push(new Table({ width: { size: 9000, type: WidthType.DXA }, rows: violRows }))
      if (r.violations.length > 10) sections.push(new Paragraph({
        children: [new TextRun({ text: `  ※ 전체 ${r.violations.length}건 중 상위 10건만 표시. 전체 목록은 HTML/Excel 보고서를 참조하세요.`, size: 16, color: '9CA3AF', italics: true })],
        spacing: { before: 100 },
      }))
    }

    // KRDS 미준수
    const krdsItems = (r.krds?.items || []).filter(i => !i.passed)
    if (krdsItems.length > 0) {
      sections.push(new Paragraph({ text: '■ KRDS 미준수 항목', heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 120 } }))
      const krdsRows = [
        new TableRow({ children: [hCell('카테고리', NAVY, 1400), hCell('항목명', NAVY, 2200), hCell('수준', NAVY, 700), hCell('세부 내용', NAVY, 2200), hCell('개선 권고사항', NAVY, 2500)] }),
        ...krdsItems.map(item => new TableRow({ children: [
          dCell(item.category || '', 1400),
          dCell(item.name     || '', 2200),
          dCell(item.level    || '', 700, true, item.level === '필수' ? RED : AMBER),
          dCell(item.detail   || '', 2200),
          dCell(item.recommend|| '', 2500, false, '2563EB'),
        ]})),
      ]
      sections.push(new Table({ width: { size: 9000, type: WidthType.DXA }, rows: krdsRows }))
    }

    sections.push(new Paragraph({ text: '', spacing: { after: 400 } }))
    if (ri < results.length - 1) sections.push(new Paragraph({ children: [new PageBreak()] }))
  })

  // ── 4. 종합 의견 및 조치 권고 ────────────────────────────
  sections.push(new Paragraph({ children: [new PageBreak()] }))
  sections.push(new Paragraph({ text: '4. 종합 의견 및 조치 권고', heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 300 } }))
  const totalViol  = results.reduce((s, r) => s + (r.summary?.violations || 0), 0)
  const totalSpell = results.reduce((s, r) => s + (r.spelling?.totalIssues || 0), 0)
  const totalDead  = results.reduce((s, r) => s + (Array.isArray(r.links?.dead) ? r.links.dead.length : (r.links?.dead || 0)), 0)
  const totalKRDS  = results.reduce((s, r) => s + (r.krds?.items || []).filter(i => !i.passed).length, 0)
  const avgScore   = results.length ? Math.round(results.reduce((s, r) => s + (r.score || 0), 0) / results.length) : 0

  sections.push(new Paragraph({
    children: [new TextRun({ text: `총 ${results.length}개 페이지를 검사한 결과 평균 접근성 점수는 ${avgScore}점으로 확인되었습니다.`, size: 20 })],
    spacing: { after: 200 },
  }))
  const recTable = new Table({
    width: { size: 9000, type: WidthType.DXA },
    rows: [
      new TableRow({ children: [hCell('구분', NAVY, 2000), hCell('발견 건수', NAVY, 1500), hCell('우선순위', NAVY, 1500), hCell('권고 사항', NAVY, 4000)] }),
      new TableRow({ children: [dCell('접근성 위반', 2000, true), dCell(`${totalViol}건`, 1500, true, totalViol > 0 ? RED : GREEN), dCell(totalViol > 10 ? '즉시조치' : totalViol > 0 ? '단기개선' : '양호', 1500, true, totalViol > 10 ? RED : totalViol > 0 ? AMBER : GREEN), dCell('axe-core 검출 항목 우선 순위에 따라 치명적·심각 항목부터 조치 권고', 4000)] }),
      new TableRow({ children: [dCell('오탈자', 2000, true), dCell(`${totalSpell}건`, 1500, true, totalSpell > 0 ? AMBER : GREEN), dCell(totalSpell > 0 ? '단기개선' : '양호', 1500, true, totalSpell > 0 ? AMBER : GREEN), dCell('전문 용어·고유명사 오탐 제외 후 실제 오탈자 수정 권고', 4000)] }),
      new TableRow({ children: [dCell('데드링크', 2000, true), dCell(`${totalDead}건`, 1500, true, totalDead > 0 ? RED : GREEN), dCell(totalDead > 0 ? '즉시조치' : '양호', 1500, true, totalDead > 0 ? RED : GREEN), dCell('404 등 오류 링크 즉시 수정 또는 제거 권고', 4000)] }),
      new TableRow({ children: [dCell('KRDS 미준수', 2000, true), dCell(`${totalKRDS}건`, 1500, true, totalKRDS > 0 ? AMBER : GREEN), dCell(totalKRDS > 0 ? '중기개선' : '양호', 1500, true, totalKRDS > 0 ? AMBER : GREEN), dCell('행안부 KRDS 가이드라인 참조하여 단계적 개선 권고', 4000)] }),
    ],
  })
  sections.push(recTable)

  // 문서 생성
  const doc = new Document({
    creator: meta.inspector || '가디언즈 오브 갤럭시 v2.8',
    title:   '웹 품질 종합 검사 보고서',
    description: `${orgStr} ${meta.project || ''}`,
    styles: {
      default: {
        heading1: { run: { bold: true, size: 28, color: NAVY }, paragraph: { spacing: { before: 400, after: 200 } } },
        heading2: { run: { bold: true, size: 22, color: '374151' }, paragraph: { spacing: { before: 200, after: 120 } } },
      },
    },
    sections: [{
      properties: {
        page: { margin: { top: 1440, right: 1080, bottom: 1440, left: 1080 } },
      },
      headers: {
        default: new Header({ children: [new Paragraph({
          children: [new TextRun({ text: `가디언즈 오브 갤럭시 v2.8  |  ${orgStr || '웹 품질 검사 보고서'}`, size: 16, color: '9CA3AF' })],
          alignment: AlignmentType.RIGHT,
        })] }),
      },
      footers: {
        default: new Footer({ children: [new Paragraph({
          children: [
            new TextRun({ text: `생성 일시: ${now}   `, size: 16, color: '9CA3AF' }),
            new TextRun({ children: [new PageNumber()], size: 16, color: '6B7280' }),
          ],
          alignment: AlignmentType.CENTER,
        })] }),
      },
      children: sections,
    }],
  })

  return Packer.toBuffer(doc)
}

// ═══════════════════════════════════════════════════════════
//  generatePptxReport — 웹(앱) 접근성점검결과서 PPTX 생성
//  원본 템플릿 스타일 재현: 행안부+NIA 로고, 검사항목표, 스크린샷
// ═══════════════════════════════════════════════════════════

// ─── PPTX 단일 보고서 API ──────────────────────────────────
app.post('/api/report/pptx', async (req, res) => {
  const result = req.body
  if (!result || !result.url) return res.status(400).json({ error: '검사 결과가 필요합니다.' })
  try {
    const meta = result.reportMeta || {}
    const buf  = await generatePptxReport([result], meta)
    const d    = new Date().toISOString().slice(0, 10)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('접근성점검결과서_' + d + '.pptx')}`)
    res.send(buf)
  } catch (e) {
    console.error('PPTX 단일 오류:', e)
    res.status(500).json({ error: e.message })
  }
})

// ─── PPTX 배치 보고서 API ─────────────────────────────────
app.post('/api/batch/:sessionId/pptx', async (req, res) => {
  const session = batchSessions.get(req.params.sessionId)
  if (!session) return res.status(404).json({ error: '세션 없음' })
  try {
    // session.screenshots + evidenceStore 에서 스크린샷 병합
    const ssMap = session.screenshots || {}
    const results = (session.results || []).filter(r => r && r.url).map(r => {
      // 1순위: session.screenshots (가장 확실)
      const ss = ssMap[r.id]
      if (ss) return { ...r, screenshot: ss }
      // 2순위: evidenceStore
      const ev = evidenceStore.get(r.id)
      if (ev && ev.screenshot) {
        return { ...r, screenshot: ev.screenshot,
                 violations: ev.violations || r.violations || [],
                 passes: ev.passes || r.passes || [] }
      }
      return r
    })
    const ssCount = results.filter(r => r.screenshot).length
    console.log(`[배치 PPTX] ${results.length}건, 스크린샷: ${ssCount}건, ssMap: ${Object.keys(ssMap).length}건`)
    const meta    = req.body?.meta || {}
    const buf     = await generatePptxReport(results, meta)
    const d       = new Date().toISOString().slice(0, 10)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('접근성점검결과서_' + d + '.pptx')}`)
    res.send(buf)
  } catch (e) {
    console.error('PPTX 배치 오류:', e)
    res.status(500).json({ error: e.message })
  }
})

// ─── PPTX 생성 함수 ───────────────────────────────────────

// ═══════════════════════════════════════════════
//  PPTX 설정 API — 로고/기관 정보 저장·조회
// ═══════════════════════════════════════════════

// ═══════════════════════════════════════════════
//  표지 편집기 레이아웃 API — v5.0
//  캔버스 960x540px = PPTX 13.333x7.5in @72dpi (1px=1/72in, 1pt=1px)
// ═══════════════════════════════════════════════
const _coverPath = require('path').join(APP_ROOT, 'pptx_assets', 'cover_layout.json')

app.get('/api/cover-layout', (req, res) => {
  try {
    if (require('fs').existsSync(_coverPath))
      return res.json(JSON.parse(require('fs').readFileSync(_coverPath, 'utf-8')))
  } catch(_) {}
  res.json({ enabled: false, items: [] })
})

app.post('/api/cover-layout', express.json({ limit: '25mb' }), (req, res) => {
  try {
    const { enabled = false, items = [] } = req.body || {}
    // 검증: 요소 형식/개수 제한
    if (!Array.isArray(items) || items.length > 30)
      return res.status(400).json({ error: '요소는 최대 30개까지 가능합니다' })
    const clean = items.filter(it => it && (it.type === 'text' || it.type === 'image'))
      .map(it => ({
        type: it.type,
        x: Math.round(+it.x || 0), y: Math.round(+it.y || 0),
        w: Math.round(+it.w || 50), h: Math.round(+it.h || 20),
        ...(it.type === 'text' ? {
          text: String(it.text || '').slice(0, 300),
          fontSize: Math.min(Math.max(+it.fontSize || 14, 6), 80),
          bold: !!it.bold,
          color: /^#[0-9a-fA-F]{6}$/.test(it.color) ? it.color : '#1e2a3a',
          align: ['left','center','right'].includes(it.align) ? it.align : 'left',
        } : {
          data: String(it.data || '').startsWith('data:image/') ? it.data : ''
        })
      }))
    require('fs').mkdirSync(require('path').dirname(_coverPath), { recursive: true })
    require('fs').writeFileSync(_coverPath, JSON.stringify({ enabled, items: clean }, null, 2), 'utf-8')
    console.log(`[표지 편집] 저장: ${clean.length}개 요소, 사용=${enabled}`)
    res.json({ ok: true, count: clean.length })
  } catch (e) {
    res.status(500).json({ error: '표지 레이아웃 저장 실패: ' + e.message })
  }
})

const _cfgPath = require('path').join(APP_ROOT, 'pptx_assets', 'config.json')
const _multerLogo = require('multer')({
  storage: require('multer').memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
})

function loadPptxConfig() {
  try {
    if (require('fs').existsSync(_cfgPath))
      return JSON.parse(require('fs').readFileSync(_cfgPath, 'utf-8'))
  } catch(_) {}
  return { org: '', dept: '', inspector: '', project: '' }
}
function savePptxConfig(cfg) {
  require('fs').mkdirSync(require('path').dirname(_cfgPath), { recursive: true })
  require('fs').writeFileSync(_cfgPath, JSON.stringify(cfg, null, 2), 'utf-8')
}

app.get('/api/pptx-config', (req, res) => {
  res.json(loadPptxConfig())
})

app.post('/api/pptx-config', express.json(), (req, res) => {
  const cfg = { ...loadPptxConfig(), ...req.body }
  savePptxConfig(cfg)
  res.json({ ok: true })
})

app.post('/api/pptx-config/logo/:type', _multerLogo.single('logo'), (req, res) => {
  const type = req.params.type
  if (!req.file) return res.status(400).json({ error: '파일 없음' })
  const ext  = req.file.mimetype === 'image/png' ? 'png' : 'jpg'
  const mediaDir = require('path').join(APP_ROOT, 'pptx_assets', 'media')
  require('fs').mkdirSync(mediaDir, { recursive: true })
  const dest = require('path').join(mediaDir, 'logo_' + type + '.' + ext)
  for (const e of ['png','jpg','jpeg']) {
    const old = require('path').join(mediaDir, 'logo_' + type + '.' + e)
    if (require('fs').existsSync(old)) try { require('fs').unlinkSync(old) } catch(_) {}
  }
  require('fs').writeFileSync(dest, req.file.buffer)
  console.log('[로고] ' + type + ' 저장: ' + dest + ' (' + req.file.size + ' bytes)')
  res.json({ ok: true, path: dest, size: req.file.size })
})

app.get('/api/pptx-config/logo/:type', (req, res) => {
  const type = req.params.type
  const mediaDir = require('path').join(APP_ROOT, 'pptx_assets', 'media')
  for (const ext of ['png','jpg','jpeg']) {
    const fp = require('path').join(mediaDir, 'logo_' + type + '.' + ext)
    if (require('fs').existsSync(fp)) {
      const buf = require('fs').readFileSync(fp)
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg'
      return res.json({ ok: true, type, base64: buf.toString('base64'), mime })
    }
  }
  res.json({ ok: false })
})

async function generatePptxReport(results, meta = {}) {
  results = results.map(r => {
    if (r.screenshot && r.screenshot.length > 100) return r
    const ev = evidenceStore.get(r.id)
    if (ev && ev.screenshot) return { ...r, screenshot:ev.screenshot, violations:ev.violations||r.violations||[], passes:ev.passes||r.passes||[] }
    return r
  })
  const ssCnt = results.filter(r => r.screenshot && r.screenshot.length > 100).length
  console.log('[PPTX] ' + results.length + '건, 스크린샷: ' + ssCnt + '건')

  const { execFile } = require('child_process')
  const execFileAsync = require('util').promisify(execFile)
  const fpath = require('path')
  const fs    = require('fs')
  const ts    = Date.now()
  const tmpDir   = require('os').tmpdir()
  const dataFile = fpath.join(tmpDir, 'gpptx_' + ts + '.json')
  const outFile  = fpath.join(tmpDir, 'gpptx_' + ts + '_out.pptx')
  const mediaDir = fpath.join(APP_ROOT, 'pptx_assets', 'media')

  fs.writeFileSync(dataFile, JSON.stringify({ results, meta }, null, 2), 'utf-8')

  const nodeScript = fpath.join(APP_ROOT, 'pptx_node.js')
  const nodeExe    = fpath.join(APP_ROOT, 'runtime', 'node.exe')
  const nodeCmd    = (process.platform === 'win32' && fs.existsSync(nodeExe)) ? nodeExe : process.execPath

  try {
    const { stdout } = await execFileAsync(
      nodeCmd, [nodeScript, dataFile, outFile, mediaDir],
      { timeout: 600000, maxBuffer: 50 * 1024 * 1024 }
    )
    if (stdout) console.log('[PPTX]', stdout.trim())
  } catch (e) {
    throw new Error('PPTX 생성 실패: ' + e.message)
  } finally {
    try { fs.unlinkSync(dataFile) } catch(_) {}
  }

  const buf = fs.readFileSync(outFile)
  try { fs.unlinkSync(outFile) } catch(_) {}
  return buf
}
