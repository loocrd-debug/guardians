// std_ext.js — 웹표준 간이 점검 (브라우저 안에서 가능한 범위). 완전한 W3C 검증은 가디언즈 정밀 검사에서.
(() => {
  const items = []
  const add = (id, name, status, detail, evidence) => items.push({ id, name, status, detail, evidence: evidence ? String(evidence).slice(0, 160) : undefined })
  const vis = el => { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' }
  // 1 DOCTYPE
  { const dt = document.doctype; if (!dt) add('doctype', 'DOCTYPE 선언', 'fail', 'DOCTYPE 없음 — 호환 모드(quirks)로 렌더링됨'); else if (dt.name.toLowerCase() !== 'html' || dt.publicId) add('doctype', 'DOCTYPE 선언', 'partial', `HTML5 표준 선언이 아님: <!DOCTYPE ${dt.name}${dt.publicId ? ' PUBLIC "' + dt.publicId + '"' : ''}>`); else add('doctype', 'DOCTYPE 선언', 'pass', '<!DOCTYPE html>') }
  if (document.compatMode === 'BackCompat') add('quirks', '표준 모드 렌더링', 'fail', '브라우저가 호환 모드(BackCompat)로 렌더링 — DOCTYPE 문제'); else add('quirks', '표준 모드 렌더링', 'pass', 'CSS1Compat')
  // 2 charset
  { const m = document.querySelector('meta[charset], meta[http-equiv="Content-Type" i]'); const cs = (m?.getAttribute('charset') || m?.getAttribute('content') || document.characterSet || '').toLowerCase(); if (!m) add('charset', '문자셋 선언', 'fail', '문자셋 메타 없음'); else if (!/utf-8/.test(cs)) add('charset', '문자셋 선언', 'partial', 'UTF-8이 아님: ' + cs); else add('charset', '문자셋 선언', 'pass', 'UTF-8') }
  // 3 title / lang
  add('title', 'title 요소', document.title.trim() ? 'pass' : 'fail', document.title.trim() ? `"${document.title.trim().slice(0, 40)}"` : 'title 없음')
  { const l = document.documentElement.getAttribute('lang'); add('lang', 'html lang 속성', l ? 'pass' : 'fail', l ? `lang="${l}"` : 'lang 없음') }
  // 4 중복 id
  { const ids = {}; document.querySelectorAll('[id]').forEach(e => { const i = e.id; if (i) ids[i] = (ids[i] || 0) + 1 }); const dup = Object.entries(ids).filter(([, n]) => n > 1); add('dup-id', 'id 중복', dup.length ? (dup.length > 3 ? 'fail' : 'partial') : 'pass', dup.length ? `중복 id ${dup.length}개` : '중복 없음', dup.slice(0, 5).map(([i, n]) => `#${i} ×${n}`).join(' · ')) }
  // 5 폐기 요소·속성
  { const dep = ['font', 'center', 'marquee', 'blink', 'frame', 'frameset', 'applet', 'big', 'strike', 'tt', 'acronym', 'basefont', 'dir', 'isindex']; const found = {}; for (const t of dep) { const n = document.getElementsByTagName(t).length; if (n) found[t] = n }
    const attrs = [...document.querySelectorAll('[align],[bgcolor],[cellpadding],[cellspacing],[valign],[hspace],[vspace],[nowrap],[language]')].filter(e => !/^(TABLE|TD|TH|TR)$/.test(e.tagName) || e.hasAttribute('bgcolor') || e.hasAttribute('align')).length
    const tot = Object.values(found).reduce((a, b) => a + b, 0)
    add('deprecated', '폐기(HTML5 비표준) 요소', tot ? 'fail' : 'pass', tot ? `폐기 요소 ${tot}개` : '없음', Object.entries(found).map(([t, n]) => `<${t}> ×${n}`).join(' · '))
    add('deprecated-attr', '표현용 속성(align·bgcolor 등)', attrs > 20 ? 'fail' : attrs ? 'partial' : 'pass', attrs ? `표현용 속성 사용 요소 ${attrs}개 — CSS로 대체 권장` : '없음') }
  // 6 인라인 이벤트·스타일
  { const ev = [...document.querySelectorAll('*')].filter(e => [...e.attributes].some(a => /^on[a-z]+$/i.test(a.name))).length; const st = document.querySelectorAll('[style]').length
    add('inline-event', '인라인 이벤트 핸들러(onclick 등)', ev > 30 ? 'partial' : 'pass', `${ev}개` + (ev > 30 ? ' — 스크립트 분리 권장' : ''))
    add('inline-style', '인라인 style 속성', st > 100 ? 'partial' : 'pass', `${st}개` + (st > 100 ? ' — CSS 분리 권장' : '')) }
  // 7 구조 요소
  { const need = ['header', 'nav', 'main', 'footer']; const miss = need.filter(t => !document.querySelector(t)); add('semantic', '시맨틱 구조 요소(header·nav·main·footer)', miss.length === 0 ? 'pass' : miss.length >= 3 ? 'fail' : 'partial', miss.length ? `없음: ${miss.join(', ')}` : '모두 사용') }
  // 8 img alt 누락·iframe title·button type
  { const imgs = [...document.querySelectorAll('img')].filter(vis); const noalt = imgs.filter(i => !i.hasAttribute('alt')).length; add('img-alt', 'img alt 속성', noalt ? 'fail' : 'pass', noalt ? `alt 속성 없는 이미지 ${noalt}/${imgs.length}` : `이미지 ${imgs.length}개 모두 alt 속성 있음`) }
  { const fr = [...document.querySelectorAll('iframe')]; const nt = fr.filter(f => !f.getAttribute('title')).length; if (fr.length) add('iframe-title', 'iframe title', nt ? 'fail' : 'pass', nt ? `title 없는 iframe ${nt}/${fr.length}` : `iframe ${fr.length}개 모두 title`) }
  { const bt = [...document.querySelectorAll('button')]; const nt = bt.filter(b => !b.hasAttribute('type')).length; if (bt.length) add('button-type', 'button type 속성', nt > bt.length / 2 ? 'partial' : 'pass', nt ? `type 없는 button ${nt}/${bt.length} — 폼 안에서 submit으로 동작할 수 있음` : '모두 type 지정') }
  // 9 표 구조
  { const tb = [...document.querySelectorAll('table')]; const layout = tb.filter(t => !t.querySelector('th') && t.querySelectorAll('tr').length >= 2).length; if (tb.length) add('table', '표 구조(th·caption)', layout ? (layout === tb.length ? 'fail' : 'partial') : 'pass', layout ? `th 없는 표 ${layout}/${tb.length} (레이아웃용 표 의심)` : `표 ${tb.length}개 모두 th 있음`) }
  // 10 링크·자원
  { const emptyHref = [...document.querySelectorAll('a')].filter(a => !a.hasAttribute('href') || /^(#|javascript:)/i.test(a.getAttribute('href') || '')).length; add('a-href', 'a 요소 href (#·javascript: 남용)', emptyHref > 20 ? 'partial' : 'pass', `href 없음/#/javascript: ${emptyHref}개` + (emptyHref > 20 ? ' — button 요소로 대체 권장' : '')) }
  { const mixed = location.protocol === 'https:' ? [...document.querySelectorAll('img[src^="http:"],script[src^="http:"],link[href^="http:"],iframe[src^="http:"]')].length : 0; if (location.protocol === 'https:') add('mixed', '혼합 콘텐츠(http 자원)', mixed ? 'fail' : 'pass', mixed ? `http 자원 ${mixed}개` : '없음') }
  // 11 viewport
  { const v = document.querySelector('meta[name="viewport"]'); add('viewport', 'viewport 메타', v ? 'pass' : 'fail', v ? v.getAttribute('content') : '없음 — 모바일에서 축소 렌더링') }
  // 12 콘솔 오류는 접근 불가 → 미표시
  const scored = items.filter(i => i.status !== 'na'); const p = scored.filter(i => i.status === 'pass').length, pa = scored.filter(i => i.status === 'partial').length
  return { ok: true, url: location.href, at: Date.now(), items, passed: p, partial: pa, failed: scored.length - p - pa, score: scored.length ? Math.round((p + pa * 0.5) / scored.length * 100) : null, note: '브라우저 안에서 가능한 간이 점검입니다. 태그 닫힘·중첩 오류 등 문법 검증은 정밀 검사(W3C/내장 검증기)에서 합니다.' }
})()
