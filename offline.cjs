// ═══════════════════════════════════════════════════════════
//  offline.cjs — 폐쇄망(행정망) 대응
//  · netStatus(): 인터넷 가능 여부 감지 (60초 캐시, GUARDIANS_OFFLINE=1 로 강제)
//  · spellOffline(text): 내장 규칙 오탈자 검사 (Daum 접속 불가 시 대체)
//  · validateOffline(html): 내장 HTML 검증 (W3C 접속 불가 시 대체, html-validate)
//  · isPrivateHost(url): 사설망·내부 주소 판별 (폐쇄망에서 외부 링크 분리)
// ═══════════════════════════════════════════════════════════
const path = require('path')

// ── 망 상태 ──
let _net = { online: null, at: 0, reason: '' }
async function netStatus(force = false) {
  if (process.env.GUARDIANS_OFFLINE === '1') return { online: false, reason: '설정으로 폐쇄망 모드 강제', at: Date.now() }
  if (!force && _net.online !== null && Date.now() - _net.at < 60000) return _net
  const probes = ['https://www.gov.kr/robots.txt', 'https://dic.daum.net/', 'https://validator.w3.org/']
  let online = false, reason = '외부 접속 실패'
  for (const u of probes) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 3000)
      const r = await fetch(u, { method: 'HEAD', signal: ctl.signal, redirect: 'manual' }); clearTimeout(t)
      if (r.status > 0) { online = true; reason = ''; break }
    } catch (_) {}
  }
  _net = { online, reason, at: Date.now() }
  return _net
}

function isPrivateHost(u) {
  try {
    const h = new URL(u).hostname.toLowerCase()
    return h === 'localhost' || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h) || !h.includes('.') || /\.(local|lan|intra|internal|corp|go\.kr\.internal)$/.test(h)
  } catch (_) { return false }
}

