// ═══════════════════════════════════════════════════════════
//  reader.cjs — 스크린 리더 시뮬레이션 + 모바일 점검  (v6.6)
//  · 기기(데스크톱/iPhone/Galaxy)로 렌더링 → 화면 낭독기 순서의 읽기 대본 생성
//  · 각 줄: 역할 · 접근 가능한 이름 · 상태 · 위치(rect) · 문제 플래그
//  · 모바일: 가로 스크롤 · 24px 미만 터치 대상 · 12px 미만 글자 · viewport 메타
// ═══════════════════════════════════════════════════════════
const { chromium, devices } = require('playwright')

const DEVICES = {
  desktop: { name: '데스크톱 (1280×900)', viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  iphone:  { name: 'iPhone 14', ...devices['iPhone 14'] },
  galaxy:  { name: 'Galaxy S9+', ...devices['Galaxy S9+'] },
}

// 페이지 안에서 실행되는 대본 생성기 (직렬화되어 page.evaluate로 전달)
const buildTranscript = () => {
  const ROLE_KO = { link: '링크', button: '버튼', heading: '제목', img: '이미지', textbox: '편집창', checkbox: '확인란', radio: '라디오 버튼', combobox: '콤보상자', listbox: '목록상자', switch: '스위치', tab: '탭', menuitem: '메뉴 항목', slider: '슬라이더', table: '표', list: '목록', iframe: '프레임', text: '', banner: '배너 영역', navigation: '탐색 영역', main: '주요 콘텐츠', contentinfo: '콘텐츠 정보 영역', search: '검색 영역', region: '영역', complementary: '보조 영역', form: '입력 양식', dialog: '대화상자' }
  const GENERIC = /^(더\s?보기|더보기|여기|자세히|자세히\s?보기|click here|here|more|read more|링크|바로가기|이동|보기|확인)$/i
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim()
  const isHidden = el => { let e = el; while (e && e !== document.body) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || e.getAttribute('aria-hidden') === 'true' || e.hidden) return true; e = e.parentElement } return false }
  const ariaHiddenAncestor = el => { let e = el; while (e && e !== document.body) { if (e.getAttribute('aria-hidden') === 'true') return true; e = e.parentElement } return false }
  const textOf = el => norm([...el.childNodes].map(n => n.nodeType === 3 ? n.textContent : (n.nodeType === 1 ? (n.tagName === 'IMG' ? (n.getAttribute('alt') || '') : (n.getAttribute('aria-label') || (isHidden(n) ? '' : textOf(n)))) : '')).join(' '))
  const byIds = ids => norm(String(ids || '').split(/\s+/).map(id => { const t = document.getElementById(id); return t ? textOf(t) : '' }).join(' '))
  function accName(el) {
    const lb = el.getAttribute('aria-labelledby'); if (lb) { const t = byIds(lb); if (t) return { name: t, src: 'aria-labelledby' } }
    const al = el.getAttribute('aria-label'); if (al && norm(al)) return { name: norm(al), src: 'aria-label' }
    const tag = el.tagName
    if (tag === 'IMG' || (tag === 'INPUT' && el.type === 'image') || tag === 'AREA') { const alt = el.getAttribute('alt'); if (alt !== null) return { name: norm(alt), src: 'alt', decorative: norm(alt) === '' } ; return { name: '', src: 'none' } }
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) {
      if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l && textOf(l)) return { name: textOf(l), src: 'label' } }
      const wrap = el.closest('label'); if (wrap && textOf(wrap)) return { name: textOf(wrap), src: 'label' }
      if (el.getAttribute('title')) return { name: norm(el.getAttribute('title')), src: 'title' }
      if (el.placeholder) return { name: norm(el.placeholder), src: 'placeholder' }
      if (tag === 'INPUT' && ['submit', 'button', 'reset'].includes(el.type) && el.value) return { name: norm(el.value), src: 'value' }
      return { name: '', src: 'none' }
    }
    if (tag === 'IFRAME') return { name: norm(el.getAttribute('title') || ''), src: el.getAttribute('title') ? 'title' : 'none' }
    if (tag === 'svg' || tag === 'SVG') { const t = el.querySelector('title'); return t ? { name: norm(t.textContent), src: 'svg-title' } : { name: '', src: 'none' } }
    const t = textOf(el); if (t) return { name: t, src: 'text' }
    const ti = el.getAttribute('title'); if (ti) return { name: norm(ti), src: 'title' }
    return { name: '', src: 'none' }
  }
  function roleOf(el) {
    const r = (el.getAttribute('role') || '').toLowerCase(); if (r) return r
    const tag = el.tagName
    if (tag === 'A' && el.hasAttribute('href')) return 'link'
    if (tag === 'BUTTON' || (tag === 'INPUT' && ['button', 'submit', 'reset', 'image'].includes(el.type))) return 'button'
    if (/^H[1-6]$/.test(tag)) return 'heading'
    if (tag === 'IMG' || tag === 'svg' || tag === 'SVG') return 'img'
    if (tag === 'INPUT') return ({ checkbox: 'checkbox', radio: 'radio', range: 'slider' })[el.type] || 'textbox'
    if (tag === 'TEXTAREA') return 'textbox'; if (tag === 'SELECT') return 'combobox'; if (tag === 'IFRAME') return 'iframe'
    if (tag === 'TABLE') return 'table'; if (tag === 'UL' || tag === 'OL') return 'list'
    if (tag === 'HEADER' && !el.closest('article,section,main')) return 'banner'; if (tag === 'NAV') return 'navigation'; if (tag === 'MAIN') return 'main'
    if (tag === 'FOOTER' && !el.closest('article,section,main')) return 'contentinfo'; if (tag === 'ASIDE') return 'complementary'
    if (tag === 'FORM' && (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'))) return 'form'
    if (tag === 'SECTION' && (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'))) return 'region'
    if (['P', 'LI', 'TD', 'TH', 'DT', 'DD', 'FIGCAPTION', 'BLOCKQUOTE', 'LABEL', 'LEGEND', 'CAPTION', 'SUMMARY'].includes(tag)) return 'text'
    return null
  }
  const LANDMARKS = new Set(['banner', 'navigation', 'main', 'contentinfo', 'search', 'region', 'complementary', 'form', 'dialog'])
  const items = []; let lastHeading = 0; const linkNames = new Map(); let n = 0
  const sel = 'a[href],button,input,select,textarea,img,svg,iframe,h1,h2,h3,h4,h5,h6,table,ul,ol,header,nav,main,footer,aside,form,section,[role],p,li,td,th,dt,dd,figcaption,blockquote,label,legend,caption,summary'
  const push = it => { it.i = n++; items.push(it) }
  const openedLandmarks = []
  for (const el of document.querySelectorAll(sel)) {
    const role = roleOf(el); if (!role) continue
    if (isHidden(el)) { if (!ariaHiddenAncestor(el) || !el.matches('a[href],button,input,select,textarea,[tabindex]')) continue }
    const r = el.getBoundingClientRect(); const rect = { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) }
    if (rect.w === 0 && rect.h === 0 && role !== 'text' && !LANDMARKS.has(role)) continue
    const { name, src, decorative } = accName(el)
    const issues = []
    // 영역
    if (LANDMARKS.has(role)) {
      // 이전에 열린 영역이 이 요소를 포함하지 않으면 닫기
      while (openedLandmarks.length && !openedLandmarks[openedLandmarks.length - 1].el.contains(el)) { const o = openedLandmarks.pop(); push({ role: o.role, name: o.name, text: `${ROLE_KO[o.role] || o.role} 끝`, kind: 'landmark-end', rect: null }) }
      const lname = (el.getAttribute('aria-labelledby') ? byIds(el.getAttribute('aria-labelledby')) : norm(el.getAttribute('aria-label') || ''))
      openedLandmarks.push({ el, role, name: lname })
      push({ role, name: lname, text: `${ROLE_KO[role] || role}${lname ? ', ' + lname : ''} 시작`, kind: 'landmark', rect, sel: cssPath(el) }); continue
    }
    while (openedLandmarks.length && !openedLandmarks[openedLandmarks.length - 1].el.contains(el)) { const o = openedLandmarks.pop(); push({ role: o.role, name: o.name, text: `${ROLE_KO[o.role] || o.role} 끝`, kind: 'landmark-end', rect: null }) }
    if (role === 'text') { const t = textOf(el); if (!t || el.querySelector('a[href],button,input,h1,h2,h3,h4,h5,h6,img,ul,ol,table,p')) continue; push({ role, name: t.slice(0, 90), text: t.slice(0, 90) + (t.length > 90 ? '…' : ''), kind: 'text', rect, sel: cssPath(el) }); continue }
    if (role === 'img') { if (decorative) continue; if (src === 'none') issues.push({ code: 'img-no-alt', msg: '대체 텍스트 없음 — 낭독기가 파일명이나 "이미지"라고만 읽음' }) }
    if (['link', 'button', 'textbox', 'checkbox', 'radio', 'combobox', 'switch', 'tab', 'menuitem', 'slider', 'iframe', 'listbox'].includes(role)) {
      if (!name) issues.push({ code: 'no-name', msg: `이름 없음 — "${ROLE_KO[role] || role}"이라고만 읽힘` })
      else if (src === 'placeholder') issues.push({ code: 'placeholder-only', msg: '레이블 없이 placeholder만 — 입력 시작하면 이름이 사라짐' })
      if (role === 'link' && GENERIC.test(name)) issues.push({ code: 'generic-link', msg: '목적을 알 수 없는 링크 문구' })
      if (role === 'link' && name) { const href = el.getAttribute('href'); const prev = linkNames.get(name); if (prev && prev !== href) issues.push({ code: 'same-name-diff-target', msg: `같은 이름의 링크가 다른 곳(${prev.slice(0, 40)})으로도 감` }); if (!prev) linkNames.set(name, href) }
      const ti = parseInt(el.getAttribute('tabindex') || '0', 10); if (ti > 0) issues.push({ code: 'tabindex-positive', msg: `tabindex=${ti} — 키보드 순서가 문서 순서와 달라짐` })
      if (ariaHiddenAncestor(el)) issues.push({ code: 'hidden-focusable', msg: 'aria-hidden 영역 안의 초점 요소 — 낭독기엔 안 읽히고 키보드로는 도달' })
    }
    let level = null, state = []
    if (role === 'heading') { level = parseInt((el.getAttribute('aria-level') || el.tagName.replace('H', '')), 10) || 2; if (lastHeading && level > lastHeading + 1) issues.push({ code: 'heading-skip', msg: `제목 단계 건너뜀 (${lastHeading} → ${level})` }); lastHeading = level; if (!name) issues.push({ code: 'empty-heading', msg: '빈 제목' }) }
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') state.push('사용 불가')
    if (role === 'checkbox' || role === 'radio' || role === 'switch') state.push((el.checked || el.getAttribute('aria-checked') === 'true') ? '선택됨' : '선택 안 됨')
    if (el.getAttribute('aria-expanded')) state.push(el.getAttribute('aria-expanded') === 'true' ? '펼쳐짐' : '접힘')
    if (el.getAttribute('aria-current')) state.push('현재 위치')
    if (el.required || el.getAttribute('aria-required') === 'true') state.push('필수')
    let extra = ''
    if (role === 'list') extra = `${el.querySelectorAll(':scope > li').length}개 항목`
    if (role === 'table') { const rows = el.querySelectorAll('tr').length, cols = (el.querySelector('tr') || { children: [] }).children.length; extra = `${rows}행 ${cols}열`; if (!el.querySelector('th') && rows > 2) issues.push({ code: 'table-no-th', msg: '제목 셀(th) 없는 표' }) }
    if (role === 'list' || role === 'table') { push({ role, name, level, state, text: `${ROLE_KO[role]}, ${extra}`, kind: 'struct', rect, issues, sel: cssPath(el) }); continue }
    const roleKo = role === 'heading' ? `제목 ${level}` : (ROLE_KO[role] || role)
    const text = [roleKo, name || (role === 'img' ? '(대체 텍스트 없음)' : '(이름 없음)'), ...state].join(', ')
    push({ role, name, nameSrc: src, level, state, text, kind: 'element', rect, issues, sel: cssPath(el), html: el.outerHTML.slice(0, 200) })
  }
  while (openedLandmarks.length) { const o = openedLandmarks.pop(); push({ role: o.role, name: o.name, text: `${ROLE_KO[o.role] || o.role} 끝`, kind: 'landmark-end', rect: null }) }
  function cssPath(el) { const parts = []; let e = el; while (e && e.nodeType === 1 && parts.length < 6) { let s = e.tagName.toLowerCase(); if (e.id) { parts.unshift(s + '#' + CSS.escape(e.id)); break } const p = e.parentElement; if (p) { const sib = [...p.children].filter(c => c.tagName === e.tagName); if (sib.length > 1) s += `:nth-of-type(${sib.indexOf(e) + 1})` } parts.unshift(s); e = p } return parts.join('>') }
  // 모바일 점검
  const inter = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link]')].filter(e => !isHidden(e))
  const smallTargets = inter.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24) }).length
  let smallText = 0; const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT); let node
  while ((node = walker.nextNode())) { if (!node.textContent.trim() || !node.parentElement || isHidden(node.parentElement)) continue; if (parseFloat(getComputedStyle(node.parentElement).fontSize) < 12) smallText++ }
  const mobile = { horizontalScroll: document.documentElement.scrollWidth > innerWidth + 2, pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, smallTargets, interactive: inter.length, smallText, viewportMeta: !!document.querySelector('meta[name=viewport]') }
  return { items, mobile, title: document.title, pageHeight: document.documentElement.scrollHeight }
}

