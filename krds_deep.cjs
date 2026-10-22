// ═══════════════════════════════════════════════════════════
//  krds_deep.cjs — KRDS 정밀 검증 계층 (v6.9)
//  · 기존 규칙(존재 여부) 위에 "제대로 되어 있는가"를 확인해 준수 / 부분 준수 / 미준수로 판정
//  · 각 판정에 근거(detail)를 남겨 결과·결과서에 표시
//  · 점수: 준수 1 · 부분 준수 0.5 · 미준수 0
// ═══════════════════════════════════════════════════════════

// 페이지 안에서 실행 (직렬화)
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

const STATUS_KO = { pass: '준수', partial: '부분 준수', fail: '미준수' }

// 기존 KRDS 결과(items)에 정밀 판정을 합칩니다.
async function applyDeep(page, result) {
  let deep = {}
  try { deep = await page.evaluate(deepEval) } catch (e) { return result }
  const items = result.items || []
  let applied = 0
  for (const it of items) {
    const d = deep[it.id]; if (!d) continue
    it.deep = d.status; it.deepDetail = d.detail; if (d.evidence) it.evidence = d.evidence
    if (d.status === 'fail') { it.passed = false; it.partial = false }
    else if (d.status === 'partial') { it.passed = false; it.partial = true }
    else { it.passed = true; it.partial = false }
    it.detail = `${STATUS_KO[d.status]} — ${d.detail}`
    applied++
  }
  const passed = items.filter(i => i.passed).length, partial = items.filter(i => i.partial).length
  result.passed = passed; result.partial = partial; result.failed = items.length - passed - partial
  result.score = items.length ? Math.round((passed + partial * 0.5) / items.length * 100) : 0
  result.deepApplied = applied; result.scoring = '준수 1 · 부분 준수 0.5 · 미준수 0'
  return result
}

module.exports = { applyDeep, deepEval, STATUS_KO }