// ── 내장 오탈자 규칙: 공문서·안내문 빈출 오류 (표기 → 교정, 근거) ──
//    한글 맞춤법·표준어 규정 기준. 고유명사 오탐을 줄이기 위해 어절 단위·문맥 패턴만 사용
const RULES = [
  // 맞춤법 (틀린 표기 → 바른 표기)
  ['됬', '됐', '한글 맞춤법 §35 (되+었→됐)'], ['됫', '됐', '한글 맞춤법 §35'],
  ['되요', '돼요', '한글 맞춤법 §35 (되어요→돼요)'], ['되서', '돼서', '한글 맞춤법 §35'], ['되죠', '되죠', null],
  ['안되요', '안 돼요', '띄어쓰기·§35'], ['안됩니다', '안 됩니다', '띄어쓰기 (부정 부사 "안")'], ['않되', '안 되', '"않"은 용언 부정, "안"은 부사'],
  ['왠지', '왠지', null], ['웬지', '왠지', '표준어 (왠지=왜인지)'], ['왠만하면', '웬만하면', '표준어'], ['왠일', '웬일', '표준어'],
  ['몇일', '며칠', '한글 맞춤법 §27 붙임'], ['오랫만', '오랜만', '표준어 (오래간만)'], ['오랜동안', '오랫동안', '표준어'],
  ['금새', '금세', '표준어 (금시에)'], ['희안', '희한', '표준어'], ['역활', '역할', '표준어'], ['설레임', '설렘', '표준어'],
  ['바램', '바람', '표준어 (바라다→바람)'], ['뒤쳐지', '뒤처지', '표준어'], ['넓직', '널찍', '한글 맞춤법 §21'], ['어의없', '어이없', '표준어'],
  ['갯수', '개수', '한글 맞춤법 §30 (한자어 사이시옷 예외)'], ['촛점', '초점', '§30'], ['댓가', '대가', '§30'], ['횟수', '횟수', null],
  ['할께요', '할게요', '한글 맞춤법 §53'], ['할껄', '할걸', '§53'], ['할꺼', '할 거', '§53·띄어쓰기'], ['거예요', '거예요', null], ['거에요', '거예요', '한글 맞춤법 (것이에요→거예요)'],
  ['예요', '예요', null], ['아니예요', '아니에요', '"이에요"의 준말 규칙'], ['이였', '이었', '표준어'], ['였습니다', '였습니다', null],
  ['틀리', '틀리', null], ['않 ', '안 ', null],
  ['어떻해', '어떡해', '표준어 (어떻게 해→어떡해)'], ['어떻게든', '어떻게든', null],
  ['얘기', '얘기', null], ['에게서', '에게서', null],
  ['금액 은', '금액은', null],
  ['율', '율', null],
  ['수 밖에', '수밖에', '띄어쓰기 (조사 "밖에")'], ['할수있', '할 수 있', '띄어쓰기 (의존명사 "수")'], ['할수없', '할 수 없', '띄어쓰기'], ['될수있', '될 수 있', '띄어쓰기'], ['될수없', '될 수 없', '띄어쓰기'],
  ['볼수있', '볼 수 있', '띄어쓰기'], ['볼수없', '볼 수 없', '띄어쓰기'], ['갈수있', '갈 수 있', '띄어쓰기'], ['알수있', '알 수 있', '띄어쓰기'], ['알수없', '알 수 없', '띄어쓰기'],
  ['하기바랍니다', '하기 바랍니다', '띄어쓰기'], ['하시기바랍니다', '하시기 바랍니다', '띄어쓰기'], ['주시기바랍니다', '주시기 바랍니다', '띄어쓰기'],
  ['것같', '것 같', '띄어쓰기 (의존명사 "것")'], ['할것', '할 것', '띄어쓰기'], ['될것', '될 것', '띄어쓰기'], ['한것', '한 것', '띄어쓰기'],
  ['하는것', '하는 것', '띄어쓰기'], ['있는것', '있는 것', '띄어쓰기'], ['없는것', '없는 것', '띄어쓰기'],
  ['할때', '할 때', '띄어쓰기 (의존명사 "때")'], ['될때', '될 때', '띄어쓰기'], ['있을때', '있을 때', '띄어쓰기'], ['없을때', '없을 때', '띄어쓰기'],
  ['할지', '할지', null], ['한지', '한 지', null],
  ['뿐만아니라', '뿐만 아니라', '띄어쓰기'], ['그동안', '그동안', null], ['이외에', '이외에', null], ['그중', '그중', null],
  ['첫번째', '첫 번째', '띄어쓰기 (단위 "번째")'], ['두번째', '두 번째', '띄어쓰기'], ['세번째', '세 번째', '띄어쓰기'],
  ['한번', '한 번', null], ['이번', '이번', null],
  ['수립하고자', '수립하고자', null],
  ['그럼에도 불구하고', '그럼에도', '군더더기 ("불구하고" 중복)'],
  ['기존의', '기존', null],
  ['잇달아', '잇달아', null], ['잇따라', '잇따라', null],
  ['맞추', '맞추', null], ['맞히', '맞히', null],
  ['틈틈히', '틈틈이', '한글 맞춤법 §51'], ['깨끗히', '깨끗이', '§51'], ['일일히', '일일이', '§51'], ['꼼꼼이', '꼼꼼히', '§51'], ['솔직이', '솔직히', '§51'], ['정확이', '정확히', '§51'],
  ['며칠 후', '며칠 후', null],
  ['예:', '예:', null],
  ['서비스을', '서비스를', '조사 (받침 없음→를)'], ['서비스은', '서비스는', '조사'], ['시스템를', '시스템을', '조사 (받침 있음→을)'], ['시스템는', '시스템은', '조사'],
  ['인터넷를', '인터넷을', '조사'], ['홈페이지을', '홈페이지를', '조사'], ['홈페이지은', '홈페이지는', '조사'], ['페이지을', '페이지를', '조사'], ['정보을', '정보를', '조사'], ['정보은', '정보는', '조사'],
  ['신청서을', '신청서를', '조사'], ['신청서은', '신청서는', '조사'], ['민원를', '민원을', '조사'], ['민원는', '민원은', '조사'],
  ['하십시요', '하십시오', '한글 맞춤법 (명령형 "-십시오")'], ['하세요', '하세요', null], ['주십시요', '주십시오', '"-십시오"'], ['바랍니다', '바랍니다', null], ['바래요', '바라요', '표준어 (바라다)'],
  ['알맞는', '알맞은', '형용사 활용'], ['걸맞는', '걸맞은', '형용사 활용'],
  ['~', '~', null],
  ['부치', '부치', null],
  ['확인하시길', '확인하시길', null],
  ['됩니다.', '됩니다.', null],
].filter(r => r[2])   // 근거가 있는 것만 실제 규칙으로 사용 (null은 오탐 방지용 보류)

