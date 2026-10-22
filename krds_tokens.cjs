// ═══════════════════════════════════════════════════════════
//  krds_tokens.cjs — KRDS 디자인 토큰(Foundation) 검사  (v6.12)
//  · 기준: krds.go.kr 공식 토큰 CSS(krds_tokens.css) + 스타일 가이드(타이포그래피·형태)
//  · 색상(팔레트·주요 색상·강조 색상) · 타이포그래피(서체·기본 크기·두께·줄 간격·자간·rem 단위) · 형태(래디어스)
//  · 판정: pass / partial / fail / na(판단 불가), 근거(실측 분포)와 기준값을 함께 반환
// ═══════════════════════════════════════════════════════════
const fs = require('fs')
const path = require('path')
// 판정 기준값은 krds_standard.cjs의 '적용 중인 기준'에서 가져옴 (담당자가 승인 · 발행한 버전, 없으면 내장 기본값)
const STD = () => require('./krds_standard.cjs').current()

// 페이지 안에서 실행
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

// ── 색 거리 (CIE76 근사) ──
const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
function lab([r, g, b]) { const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; const [R, G, B] = [f(r), f(g), f(b)]
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, y = (R * 0.2126 + G * 0.7152 + B * 0.0722), z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
  const t = v => v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116; x = t(x); y = t(y); z = t(z); return [116 * y - 16, 500 * (x - y), 200 * (y - z)] }
const dE = (a, b) => { const [l1, a1, b1] = lab(rgb(a)), [l2, a2, b2] = lab(rgb(b)); return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2) }
function nearest(c, pal) { let best = null, bd = 1e9; for (const [name, v] of Object.entries(pal)) { const d = dE(c, v); if (d < bd) { bd = d; best = name } } return { name: best, d: Math.round(bd * 10) / 10 } }

async function tokenScan(page) {
  const S = STD(); const d = await page.evaluate(collect, S.palette)
  const pal = S.palette || {}; const items = []; const FONT = S.font || 'Pretendard GOV', BODY = +S.bodyPx || 17, BMIN = +S.bodyMinPx || 16, LH = +S.lineHeight || 1.5, W = (S.weights || [400, 700]).map(String), RAD = S.radii || [2, 4, 6, 8, 10, 12], RMAX = +S.radiusMax || 12, DE = +S.paletteDeltaE || 4, PMAX = +S.pointMaxPct || 10
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

module.exports = { tokenScan, get REF() { return STD() } }
