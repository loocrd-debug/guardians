// krds_ext.js — 확장용 KRDS 검사 (서버 엔진 이식: 정밀 판정 16규칙 + 디자인 토큰 11항목)  — 자동 생성, 수정은 krds_deep.cjs/krds_tokens.cjs 에서
(() => {
const PALETTE = {"--krds-light-primary-5": "#f0f5fe", "--krds-light-primary-10": "#dde9fd", "--krds-light-primary-20": "#b6cefb", "--krds-light-primary-30": "#8bb2f9", "--krds-light-primary-40": "#4c87f6", "--krds-light-primary-50": "#256ef4", "--krds-light-primary-60": "#0b50d0", "--krds-light-primary-70": "#083891", "--krds-light-primary-80": "#052561", "--krds-light-primary-90": "#03163a", "--krds-light-primary-95": "#020f27", "--krds-light-secondary-5": "#eef2f7", "--krds-light-secondary-10": "#daecf1", "--krds-light-secondary-20": "#bcdde6", "--krds-light-secondary-30": "#90b0d5", "--krds-light-secondary-40": "#6b96c7", "--krds-light-secondary-50": "#346fb2", "--krds-light-secondary-60": "#1c589c", "--krds-light-secondary-70": "#063a74", "--krds-light-secondary-80": "#052b57", "--krds-light-secondary-90": "#042449", "--krds-light-secondary-95": "#02162c", "--krds-light-gray-0": "#ffffff", "--krds-light-gray-5": "#fafafa", "--krds-light-gray-10": "#eaebec", "--krds-light-gray-20": "#d7d9db", "--krds-light-gray-30": "#bfc2c5", "--krds-light-gray-40": "#8f9499", "--krds-light-gray-50": "#6f757b", "--krds-light-gray-60": "#61666b", "--krds-light-gray-70": "#494d50", "--krds-light-gray-80": "#303336", "--krds-light-gray-90": "#1f2123", "--krds-light-gray-95": "#131415", "--krds-light-gray-100": "#000000", "--krds-light-danger-5": "#fcebe8", "--krds-light-danger-10": "#fad7d1", "--krds-light-danger-20": "#f5aea3", "--krds-light-danger-30": "#f08675", "--krds-light-danger-40": "#eb5d47", "--krds-light-danger-50": "#dc3318", "--krds-light-danger-60": "#b82a14", "--krds-light-danger-70": "#8a200f", "--krds-light-danger-80": "#5c150a", "--krds-light-danger-90": "#370d06", "--krds-light-danger-95": "#170303", "--krds-light-information-5": "#e7f2fe", "--krds-light-information-10": "#cfe5fc", "--krds-light-information-20": "#9eccfa", "--krds-light-information-30": "#6eb2f7", "--krds-light-information-40": "#3d99f5", "--krds-light-information-50": "#1a80e5", "--krds-light-information-60": "#0a66c2", "--krds-light-information-70": "#084c91", "--krds-light-information-80": "#053361", "--krds-light-information-90": "#031f3a", "--krds-light-information-95": "#021427", "--krds-light-warning-5": "#fff3db", "--krds-light-warning-10": "#ffe0a3", "--krds-light-warning-20": "#ffc95c", "--krds-light-warning-30": "#ffb114", "--krds-light-warning-40": "#c78500", "--krds-light-warning-50": "#9e6a00", "--krds-light-warning-60": "#8a5c00", "--krds-light-warning-70": "#614100", "--krds-light-warning-80": "#422c00", "--krds-light-warning-90": "#2e1f00", "--krds-light-warning-95": "#241800", "--krds-light-success-5": "#eaf6ec", "--krds-light-success-10": "#dbf0e0", "--krds-light-success-20": "#b8e0c0", "--krds-light-success-30": "#7acd8c", "--krds-light-success-40": "#38a850", "--krds-light-success-50": "#328544", "--krds-light-success-60": "#2c6839", "--krds-light-success-70": "#25562f", "--krds-light-success-80": "#1a3d22", "--krds-light-success-90": "#122b18", "--krds-light-success-95": "#0e2012", "--krds-light-point-5": "#faebec", "--krds-light-point-10": "#f5d6d9", "--krds-light-point-20": "#ebadb2", "--krds-light-point-30": "#e0858c", "--krds-light-point-40": "#d65c66", "--krds-light-point-50": "#cc3340", "--krds-light-point-60": "#a32933", "--krds-light-point-70": "#7a1f26", "--krds-light-point-80": "#521419", "--krds-light-point-90": "#310c0f", "--krds-light-point-95": "#21080a"}
const DEEP_NAMES = {"lang": "HTML lang", "title": "페이지 제목", "viewport": "viewport(확대 허용)", "skip-nav": "본문 바로가기", "official-banner": "공식 누리집 배너", "header": "헤더(홈 링크·메뉴)", "footer": "푸터(개인정보·저작권·연락처)", "privacy": "개인정보처리방침 링크 구별", "h1": "h1 제목", "img-alt": "이미지 alt 품질", "form-label": "입력 레이블", "search": "검색(이름·버튼)", "breadcrumb": "브레드크럼", "new-window": "새 창 안내", "link-text": "링크 문구", "charset": "문자셋 UTF-8"}
// ── 색 거리 (CIE76 근사) ──
const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
function lab([r, g, b]) { const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; const [R, G, B] = [f(r), f(g), f(b)]
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, y = (R * 0.2126 + G * 0.7152 + B * 0.0722), z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
  const t = v => v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116; x = t(x); y = t(y); z = t(z); return [116 * y - 16, 500 * (x - y), 200 * (y - z)] }
const dE = (a, b) => { const [l1, a1, b1] = lab(rgb(a)), [l2, a2, b2] = lab(rgb(b)); return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2) }
function nearest(c, pal) { let best = null, bd = 1e9; for (const [name, v] of Object.entries(pal)) { const d = dE(c, v); if (d < bd) { bd = d; best = name } } return { name: best, d: Math.round(bd * 10) / 10 } }

const deepEval = () => {
  const out = {}
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim()
  const vis = el => { if (!el) return false; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const set = (id, status, detail, evidence) => { out[id] = { status, detail, evidence: evidence ? String(evidence).slice(0, 160) : undefined } }
  const koRatio = (() => { const t = (document.body?.innerText || '').slice(0, 4000); const ko = (t.match(/[가-힣]/g) || []).length; const en = (t.match(/[A-Za-z]/g) || []).length; return ko / Math.max(1, ko + en) })()

  // 1) lang — 값이 실제 문서 언어와 맞는가
  { const lang = (document.documentElement.getAttribute('lang') || '').toLowerCase()
    if (!lang) set('lang', 'fail', 'lang 속성 없음')
    else if (koRatio > 0.5 && !/^ko/.test(lang)) set('lang', 'fail', `본문은 한국어(${Math.round(koRatio*100)}%)인데 lang="${lang}"`, lang)
    else set('lang', 'pass', `lang="${lang}"`) }

  // 2) title — 페이지 고유 제목인가
  { const t = norm(document.title); const h1 = norm(document.querySelector('h1')?.textContent)
    if (!t) set('title', 'fail', 'title 없음')
    else if (t.length < 4 || /^(untitled|home|index|main|홈|메인)$/i.test(t)) set('title', 'partial', `제목이 일반적임: "${t}" — 페이지 내용을 나타내는 제목 권장`, t)
    else if (!/[|\-–·:]/.test(t) && h1 && !t.includes(h1.slice(0, 6)) && t.length < 12) set('title', 'partial', `제목 "${t}"이(가) 페이지 주제(h1 "${h1.slice(0,20)}")와 달라 보임`, t)
    else set('title', 'pass', `"${t}"`) }

  // 3) viewport — 모바일 확대 허용
  { const v = document.querySelector('meta[name="viewport"]')?.getAttribute('content') || ''
    if (!v) set('viewport', 'fail', 'viewport 메타 없음')
    else if (!/width\s*=\s*device-width/i.test(v)) set('viewport', 'partial', `width=device-width 없음: "${v}"`, v)
    else if (/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test(v)) set('viewport', 'partial', `확대 차단(user-scalable=no/maximum-scale=1) — 저시력 이용자가 글자를 키울 수 없음: "${v}"`, v)
    else set('viewport', 'pass', `"${v}"`) }

  // 4) skip-nav — 건너뛰기 링크가 실제로 동작하는가
  { const links = [...document.querySelectorAll('a[href^="#"]')].filter(a => /skip|jump|content|main|본문|바로가기|건너뛰기/i.test(a.textContent + a.className + a.id))
    if (!links.length) set('skip-nav', 'fail', '본문 바로가기 링크 없음')
    else {
      const a = links[0]; const id = a.getAttribute('href').slice(1); const target = id ? (document.getElementById(id) || document.querySelector(`[name="${CSS.escape(id)}"]`)) : null
      const focusables = [...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(vis)
      const isFirst = focusables[0] === a || [...document.querySelectorAll('a[href],button,input,select,textarea')].indexOf(a) < 3
      if (!target) set('skip-nav', 'fail', `링크 대상 #${id} 요소가 페이지에 없음 — 눌러도 이동 안 됨`, a.outerHTML)
      else if (!isFirst) set('skip-nav', 'partial', '건너뛰기 링크가 첫 번째 초점 요소가 아님 — 낭독기 사용자가 먼저 만나지 못함', a.outerHTML)
      else if (target.tabIndex < 0 && !/^(main|div|section)$/i.test(target.tagName) && !target.hasAttribute('tabindex')) set('skip-nav', 'partial', '대상 요소에 tabindex="-1"이 없어 일부 브라우저에서 초점이 이동하지 않음', target.outerHTML)
      else set('skip-nav', 'pass', `"${norm(a.textContent)}" → #${id}`) } }

  // 5) official-banner — 공식 배너가 맨 위에 보이는가
  { const txtEl = [...document.querySelectorAll('body *')].find(el => el.children.length < 4 && /이\s*누리집은\s*대한민국\s*공식\s*전자정부/.test(el.textContent || '') && vis(el))
    const el = txtEl || document.querySelector('.official-banner, #official-banner, [class*="gov-banner"], [class*="official"]')
    if (!el) set('official-banner', 'fail', '공식 누리집 배너 없음')
    else { const r = el.getBoundingClientRect(); const top = r.top + scrollY
      if (!vis(el)) set('official-banner', 'partial', '배너가 있으나 화면에 보이지 않음', el.outerHTML)
      else if (top > 120) set('official-banner', 'partial', `배너가 페이지 상단이 아님 (위에서 ${Math.round(top)}px)`, el.outerHTML)
      else if (!/이\s*누리집은/.test(el.textContent || '')) set('official-banner', 'partial', '배너 요소는 있으나 표준 문구("이 누리집은 대한민국 공식 전자정부 누리집입니다")가 없음', el.outerHTML)
      else set('official-banner', 'pass', '상단 표준 문구 배너 확인') } }

  // 6) header — 로고(홈 링크) + 내비게이션 포함
  { const h = document.querySelector('header, [role="banner"], #header, .header')
    if (!h) set('header', 'fail', '헤더 영역 없음')
    else { const home = [...h.querySelectorAll('a[href]')].find(a => /^(\/|\.\/|index|\/main|https?:\/\/[^/]+\/?$)/.test(a.getAttribute('href') || '') || /홈|home|메인/i.test(a.getAttribute('title') + a.textContent + (a.querySelector('img')?.alt || '')))
      const nav = h.querySelector('nav, [role="navigation"], ul li a')
      if (!home && !nav) set('header', 'partial', '헤더에 홈 링크(로고)와 메뉴가 없음')
      else if (!home) set('header', 'partial', '헤더에 홈으로 가는 로고/링크가 없음')
      else if (!nav) set('header', 'partial', '헤더에 주 메뉴가 없음')
      else set('header', 'pass', '로고(홈 링크)와 메뉴 확인') } }

  // 7) footer — 개인정보처리방침 · 저작권 · 연락처
  { const f = document.querySelector('footer, [role="contentinfo"], #footer, .footer')
    if (!f) set('footer', 'fail', '푸터 영역 없음')
    else { const t = f.innerText || ''; const miss = []
      if (!/개인정보\s*처리\s*방침/.test(t)) miss.push('개인정보처리방침')
      if (!/copyright|ⓒ|©|\(c\)|저작권|all rights/i.test(t)) miss.push('저작권 표시')
      if (!/\d{2,4}[-.)]\s?\d{3,4}[-.]\d{4}|전화|tel|대표번호|주소|\d{5}\b/i.test(t)) miss.push('연락처/주소')
      if (miss.length === 3) set('footer', 'partial', `푸터에 ${miss.join(' · ')} 모두 없음`)
      else if (miss.length) set('footer', 'partial', `푸터에 ${miss.join(' · ')} 없음`)
      else set('footer', 'pass', '개인정보처리방침 · 저작권 · 연락처 확인') } }

  // 8) privacy — 개인정보처리방침 링크가 눈에 띄는가 (개인정보보호법 §30 ②)
  { const a = [...document.querySelectorAll('a')].find(a => /개인정보\s*처리\s*방침/.test(a.textContent || ''))
    if (!a) set('privacy', 'fail', '개인정보처리방침 링크 없음')
    else { const cs = getComputedStyle(a); const sib = [...(a.parentElement?.querySelectorAll('a') || [])].filter(x => x !== a)
      const bold = parseInt(cs.fontWeight, 10) >= 600 || (sib.length && sib.every(s => getComputedStyle(s).color !== cs.color))
      if (!vis(a)) set('privacy', 'partial', '링크가 있으나 보이지 않음', a.outerHTML)
      else if (sib.length >= 2 && !bold) set('privacy', 'partial', '다른 링크와 같은 글꼴·색 — 개인정보보호법 §30은 다른 링크와 구별되는 글자체·색으로 표시하도록 함', a.outerHTML)
      else set('privacy', 'pass', bold ? '강조 표시 확인' : '링크 확인') } }

  // 9) h1 — 하나, 비어 있지 않고, 보이는가
  { const hs = [...document.querySelectorAll('h1')]
    if (!hs.length) set('h1', 'fail', 'h1 없음')
    else if (hs.length > 1) set('h1', 'partial', `h1이 ${hs.length}개 — 페이지 주제를 나타내는 h1은 하나`, hs.map(h => norm(h.textContent).slice(0, 20)).join(' / '))
    else { const h = hs[0]; const t = norm(h.textContent) || norm(h.querySelector('img')?.alt)
      if (!t) set('h1', 'fail', 'h1이 비어 있음', h.outerHTML)
      else if (!vis(h)) set('h1', 'partial', `h1 "${t.slice(0,30)}"이 화면에 보이지 않음(숨김)`, h.outerHTML)
      else if (h.querySelector('img') && !norm(h.textContent)) set('h1', 'partial', `h1이 로고 이미지만 — 페이지 주제 텍스트 권장 (alt "${t.slice(0,30)}")`, h.outerHTML)
      else set('h1', 'pass', `"${t.slice(0, 40)}"`) } }

  // 10) img-alt — alt가 있어도 의미 없는 값인가
  { const imgs = [...document.querySelectorAll('img')].filter(vis)
    const bad = imgs.filter(i => { const a = i.getAttribute('alt'); if (a === null) return true; const t = norm(a); if (t === '') return false; return /\.(png|jpe?g|gif|svg|webp)$/i.test(t) || /^(image|img|이미지|사진|picture|photo|logo|아이콘|icon|배너|banner)\d*$/i.test(t) })
    const missing = imgs.filter(i => !i.hasAttribute('alt')).length
    if (!imgs.length) set('img-alt', 'pass', '이미지 없음')
    else if (missing) set('img-alt', 'fail', `alt 없는 이미지 ${missing}개`)
    else if (bad.length) set('img-alt', 'partial', `alt는 있으나 의미 없는 값 ${bad.length}개 (파일명·"이미지" 등)`, bad.slice(0, 3).map(i => i.getAttribute('alt')).join(' / '))
    else set('img-alt', 'pass', `이미지 ${imgs.length}개 모두 의미 있는 alt`) }

  // 11) form-label — 보이는 레이블인가 (placeholder만이면 부분)
  { const inputs = [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea')].filter(vis)
    const kind = inp => { if (inp.id && document.querySelector(`label[for="${CSS.escape(inp.id)}"]`)) return 'label'; if (inp.closest('label')) return 'label'; if (inp.getAttribute('aria-label') || inp.getAttribute('aria-labelledby')) return 'aria'; if (inp.getAttribute('title')) return 'title'; if (inp.getAttribute('placeholder')) return 'placeholder'; return 'none' }
    const ks = inputs.map(kind); const none = ks.filter(k => k === 'none').length, ph = ks.filter(k => k === 'placeholder').length
    if (!inputs.length) set('form-label', 'pass', '입력 요소 없음')
    else if (none) set('form-label', 'fail', `레이블 없는 입력 ${none}개`)
    else if (ph) set('form-label', 'partial', `placeholder만으로 이름을 주는 입력 ${ph}개 — 입력 시작하면 사라짐, label 권장`)
    else set('form-label', 'pass', `입력 ${inputs.length}개 모두 레이블 연결`) }

  // 12) search — 검색창에 이름과 버튼이 있는가
  { const s = document.querySelector('input[type="search"], input[name*="search" i], input[id*="search" i], input[placeholder*="검색"], input[placeholder*="찾"], textarea[placeholder*="검색"], textarea[placeholder*="찾"], [role="search"] input, [role="search"] textarea, [class*="search" i] input:not([type=hidden]), [class*="search" i] textarea, form[action*="search" i] input:not([type=hidden]), input[title*="검색"], input[aria-label*="검색"]')
    if (!s) set('search', 'fail', '검색 입력 없음')
    else { const named = s.id && document.querySelector(`label[for="${CSS.escape(s.id)}"]`) || s.getAttribute('aria-label') || s.getAttribute('title') || s.closest('label')
      const form = s.closest('form') || s.parentElement; const btn = form?.querySelector('button, input[type=submit], input[type=image], [role=button]')
      const btnNamed = btn && (norm(btn.textContent) || btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.getAttribute('value') || btn.getAttribute('alt') || btn.querySelector('img')?.alt)
      if (!named) set('search', 'partial', '검색 입력에 보이는 레이블/aria-label 없음' + (s.placeholder ? ` (placeholder "${s.placeholder}"만)` : ''), s.outerHTML)
      else if (btn && !btnNamed) set('search', 'partial', '검색 버튼에 이름 없음(아이콘만)', btn.outerHTML)
      else set('search', 'pass', '검색 입력·버튼 이름 확인') } }

  // 13) breadcrumb — 현재 위치 표시가 있는가
  { const bc = document.querySelector('[class*="breadcrumb" i], [class*="location" i], nav[aria-label*="위치"], nav[aria-label*="breadcrumb" i], .path, #path')
    if (!bc) set('breadcrumb', 'fail', '브레드크럼 없음')
    else { const cur = bc.querySelector('[aria-current], .active, .current, .on, strong, em'); const links = bc.querySelectorAll('a').length
      if (!links) set('breadcrumb', 'partial', '브레드크럼에 상위 경로 링크가 없음(텍스트만)', bc.outerHTML)
      else if (!cur) set('breadcrumb', 'partial', '현재 페이지 항목이 구분(aria-current 등)되지 않음', bc.outerHTML)
      else set('breadcrumb', 'pass', `경로 링크 ${links}개 · 현재 위치 표시`) } }

  // 14) new-window — 새 창 링크 안내
  { const links = [...document.querySelectorAll('a[target="_blank"]')].filter(vis)
    const noHint = links.filter(a => !/새\s*창|새창|new window|외부/i.test((a.textContent || '') + (a.getAttribute('title') || '') + (a.getAttribute('aria-label') || '') + (a.querySelector('img')?.alt || '')))
    if (!links.length) set('new-window', 'pass', '새 창 링크 없음')
    else if (noHint.length === links.length) set('new-window', 'fail', `새 창 링크 ${links.length}개 모두 안내 없음`)
    else if (noHint.length) set('new-window', 'partial', `새 창 링크 ${links.length}개 중 ${noHint.length}개 안내 없음`, noHint.slice(0, 2).map(a => norm(a.textContent).slice(0, 20)).join(' / '))
    else set('new-window', 'pass', `새 창 링크 ${links.length}개 모두 안내`) }

  // 15) link-text — 목적 불명 링크 비율
  { const links = [...document.querySelectorAll('a[href]')].filter(vis); const generic = links.filter(a => /^(더\s?보기|더보기|여기|자세히|자세히\s?보기|바로가기|보기|click here|more)$/i.test(norm(a.textContent)) && !a.getAttribute('aria-label') && !a.getAttribute('title'))
    if (!links.length) set('link-text', 'pass', '링크 없음')
    else if (generic.length > 5 || generic.length / links.length > 0.2) set('link-text', 'fail', `목적 불명 링크 ${generic.length}개 / ${links.length}개`)
    else if (generic.length) set('link-text', 'partial', `목적 불명 링크 ${generic.length}개 ("더보기" 등) — aria-label 또는 문구 보완 권장`)
    else set('link-text', 'pass', `링크 ${links.length}개 모두 목적이 드러남`) }

  // 16) charset — 문서 첫 1KB 안에 선언
  { const m = document.querySelector('meta[charset], meta[http-equiv="Content-Type" i]'); const cs = (m?.getAttribute('charset') || m?.getAttribute('content') || '').toLowerCase()
    if (!m) set('charset', 'fail', '문자셋 선언 없음'); else if (!/utf-8/.test(cs)) set('charset', 'partial', `UTF-8이 아님: ${cs}`, m.outerHTML); else set('charset', 'pass', 'UTF-8') }

  return out
}
const collect = (palette) => {
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim()
  const vis = el => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const hex = c => { const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/); if (!m) return null; if (m[4] !== undefined && parseFloat(m[4]) === 0) return null; return '#' + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join('') }
  // ── 텍스트 요소 샘플 (본문 글자 길이로 가중) ──
  const textEls = [...document.querySelectorAll('p, li, td, th, dd, dt, span, a, label, button, h1, h2, h3, h4, h5, h6, div')].filter(el => vis(el) && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1)).slice(0, 2500)
  const fam = {}, size = {}, weight = {}, lh = {}, ls = {}, bodySize = {}
  let total = 0
  for (const el of textEls) {
    const cs = getComputedStyle(el); const len = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim().length).reduce((a, b) => a + b, 0); if (!len) continue
    total += len
    const f = norm(cs.fontFamily.split(',')[0].replace(/["']/g, '')); fam[f] = (fam[f] || 0) + len
    const fs_ = Math.round(parseFloat(cs.fontSize)); size[fs_] = (size[fs_] || 0) + len
    const w = cs.fontWeight; weight[w] = (weight[w] || 0) + len
    const lhv = cs.lineHeight === 'normal' ? 1.2 : parseFloat(cs.lineHeight) / parseFloat(cs.fontSize); const lk = (Math.round(lhv * 20) / 20).toFixed(2); lh[lk] = (lh[lk] || 0) + len
    const lsv = cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing); const lsk = lsv === 0 ? '0' : lsv.toFixed(1) + 'px'; ls[lsk] = (ls[lsk] || 0) + len
    if (/^(P|LI|TD|DD)$/.test(el.tagName)) bodySize[fs_] = (bodySize[fs_] || 0) + len
  }
  const top = (o, n = 5) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, pct: Math.round(v / Math.max(1, total) * 100) }))
  // ── 스타일시트에서 font-size 단위 (같은 출처만 읽힘) ──
  let unitPx = 0, unitRem = 0, sheetsBlocked = 0, sheetsRead = 0
  for (const sh of document.styleSheets) {
    let rules; try { rules = sh.cssRules } catch (_) { sheetsBlocked++; continue }
    if (!rules) { sheetsBlocked++; continue } sheetsRead++
    const walk = rs => { for (const r of rs) { if (r.style) { const v = r.style.getPropertyValue('font-size'); if (v) { if (/rem|em$/.test(v)) unitRem++; else if (/px$/.test(v)) unitPx++ } } if (r.cssRules) walk(r.cssRules) } }
    try { walk(rules) } catch (_) {}
  }
  // ── 래디어스 ──
  const radEls = [...document.querySelectorAll('button, a, input, select, textarea, [class*="btn"], [class*="card"], [class*="box"], [class*="tag"], [class*="chip"], [class*="badge"], img, section, article')].filter(vis).slice(0, 1500)
  const rad = {}
  for (const el of radEls) { const cs = getComputedStyle(el); const v = cs.borderTopLeftRadius; if (!v || v === '0px') continue; const r = el.getBoundingClientRect(); const px = /%/.test(v) ? Math.round(Math.min(r.width, r.height) * parseFloat(v) / 100) : Math.round(parseFloat(v)); const pill = px >= Math.min(r.width, r.height) / 2 - 1; const k = pill ? 'pill' : String(px); rad[k] = (rad[k] || 0) + 1 }
  // ── 색상 ──
  const colEls = [...document.querySelectorAll('body *')].filter(vis).slice(0, 4000)
  const colors = {}, bgArea = {}
  for (const el of colEls) { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); const area = r.width * r.height
    const c = hex(cs.color); if (c) colors[c] = (colors[c] || 0) + 1
    const b = hex(cs.backgroundColor); if (b) { colors[b] = (colors[b] || 0) + 1; bgArea[b] = (bgArea[b] || 0) + area }
    const bd = hex(cs.borderTopColor); if (bd && cs.borderTopWidth !== '0px') colors[bd] = (colors[bd] || 0) + 1 }
  // 주요 버튼 색 (primary 후보)
  const btns = [...document.querySelectorAll('button, a[class*="btn"], input[type=submit], [role=button]')].filter(vis)
  const btnBg = {}; for (const b of btns) { const c = hex(getComputedStyle(b).backgroundColor); if (c && c !== '#ffffff') btnBg[c] = (btnBg[c] || 0) + 1 }
  return { total, fam: top(fam), size: top(size, 8), bodySize: top(bodySize, 5), weight: top(weight, 6), lh: top(lh, 6), ls: top(ls, 4), units: { px: unitPx, rem: unitRem, sheetsRead, sheetsBlocked }, rad, colors, bgArea, btnBg, textEls: textEls.length }
}
function tokenJudge() {
  // 적용 기준: 패널이 guardians.ai.kr에서 받아 둔 최신 발행 기준(window.__guardiansStd) — 없으면 내장 기준
  const S = Object.assign({ version: '2026.10.0', basedOn: '내장 기준 (2026-10)', palette: PALETTE }, window.__guardiansStd || {})
  const d = collect(S.palette)
  const pal = S.palette; const items = []; const FONT = S.font || 'Pretendard GOV', BODY = +S.bodyPx || 17, BMIN = +S.bodyMinPx || 16, LH = +S.lineHeight || 1.5, W = (S.weights || [400, 700]).map(String), RAD = S.radii || [2, 4, 6, 8, 10, 12], RMAX = +S.radiusMax || 12, DE = +S.paletteDeltaE || 4, PMAX = +S.pointMaxPct || 10
  const fontRe = new RegExp(FONT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  const add = (id, cat, name, status, detail, ref, evidence) => items.push({ id, cat, name, status, passed: status === 'pass', partial: status === 'partial', na: status === 'na', detail, ref, evidence })
  const pct = (arr, pred) => arr.filter(x => pred(x.k)).reduce((s, x) => s + x.pct, 0)
  // 1 서체
  { const f = d.fam; const gov = pct(f, k => fontRe.test(k)); const pre = pct(f, k => /^pretendard/i.test(k) && !/gov/i.test(k)); const ev = f.map(x => `${x.k} ${x.pct}%`).join(' · ')
    if (gov >= 80) add('t-font', '타이포그래피', `서체 (${FONT})`, 'pass', `본문 ${gov}%가 ${FONT}`, `KRDS 표준형: 국문·영문 모두 ${FONT}`, ev)
    else if (gov + pre >= 80) add('t-font', '타이포그래피', `서체 (${FONT})`, 'partial', `Pretendard(일반) ${pre}% — 표준형은 ${FONT}를 쓰도록 함`, `KRDS 표준형: ${FONT}`, ev)
    else add('t-font', '타이포그래피', `서체 (${FONT})`, 'fail', `${FONT} 비율 ${gov}% — 다른 서체가 주로 쓰임`, `KRDS 표준형: ${FONT}`, ev) }
  // 2 본문 기본 크기
  { const b = d.bodySize.length ? d.bodySize : d.size; const dom = b[0]; const ev = b.map(x => `${x.k}px ${x.pct}%`).join(' · ')
    if (!dom) add('t-size', '타이포그래피', `본문 기본 크기 (${BODY}px)`, 'na', '본문 텍스트를 찾지 못함', `KRDS: 본문 ${BODY}px (최소 ${BMIN}px)`, '')
    else if (+dom.k >= BODY) add('t-size', '타이포그래피', `본문 기본 크기 (${BODY}px)`, 'pass', `본문 주 크기 ${dom.k}px`, `KRDS: 본문 ${BODY}px (최소 ${BMIN}px)`, ev)
    else if (+dom.k >= BMIN) add('t-size', '타이포그래피', `본문 기본 크기 (${BODY}px)`, 'partial', `본문 주 크기 ${dom.k}px — 최소 기준(${BMIN}px)은 충족, 표준 ${BODY}px 권장`, `KRDS: 본문 ${BODY}px (최소 ${BMIN}px)`, ev)
    else add('t-size', '타이포그래피', `본문 기본 크기 (${BODY}px)`, 'fail', `본문 주 크기 ${dom.k}px — 최소 ${BMIN}px 미만`, `KRDS: 본문 ${BODY}px (최소 ${BMIN}px)`, ev) }
  // 3 글자 두께
  { const w = d.weight; const ok = pct(w, k => W.includes(k) || (k === 'normal' && W.includes('400')) || (k === 'bold' && W.includes('700'))); const ev = w.map(x => `${x.k} ${x.pct}%`).join(' · ')
    add('t-weight', '타이포그래피', '글자 두께 (Regular 400 · Bold 700)', ok >= 95 ? 'pass' : ok >= 70 ? 'partial' : 'fail', `400/700 비율 ${ok}%${ok < 95 ? ' — 그 외 두께(500·600 등) 사용' : ''}`, 'KRDS 토큰: font-weight Regular · Bold 2종', ev) }
  // 4 줄 간격
  { const l = d.lh; const ok = pct(l, k => parseFloat(k) >= LH); const near = pct(l, k => parseFloat(k) >= LH - 0.1 && parseFloat(k) < LH); const ev = l.map(x => `${x.k}배 ${x.pct}%`).join(' · ')
    add('t-lh', '타이포그래피', `줄 간격 (${Math.round(LH * 100)}%)`, ok >= 80 ? 'pass' : ok + near >= 80 ? 'partial' : 'fail', `${LH}배 이상 ${ok}%${near ? ` · ${(LH - 0.1).toFixed(1)}~${LH}배 ${near}%` : ''}`, `KRDS: 줄 간격 ${Math.round(LH * 100)}%`, ev) }
  // 5 자간
  { const s = d.ls; const ok = pct(s, k => k === '0'); const ev = s.map(x => `${x.k} ${x.pct}%`).join(' · ')
    add('t-ls', '타이포그래피', '자간 (0)', ok >= 90 ? 'pass' : ok >= 60 ? 'partial' : 'fail', `자간 0 비율 ${ok}%`, 'KRDS 토큰: letter-spacing 0', ev) }
  // 6 rem 단위
  { const u = d.units; const tot = u.px + u.rem
    if (!u.sheetsRead || !tot) add('t-unit', '타이포그래피', '표현 단위 (rem)', 'na', `스타일시트를 읽지 못함 (읽음 ${u.sheetsRead} · 차단 ${u.sheetsBlocked}) — 외부 도메인 CSS는 브라우저가 내용을 숨김`, 'KRDS 토큰: 크기를 rem으로 정의', '')
    else { const r = Math.round(u.rem / tot * 100); add('t-unit', '타이포그래피', '표현 단위 (rem)', r >= 70 ? 'pass' : r >= 30 ? 'partial' : 'fail', `font-size 선언 중 rem/em ${r}% (px ${u.px} · rem ${u.rem})${u.sheetsBlocked ? ` · 외부 CSS ${u.sheetsBlocked}개는 확인 불가` : ''}`, 'KRDS 토큰: 크기를 rem으로 정의', `rem ${u.rem} · px ${u.px}`) } }
  // 7 래디어스
  { const allowed = new Set(RAD.map(Number)); const entries = Object.entries(d.rad).sort((a, b) => b[1] - a[1]); const tot = entries.reduce((s, [, n]) => s + n, 0)
    const bad = entries.filter(([k]) => k !== 'pill' && !allowed.has(+k)); const over = entries.filter(([k]) => k !== 'pill' && +k > RMAX); const badN = bad.reduce((s, [, n]) => s + n, 0)
    const ev = entries.slice(0, 8).map(([k, n]) => `${k === 'pill' ? '알약형' : k + 'px'} ×${n}`).join(' · ')
    if (!tot) add('s-radius', '형태', `래디어스 (${Math.min(...RAD)}~${RMAX}px)`, 'na', '둥근 모서리 요소 없음', `KRDS 표준형: ${RAD.join('·')}px, 최대 ${RMAX}px`, '')
    else add('s-radius', '형태', `래디어스 (${Math.min(...RAD)}~${RMAX}px)`, badN === 0 ? 'pass' : badN / tot <= 0.2 ? 'partial' : 'fail', `${tot}개 중 토큰 외 값 ${badN}개${over.length ? ` (${RMAX}px 초과 ${over.map(([k]) => k + 'px').join(',')})` : ''}`, `KRDS 표준형: ${RAD.join('·')}px, 최대 ${RMAX}px`, ev) }
  // 8 색상 팔레트 준수율
  { const cols = Object.entries(d.colors).filter(([c]) => c !== '#ffffff' && c !== '#000000'); const tot = cols.length
    if (!Object.keys(pal).length || !tot) add('c-palette', '색상', '색상 팔레트 준수율', 'na', '색상 정보 없음', 'KRDS 라이트 팔레트 90색', '')
    else { let inPal = 0; const off = []; for (const [c, n] of cols) { const nr = nearest(c, pal); if (nr.d <= DE) inPal++; else off.push([c, n, nr]) }
      const r = Math.round(inPal / tot * 100); off.sort((a, b) => b[1] - a[1])
      add('c-palette', '색상', '색상 팔레트 준수율', r >= 80 ? 'pass' : r >= 50 ? 'partial' : 'fail', `사용 색 ${tot}개 중 팔레트 색 ${inPal}개 (${r}%)`, 'KRDS 라이트 팔레트(primary·secondary·gray 등 90색)와 ΔE≤' + DE, off.slice(0, 6).map(([c, n, nr]) => `${c} ×${n} (가장 가까운 ${nr.name.replace('--krds-light-', '')} ΔE ${nr.d})`).join(' · ')) } }
  // 9 주요 색상 (primary 버튼)
  { const b = Object.entries(d.btnBg).sort((x, y) => y[1] - x[1]); const prim = Object.entries(pal).filter(([k]) => /primary-(50|60|70)/.test(k)).map(([, v]) => v)
    if (!b.length || !prim.length) add('c-primary', '색상', '주요 색상 (Primary)', 'na', '버튼 배경색을 찾지 못함', 'KRDS primary-50 ' + (pal['--krds-light-primary-50'] || ''), '')
    else { const main = b[0][0]; const d0 = Math.min(...prim.map(p => dE(main, p))); const sec = pal['--krds-light-secondary-50'] ? dE(main, pal['--krds-light-secondary-50']) : 99
      add('c-primary', '색상', '주요 색상 (Primary)', d0 <= 6 ? 'pass' : (d0 <= 15 || sec <= 6) ? 'partial' : 'fail', `주 버튼 색 ${main} — KRDS primary와 ΔE ${Math.round(d0)}`, 'KRDS primary-50 ' + (pal['--krds-light-primary-50'] || ''), b.slice(0, 4).map(([c, n]) => `${c} ×${n}`).join(' · ')) } }
  // 10 강조 색상 (Point) 절제
  { const point = pal['--krds-light-point-50']; if (!point) add('c-point', '색상', '강조 색상 (Point) 절제', 'na', '기준 없음', '', '')
    else { const tot = Object.values(d.colors).reduce((a, b) => a + b, 0); let pt = 0; for (const [c, n] of Object.entries(d.colors)) if (dE(c, point) <= 8) pt += n; const r = Math.round(pt / Math.max(1, tot) * 100)
      add('c-point', '색상', '강조 색상 (Point) 절제', r <= PMAX ? 'pass' : r <= PMAX * 2 ? 'partial' : 'fail', `강조 색 사용 비율 ${r}%`, 'KRDS: 강조 색상은 10% 내외로 절제', `${point} 계열 ${pt}회 / 전체 ${tot}`) } }
  // 11 색상 비율 60/30/10 — 자동 판단 불가
  add('c-ratio', '색상', '배경 60 · 보조 30 · 강조 10 비율', 'na', '화면 면적 기준 색 비율은 자동 판정하지 않음 — 캡처를 보며 확인', 'KRDS: 60% 배경색, 30% 보조 색상, 10% 강조 색상', (() => { const a = Object.entries(d.bgArea).sort((x, y) => y[1] - x[1]).slice(0, 4); const t = a.reduce((s, [, v]) => s + v, 0); return a.map(([c, v]) => `${c} ${Math.round(v / Math.max(1, t) * 100)}%`).join(' · ') })())

  const scored = items.filter(i => !i.na)
  const passed = scored.filter(i => i.passed).length, partial = scored.filter(i => i.partial).length
  return { items, total: items.length, scored: scored.length, passed, partial, failed: scored.length - passed - partial, na: items.length - scored.length, score: scored.length ? Math.round((passed + partial * 0.5) / scored.length * 100) : null, scoring: '준수 1 · 부분 0.5 · 미준수 0 · 판단 불가 제외', reference: `KRDS 기준 ${S.version} — ${S.basedOn || 'krds.go.kr 토큰 CSS'}`, standardVersion: S.version, sample: { textElements: d.textEls, chars: d.total } }
}
const KO = { pass: '준수', partial: '부분 준수', fail: '미준수', na: '판단 불가' }
let deep = {}; try { deep = deepEval() } catch (e) { deep = { _error: String(e) } }
const deepItems = Object.entries(deep).filter(([k]) => k !== '_error').map(([id, v]) => ({ id, name: DEEP_NAMES[id] || id, status: v.status, detail: v.detail, evidence: v.evidence }))
const dp = deepItems.filter(i => i.status === 'pass').length, dpar = deepItems.filter(i => i.status === 'partial').length
let tokens = null; try { tokens = tokenJudge() } catch (e) { tokens = { error: String(e), items: [] } }
return { ok: true, url: location.href, at: Date.now(), KO, deep: { items: deepItems, passed: dp, partial: dpar, failed: deepItems.length - dp - dpar, score: deepItems.length ? Math.round((dp + dpar * 0.5) / deepItems.length * 100) : null }, tokens }
})()