// 중복 공백·문장부호 규칙
const EXTRA = [
  { re: /([가-힣])\s{2,}([가-힣])/g, fix: (m, a, b) => `${a} ${b}`, what: '연속 공백', ref: '표기 정리' },
  { re: /([가-힣a-zA-Z0-9])\s+([,.!?])/g, fix: (m, a, p) => `${a}${p}`, what: '문장부호 앞 공백', ref: '문장부호 규정' },
  { re: /\.{3,}/g, fix: () => '…', what: '말줄임표는 "…"', ref: '문장부호 규정' },
]

function spellOffline(text) {
  const issues = []
  if (!text) return { issues, engine: 'builtin', totalIssues: 0 }
  for (const [bad, good, ref] of RULES) {
    let idx = 0
    while ((idx = text.indexOf(bad, idx)) >= 0) {
      const ctx = text.slice(Math.max(0, idx - 12), idx + bad.length + 12).replace(/\s+/g, ' ')
      issues.push({ word: bad, suggestion: good, type: ref.includes('띄어쓰기') ? '띄어쓰기' : (ref.includes('조사') ? '조사' : '맞춤법'), reason: ref, context: ctx })
      idx += bad.length
      if (issues.length > 200) break
    }
  }
  for (const r of EXTRA) {
    let m; const re = new RegExp(r.re.source, r.re.flags)
    while ((m = re.exec(text)) && issues.length < 250) {
      issues.push({ word: m[0], suggestion: r.fix(...m), type: '표기', reason: r.ref, context: text.slice(Math.max(0, m.index - 12), m.index + m[0].length + 12).replace(/\s+/g, ' ') })
    }
  }
  // 같은 오류 중복 제거 (표기+제안 기준, 건수는 유지)
  const seen = new Map()
  for (const i of issues) { const k = i.word + '→' + i.suggestion; if (!seen.has(k)) seen.set(k, { ...i, count: 0 }); seen.get(k).count++ }
  const merged = [...seen.values()]
  return { issues: merged, engine: 'builtin', engineNote: '폐쇄망 내장 규칙(공문서 빈출 오류 ' + RULES.length + '종)으로 검사했습니다. 온라인(Daum 맞춤법)보다 범위가 좁습니다.', totalIssues: merged.reduce((s, i) => s + i.count, 0) }
}

// ── 오프라인 HTML 검증 (html-validate) ──
let _hv = null
function getValidator() {
  if (_hv) return _hv
  try {
    const { HtmlValidate } = require('html-validate')
    _hv = new HtmlValidate({ extends: ['html-validate:recommended'], rules: { 'no-inline-style': 'off', 'no-trailing-whitespace': 'off', 'attribute-boolean-style': 'off', 'void-style': 'off', 'no-implicit-close': 'warn', 'element-required-attributes': 'error', 'attr-quotes': 'off', 'require-sri': 'off', 'long-title': 'off', 'no-dup-id': 'error', 'no-dup-class': 'warn', 'prefer-native-element': 'warn', 'wcag/h30': 'off', 'wcag/h32': 'off', 'wcag/h36': 'off', 'wcag/h37': 'off', 'wcag/h67': 'off', 'wcag/h71': 'off' } })
    return _hv
  } catch (e) { return null }
}
async function validateOffline(html) {
  const hv = getValidator()
  if (!hv) return { valid: null, errorCount: 0, warningCount: 0, fatalCount: 0, errors: [], warnings: [], engine: 'none', engineNote: '내장 HTML 검증기를 불러올 수 없습니다' }
  const rep = await hv.validateString(String(html || ''))
  const msgs = (rep.results[0] && rep.results[0].messages) || []
  const errors = msgs.filter(m => m.severity === 2).map(m => ({ type: 'error', message: `${m.message} (${m.ruleId})`, lastLine: m.line, firstColumn: m.column, extract: m.selector || '' }))
  const warnings = msgs.filter(m => m.severity === 1).map(m => ({ type: 'warning', message: `${m.message} (${m.ruleId})`, lastLine: m.line, firstColumn: m.column }))
  return { valid: errors.length === 0, errorCount: errors.length, warningCount: warnings.length, fatalCount: 0, errors, warnings, engine: 'html-validate', engineNote: '폐쇄망 내장 검증기(html-validate)로 검사했습니다. W3C Nu 검증기와 규칙이 일부 다릅니다.' }
}

module.exports = { netStatus, isPrivateHost, spellOffline, validateOffline, RULE_COUNT: RULES.length }
