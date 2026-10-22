// ═══════════════════════════════════════════════════════════
//  suggest.js — 위반 요소의 실제 HTML을 "이렇게 고치세요"로 바꿔 주는 제안 엔진
//  · Node(서버)와 브라우저(확장)에서 같은 코드 사용
//  · 입력: 규칙 ID, 요소 HTML 조각, (색 대비 데이터)  → 출력: { after, note, contrast? }
// ═══════════════════════════════════════════════════════════
;(function (root) {
  const P = '[여기에 입력]'
  const attr = (html, name) => { const m = html.match(new RegExp('\\s' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i')); return m ? (m[2] ?? m[3] ?? m[4]) : null }
  const hasAttr = (html, name) => new RegExp('\\s' + name + '(\\s|=|>|/)', 'i').test(html)
  // 첫 여는 태그의 '>' 앞에 속성 추가
  const addAttr = (html, name, value) => {
    const m = html.match(/^(\s*<[a-zA-Z][^\s>\/]*)([^>]*?)(\/?)>/); if (!m) return html
    const tail = m[2].replace(/\s+$/, '')
    return html.replace(m[0], `${m[1]}${tail} ${name}="${value}"${m[3] ? ' /' : ''}>`)
  }
  const setAttr = (html, name, value) => hasAttr(html, name) ? html.replace(new RegExp('(\\s' + name + '\\s*=\\s*)("[^"]*"|\'[^\']*\'|[^\\s>]+)', 'i'), `$1"${value}"`) : addAttr(html, name, value)
  const tag = html => (html.match(/^\s*<([a-zA-Z][\w-]*)/) || [])[1]?.toLowerCase()
  const inner = html => { const m = html.match(/^\s*<[^>]*>([\s\S]*)<\/[^>]+>\s*$/); return m ? m[1] : null }
  const isEmptyInner = html => { const i = inner(html); return i != null && !i.replace(/<[^>]*>/g, '').trim() }

  // ── 색 대비: WCAG 상대 휘도 ──
  function hexToRgb(h) { h = String(h).trim(); const m = h.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i); if (!m) { const r = h.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i); return r ? [+r[1], +r[2], +r[3]] : null }
    let s = m[1]; if (s.length === 3) s = s.split('').map(c => c + c).join(''); return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)] }
  const toHex = rgb => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
  function lum([r, g, b]) { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  function ratio(a, b) { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05) }
  // 배경은 두고 글자색만 조정해 목표 대비를 만족하는 색 찾기 (어두운 배경이면 밝게, 밝은 배경이면 어둡게)
  function suggestColor(fg, bg, target) {
    const f = hexToRgb(fg), b = hexToRgb(bg); if (!f || !b) return null
    const towardDark = lum(b) > 0.18
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const c = f.map(v => towardDark ? v * (1 - t) : v + (255 - v) * t)
      if (ratio(c, b) >= target) return { color: toHex(c), ratio: Math.round(ratio(c, b) * 100) / 100 }
    }
    return { color: towardDark ? '#000000' : '#ffffff', ratio: Math.round(ratio(towardDark ? [0, 0, 0] : [255, 255, 255], b) * 100) / 100 }
  }

  // ── 규칙별 패치 ──
  const RULES = {
    'image-alt': h => ({ after: setAttr(h, 'alt', '[이미지가 전달하는 내용]'), note: '장식용이면 alt=""' }),
    'input-image-alt': h => ({ after: setAttr(h, 'alt', '[버튼 기능]') }),
    'area-alt': h => ({ after: setAttr(h, 'alt', '[영역이 가리키는 곳]') }),
    'role-img-alt': h => ({ after: setAttr(h, 'aria-label', '[이미지 설명]') }),
    'svg-img-alt': h => ({ after: setAttr(h, 'aria-label', '[그림 설명]') }),
    'object-alt': h => ({ after: h.replace(/(<object[^>]*>)/i, '$1[대체 내용]') }),
    'button-name': h => isEmptyInner(h) ? { after: setAttr(h, 'aria-label', '[버튼 기능, 예: 닫기]'), note: '아이콘 태그에는 aria-hidden="true"' } : { after: setAttr(h, 'aria-label', '[버튼 기능]') },
    'input-button-name': h => ({ after: setAttr(h, 'value', '[버튼 기능]') }),
    'link-name': h => { const t = attr(h, 'title'); return isEmptyInner(h) ? { after: setAttr(h, 'aria-label', t || '[링크 목적, 예: 채용 공고 보기]') } : { after: h.replace(/>([^<]{0,20})<\/a>/, '>[링크 목적이 드러나는 문구]</a>') } },
    'label': h => { const id = attr(h, 'id'); if (id) return { after: `<label for="${id}">${P}</label>\n${h.trim()}` }; return { after: setAttr(h, 'aria-label', P), note: '보이는 label을 두는 것이 더 좋습니다' } },
    'label-title-only': h => { const id = attr(h, 'id') || 'field'; const t = attr(h, 'title') || P; return { after: `<label for="${id}">${t}</label>\n${setAttr(h, 'id', id)}` } },
    'select-name': h => { const id = attr(h, 'id') || 'select'; return { after: `<label for="${id}">${P}</label>\n${setAttr(h, 'id', id)}` } },
    'aria-input-field-name': h => ({ after: setAttr(h, 'aria-label', P) }),
    'aria-toggle-field-name': h => ({ after: setAttr(h, 'aria-label', P) }),
    'aria-command-name': h => ({ after: setAttr(h, 'aria-label', P) }),
    'aria-dialog-name': h => ({ after: setAttr(h, 'aria-label', '[대화상자 제목]'), note: '제목 요소가 있으면 aria-labelledby="제목id"가 더 좋습니다' }),
    'html-has-lang': h => ({ after: setAttr(h.match(/^\s*<html[^>]*>/i) ? h.match(/^\s*<html[^>]*>/i)[0] : '<html>', 'lang', 'ko') }),
    'html-lang-valid': h => ({ after: setAttr(h.match(/^\s*<html[^>]*>/i)?.[0] || h, 'lang', 'ko') }),
    'valid-lang': h => ({ after: setAttr(h, 'lang', 'ko') }),
    'html-xml-lang-mismatch': h => ({ after: setAttr(setAttr(h, 'lang', 'ko'), 'xml:lang', 'ko') }),
    'document-title': () => ({ after: '<title>[페이지 내용을 나타내는 제목] — [기관명]</title>' }),
    'frame-title': h => ({ after: setAttr(h, 'title', '[프레임 내용, 예: 청사 위치 지도]') }),
    'frame-title-unique': h => ({ after: setAttr(h, 'title', '[다른 프레임과 구별되는 제목]') }),
    'meta-viewport': h => ({ after: h.replace(/,?\s*user-scalable\s*=\s*(no|0)/i, '').replace(/,?\s*maximum-scale\s*=\s*[\d.]+/i, '') }),
    'meta-viewport-large': h => ({ after: h.replace(/,?\s*maximum-scale\s*=\s*[\d.]+/i, '') }),
    'meta-refresh': () => ({ after: '<!-- meta refresh 제거 -->\n<a href="[이동할 주소]">다음 단계로</a>' }),
    'landmark-one-main': h => ({ after: `<main>\n  ${P.replace('입력', '본문 내용')}\n</main>`, note: '본문을 감싸는 main은 하나만' }),
    'region': h => ({ after: `<main>\n  ${h.trim()}\n</main>`, note: '헤더·메뉴·푸터라면 header / nav / footer로 감싸세요' }),
    'landmark-unique': h => ({ after: setAttr(h, 'aria-label', '[영역 이름, 예: 주 메뉴]') }),
    'landmark-no-duplicate-banner': h => ({ after: h.replace(/^\s*<header/i, '<div class="section-head"'), note: '최상위 header는 하나만' }),
    'landmark-no-duplicate-contentinfo': h => ({ after: h.replace(/^\s*<footer/i, '<div class="section-foot"'), note: '최상위 footer는 하나만' }),
    'bypass': () => ({ after: '<a href="#main" class="skip-link">본문 바로가기</a>  <!-- body 첫 줄 -->\n…\n<main id="main">' }),
    'skip-link': h => { const href = attr(h, 'href') || '#main'; return { after: `${h.trim()}\n…\n<main id="${href.replace('#', '')}">` } },
    'page-has-heading-one': h => ({ after: `<h1>[페이지 주제]</h1>` }),
    'empty-heading': h => ({ after: h.replace(/>\s*</, `>${P}<`) }),
    'heading-order': h => { const n = +(h.match(/^\s*<h([1-6])/i) || [])[1]; return n ? { after: h.replace(new RegExp(`<(\\/?)h${n}`, 'gi'), `<$1h${Math.max(1, n - 1)}`), note: '바로 앞 제목 단계의 +1이 되도록 조정 (예시는 한 단계 위)' } : null },
    'p-as-heading': h => ({ after: h.replace(/^\s*<p([^>]*)>/i, '<h2$1>').replace(/<\/p>\s*$/i, '</h2>').replace(/<\/?(b|strong)>/gi, '') }),
    'list': h => ({ after: h.replace(/<(div|span|p)([^>]*)>([\s\S]*?)<\/\1>/gi, '<li$2>$3</li>') }),
    'listitem': h => ({ after: `<ul>\n  ${h.trim()}\n</ul>` }),
    'definition-list': h => ({ after: h, note: 'dl 안에는 dt·dd(및 div 그룹)만 두세요' }),
    'duplicate-id-aria': h => { const id = attr(h, 'id'); return id ? { after: setAttr(h, 'id', id + '-2'), note: '참조하는 aria-* 속성도 새 id로' } : null },
    'tabindex': h => ({ after: h.replace(/\s+tabindex\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, ''), note: 'tabindex는 0 또는 -1만' }),
    'aria-hidden-focus': h => ({ after: h.replace(/(<a\b|<button\b|<input\b|<select\b|<textarea\b)([^>]*?)>/gi, '$1$2 tabindex="-1">') }),
    'aria-hidden-body': h => ({ after: h.replace(/\s+aria-hidden\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, '') }),
    'aria-roles': h => { const r = attr(h, 'role'); const fix = { btn: 'button', link: 'link', navigation: 'navigation', nav: 'navigation', img: 'img', check: 'checkbox' }[r] ; return { after: fix ? setAttr(h, 'role', fix) : h.replace(/\s+role\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, ''), note: 'WAI-ARIA에 정의된 role만' } },
    'aria-valid-attr-value': h => ({ after: h.replace(/(aria-(expanded|checked|selected|pressed|hidden|disabled|required|invalid)\s*=\s*")[^"]*"/gi, '$1true"'), note: '허용 값(true/false 등)으로' }),
    'aria-allowed-attr': h => ({ after: h, note: '해당 요소에 허용되지 않는 aria-* 속성을 제거하거나 알맞은 role을 지정하세요' }),
    'aria-prohibited-attr': h => ({ after: h.replace(/\s+aria-label(ledby)?\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ''), note: '텍스트로 이름을 주세요' }),
    'aria-required-attr': h => { const r = attr(h, 'role'); const need = { checkbox: 'aria-checked="false"', switch: 'aria-checked="false"', radio: 'aria-checked="false"', slider: 'aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"', combobox: 'aria-expanded="false"', option: 'aria-selected="false"', scrollbar: 'aria-controls="[id]" aria-valuenow="0"', heading: 'aria-level="2"' }[r]; return need ? { after: h.replace(/^(\s*<[^>]*?)(\/?)>/, `$1 ${need}$2>`) } : null },
    'presentation-role-conflict': h => ({ after: h.replace(/\s+(tabindex|aria-[\w-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ''), note: 'presentation 요소는 초점·aria 속성을 갖지 않게' }),
    'nested-interactive': h => ({ after: h, note: '안쪽 링크/버튼 중 하나만 남기세요' }),
    'scrollable-region-focusable': h => ({ after: setAttr(h, 'tabindex', '0') }),
    'autocomplete-valid': h => { const v = (attr(h, 'autocomplete') || '').toLowerCase(); const map = { phone: 'tel', mobile: 'tel', mail: 'email', 'e-mail': 'email', zip: 'postal-code', zipcode: 'postal-code', fullname: 'name', firstname: 'given-name', lastname: 'family-name', addr: 'street-address', birthday: 'bday' }; return { after: setAttr(h, 'autocomplete', map[v] || 'on'), note: '표준 토큰: name, email, tel, postal-code, street-address, bday …' } },
    'video-caption': h => ({ after: h.replace(/<\/video>\s*$/i, '  <track kind="captions" src="[자막파일].vtt" srclang="ko" label="한국어">\n</video>') }),
    'no-autoplay-audio': h => ({ after: h.replace(/\s+autoplay(\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/i, '').replace(/^(\s*<(video|audio)\b)/i, '$1 controls') }),
    'blink': h => ({ after: h.replace(/<\/?blink>/gi, m => m.startsWith('</') ? '</strong>' : '<strong>') }),
    'marquee': h => ({ after: h.replace(/<\/?marquee[^>]*>/gi, m => m.startsWith('</') ? '</p>' : '<p>') }),
    'td-headers-attr': h => ({ after: h, note: 'headers 값을 실제 th의 id와 일치시키세요' }),
    'td-has-header': h => ({ after: h.replace(/<td\b/gi, '<th scope="col"').replace(/<\/td>/gi, '</th>'), note: '첫 행(또는 열)만 th로' }),
    'th-has-data-cells': h => ({ after: setAttr(h, 'scope', 'col') }),
    'scope-attr-valid': h => { const v = (attr(h, 'scope') || '').toLowerCase(); return { after: setAttr(h, 'scope', /row/.test(v) ? 'row' : 'col') } },
    'label-content-name-mismatch': h => { const t = (inner(h) || '').replace(/<[^>]*>/g, '').trim(); return t ? { after: setAttr(h, 'aria-label', t) } : null },
    'image-redundant-alt': h => ({ after: setAttr(h, 'alt', '') }),
    'summary-name': h => ({ after: h.replace(/<summary>\s*<\/summary>/i, `<summary>${P.replace('입력', '펼침 제목')}</summary>`) }),
    'link-in-text-block': h => ({ after: h, note: 'CSS: a { text-decoration: underline } — 색 외에 밑줄로 구분' }),
    'target-size': h => ({ after: h, note: 'CSS: min-width:24px; min-height:24px; 또는 padding 확대' }),
    'color-contrast': (h, data) => {
      if (!data || !data.fgColor || !data.bgColor) return { after: h, note: '글자색을 진하게 하거나 배경을 밝게 해 4.5:1(큰 글자 3:1) 이상으로' }
      const target = data.expectedContrastRatio ? parseFloat(String(data.expectedContrastRatio)) : 4.5
      const s = suggestColor(data.fgColor, data.bgColor, target); if (!s) return { after: h }
      const cur = Math.round((data.contrastRatio || ratio(hexToRgb(data.fgColor), hexToRgb(data.bgColor))) * 100) / 100
      return { after: `/* 글자색 ${data.fgColor} → ${s.color}  (배경 ${data.bgColor} 유지) */\ncolor: ${s.color};`, note: `현재 ${cur}:1 → 제안 ${s.ratio}:1 (기준 ${target}:1)`, contrast: { from: data.fgColor, to: s.color, bg: data.bgColor, before: cur, after: s.ratio, target } }
    },
  }

  function suggest(ruleId, html, data) {
    try {
      const fn = RULES[ruleId]; if (!fn || !html) return null
      const r = fn(String(html), data); if (!r || !r.after) return null
      if (r.after.trim() === String(html).trim() && !r.note) return null
      return r
    } catch (_) { return null }
  }
  root.GuardiansSuggest = { suggest, suggestColor, ratio, hexToRgb, rules: Object.keys(RULES) }
})(typeof module !== 'undefined' && module.exports ? module.exports : (typeof window !== 'undefined' ? window : globalThis))