async function readerScan(url, deviceKey = 'desktop', opts = {}) {
  const dev = DEVICES[deviceKey] || DEVICES.desktop
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  try {
    const { name, ...ctxOpts } = dev
    const ctx = await browser.newContext({ ...ctxOpts, locale: 'ko-KR', ignoreHTTPSErrors: true })
    const page = await ctx.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {}); await page.waitForFunction(() => document.body && document.body.childElementCount > 0, null, { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(1200)
    // 지연 로드 요소를 위해 끝까지 한 번 스크롤
    await page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)) } window.scrollTo(0, 0) })
    await page.waitForTimeout(400)
    const data = await page.evaluate(buildTranscript)
    const vp = page.viewportSize() || dev.viewport
    const maxH = Math.min(data.pageHeight, 6000)
    const shot = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 70, clip: { x: 0, y: 0, width: vp.width, height: maxH } }).catch(() => page.screenshot({ type: 'jpeg', quality: 70 }))
    await ctx.close()
    const issues = data.items.filter(it => it.issues && it.issues.length)
    const counts = {}; for (const it of issues) for (const is of it.issues) counts[is.code] = (counts[is.code] || 0) + 1
    return { url, title: data.title, device: deviceKey, deviceName: dev.name, viewport: vp, scale: dev.deviceScaleFactor || 1, pageHeight: data.pageHeight, shotHeight: maxH,
      screenshot: shot.toString('base64'), items: data.items, stats: { total: data.items.length, elements: data.items.filter(i => i.kind === 'element').length, issues: issues.length, byCode: counts, headings: data.items.filter(i => i.role === 'heading').length, links: data.items.filter(i => i.role === 'link').length, buttons: data.items.filter(i => i.role === 'button').length, images: data.items.filter(i => i.role === 'img').length },
      mobile: data.mobile, at: new Date().toISOString() }
  } finally { await browser.close().catch(() => {}) }
}

module.exports = { readerScan, DEVICES, ISSUE_KO: {
  'no-name': '이름 없음', 'img-no-alt': '대체 텍스트 없음', 'placeholder-only': 'placeholder만 있음', 'generic-link': '목적 불명 링크', 'same-name-diff-target': '같은 이름·다른 주소', 'tabindex-positive': 'tabindex 양수', 'hidden-focusable': '숨김 영역 안 초점', 'heading-skip': '제목 단계 건너뜀', 'empty-heading': '빈 제목', 'table-no-th': '제목 셀 없는 표' } }
