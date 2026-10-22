const $ = s => document.querySelector(s)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const LV = { critical: '치명적', serious: '심각', moderate: '보통', minor: '경미' }
let SERVER = 'https://guardians.ai.kr'   // 기본: 팀 웹. 설정에서 설치형(localhost)으로 변경 가능
const KO = (typeof KO_DATA!=='undefined')?KO_DATA:{}, KW = (typeof KWCAG_DATA!=='undefined')?KWCAG_DATA:{}
let last = null, tabId = null

async function loadSettings() {
  const s = await chrome.storage.local.get(['server', 'autoRun'])
  if (s.server) SERVER = s.server
  $('#srv').value = SERVER; $('#autoRun').checked = !!s.autoRun
}
async function init() {
  await loadSettings()
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  tabId = tab?.id
  $('#url').textContent = tab?.url || ''
  $('#status').textContent = '대기 중'
  $('#res').classList.remove('on')
  const bad = !tab?.url || !/^https?:/i.test(tab.url)
  if (bad) { $('#run').disabled = true; $('#url').textContent = '이 페이지는 검사할 수 없습니다. (http/https 페이지에서 사용하세요)'; $('#status').textContent = '검사 불가' }
  // 같은 탭의 최근 결과 복원
  const saved = (await chrome.storage.session?.get('last_' + tabId))?.['last_' + tabId]
  if (saved && saved.url === tab?.url) render(saved)
  const m = (await chrome.storage.local.get('mode')).mode
  if (m) document.querySelector(`input[name=mode][value=${m}]`).checked = true
}

async function run() {
  const mode = document.querySelector('input[name=mode]:checked').value
  chrome.storage.local.set({ mode })
  $('#run').disabled = true; $('#run').textContent = '검사 중… (몇 초)'; $('#status').textContent = '검사 중'; $('#err').classList.remove('on')
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: (m) => { window.__guardiansMode = m }, args: [mode] })
    await chrome.scripting.executeScript({ target: { tabId }, files: ['suggest.js', 'axe.min.js'] })
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, files: ['runner.js'] })
    if (!result?.ok) throw new Error(result?.error || '검사 실패')
    // 규칙 라벨을 요소에 표시할 수 있도록 rule 속성 부착
    await chrome.scripting.executeScript({ target: { tabId }, func: (vs) => {
      vs.forEach(v => v.nodes.forEach(n => { try { const el = document.querySelector(n.target); if (el) el.setAttribute('data-guardians-rule', v.id) } catch (_) {} }))
    }, args: [result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target })) }))] })
    // KRDS · 웹표준 (브라우저 안에서 실행)
    try { const std = await guardiansStd(); if (std) await chrome.scripting.executeScript({ target: { tabId }, func: (s) => { window.__guardiansStd = s }, args: [std] })
      const [{ result: k }] = await chrome.scripting.executeScript({ target: { tabId }, files: ['krds_ext.js'] }); result.krds = k } catch (e) { result.krds = { error: e.message } }
    try { const [{ result: s }] = await chrome.scripting.executeScript({ target: { tabId }, files: ['std_ext.js'] }); result.std = s } catch (e) { result.std = { error: e.message } }
    last = result
    chrome.storage.session?.set({ ['last_' + tabId]: result })
    render(result)
  } catch (e) {
    $('#err').textContent = '검사하지 못했습니다: ' + e.message + ' (브라우저 내부 페이지·PDF·일부 보안 사이트는 검사할 수 없습니다)'
    $('#err').classList.add('on')
  } finally { $('#run').disabled = false; $('#run').textContent = '다시 검사' }
}

function render(r) {
  last = r
  const s = r.summary, v = s.violations
  $('#res').classList.add('on')
  $('#status').textContent = v === 0 ? '위반 없음' : `위반 ${v}건`
  $('#score').innerHTML = `${s.score ?? '—'}<small>점</small>`
  $('#verdict').innerHTML = v === 0 ? `<span class="good">위반이 없습니다.</span>` : `<span class="bad">${v}건</span>의 접근성 위반`
  $('#meta').textContent = `${r.title || ''}\n${r.mode === 'simple' ? '핵심 15규칙' : '전체 규칙 · WCAG 2.1 AA'} · axe ${r.axe} · ${new Date(r.at).toLocaleTimeString('ko-KR')}`
  $('#stats').innerHTML = `<div class="g"><b>${s.passes}</b><span>통과</span></div><div class="${v ? 'b' : ''}"><b>${v}</b><span>위반</span></div>
    <div><b>${s.impact.critical + s.impact.serious}</b><span>치명·심각</span></div><div><b>${s.impact.moderate + s.impact.minor}</b><span>보통·경미</span></div>`
  $('#list').innerHTML = r.violations.length ? r.violations.map(x => {
    const ko = KO[x.id], kw = KW[x.id]
    return `<div class="v vclick" data-i="${r.violations.indexOf(x)}" title="누르면 페이지에서 이 요소로 이동"><div class="lv ${x.impact}">${LV[x.impact] || x.impact}</div><div>
      <div class="t">${kw ? `<span class="kw">KWCAG ${esc(kw.no)}</span>` : `<span class="kw">모범 사례</span>`}${esc(ko ? ko[0] : x.help)}</div>
      <div class="d">${esc(ko ? ko[1] : x.description)} · 요소 ${x.nodes.length}개 · <code>${esc(x.id)}</code>${x.nodes[0]?.suggest ? ' · <b style="color:var(--good)">맞춤 제안 있음</b>' : ''}</div>${(typeof FIX_DATA!=='undefined' && FIX_DATA[x.id]) ? `<div class="d" style="color:var(--ink);margin-top:4px"><b>어떻게:</b> ${esc(FIX_DATA[x.id].how)}</div>` : ''}</div></div>`
  }).join('') : `<div class="empty">자동 검사 기준의 위반이 없습니다.</div>`
  document.querySelectorAll('.vclick').forEach(el => el.onclick = () => gotoNode(+el.dataset.i))
  renderExtra(r)
}
const KOST = { pass:'준수', partial:'부분', fail:'미준수', na:'판단불가' }
const kcard = it => `<div class="k"><div class="st ${it.status}">${KOST[it.status]||it.status}</div><div><div class="n">${esc(it.name)}</div><div class="d">${esc(it.detail||'')}</div>${it.evidence?`<div class="e">${esc(it.evidence)}</div>`:''}</div></div>`
function renderExtra(r) {
  const k = r.krds, s = r.std
  $('#tA').innerHTML = r.summary.violations ? `<span class="bad">${r.summary.violations}</span>` : ''
  if (k && k.deep) {
    const t = k.tokens || { items: [] }; const kf = k.deep.failed + k.deep.partial, tf = (t.failed||0) + (t.partial||0)
    $('#tK').innerHTML = (kf + tf) ? `<span class="bad">${kf + tf}</span>` : ''
    const items = [...k.deep.items].sort((a, b) => ({fail:0,partial:1,pass:2,na:3})[a.status] - ({fail:0,partial:1,pass:2,na:3})[b.status])
    const titems = [...(t.items||[])].sort((a, b) => ({fail:0,partial:1,pass:2,na:3})[a.status] - ({fail:0,partial:1,pass:2,na:3})[b.status])
    $('#krdsOut').innerHTML = `<div class="summ"><div><b>${k.deep.score ?? '—'}%</b><span>구조 규칙 ${k.deep.items.length}</span></div><div><b>${t.score ?? '—'}%</b><span>디자인 토큰 ${t.items ? t.items.length : 0}</span></div><div><b>${kf + tf}</b><span>미준수·부분</span></div></div>
      <div class="sec">구조 규칙 (정밀 판정)</div>${items.map(kcard).join('')}
      <div class="sec">디자인 토큰 <span>공식 토큰 CSS 기준</span></div>${titems.map(kcard).join('')}
      <div class="note">서버 정밀 검사와 같은 엔진입니다. 전체 28규칙·결과서는 정밀 검사에서.</div>`
  } else $('#krdsOut').innerHTML = `<div class="empty">KRDS 검사 실패: ${esc(k && k.error || '')}</div>`
  if (s && s.items) {
    const bad = s.failed + s.partial; $('#tS').innerHTML = bad ? `<span class="bad">${bad}</span>` : ''
    const items = [...s.items].sort((a, b) => ({fail:0,partial:1,pass:2,na:3})[a.status] - ({fail:0,partial:1,pass:2,na:3})[b.status])
    $('#stdOut').innerHTML = `<div class="summ"><div><b>${s.score ?? '—'}%</b><span>간이 점검</span></div><div><b>${s.passed}</b><span>준수</span></div><div><b>${bad}</b><span>미준수·부분</span></div></div>${items.map(kcard).join('')}<div class="note">${esc(s.note||'')}</div>`
  } else $('#stdOut').innerHTML = `<div class="empty">웹표준 점검 실패: ${esc(s && s.error || '')}</div>`
  $('#summ').innerHTML = `<div><b>${r.summary.score ?? '—'}</b><span>접근성 점수</span></div><div><b>${k && k.deep ? (k.deep.score ?? '—') + '%' : '—'}</b><span>KRDS 구조</span></div><div><b>${s && s.score != null ? s.score + '%' : '—'}</b><span>웹표준 간이</span></div>`
}
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b)); document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.id === 'pane-' + b.dataset.p)) })

async function gotoNode(i) {
  const x = last?.violations?.[i]; const n = x?.nodes?.[0]; if (!n) return
  const ko = KO[x.id]
  await chrome.scripting.executeScript({ target: { tabId }, func: (g) => { window.__guardiansGoto = g }, args: [{ sel: n.target, title: (ko ? ko[0] : x.help), after: n.suggest?.after || '', note: n.suggest?.note || '' }] })
  await chrome.scripting.executeScript({ target: { tabId }, files: ['goto.js'] })
}

async function highlight() {
  if (!tabId) return
  await chrome.scripting.executeScript({ target: { tabId }, func: (labels) => { window.__guardiansLabels = labels }, args: [Object.fromEntries(Object.entries(KO).map(([k, v]) => [k, v[0].slice(0, 18)]))] })
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, files: ['highlight.js'] })
  $('#hl').textContent = result?.on ? `표시 끄기 (${result.count}곳)` : '위반 요소 표시'
}

function deep() {
  const u = last?.url || $('#url').textContent
  chrome.tabs.create({ url: `${SERVER}/?url=${encodeURIComponent(u)}&from=extension` })
}

$('#run').addEventListener('click', run)
$('#hl').addEventListener('click', highlight)
$('#deep').addEventListener('click', e => { e.preventDefault(); deep() })
init()


/* ── 사이드 패널 전용: 설정 · 탭 추적 · 자동 검사 ── */
$('#gear').onclick = () => $('#settings').classList.toggle('on')
$('#srvSave').onclick = async () => { const v = $('#srv').value.trim().replace(/\/$/, ''); if (!/^https?:\/\//.test(v)) return; SERVER = v; await chrome.storage.local.set({ server: v }); $('#settings').classList.remove('on'); if (last) render(last) }
$('#srvLocal').onclick = async () => { SERVER = 'http://localhost:3000'; $('#srv').value = SERVER; await chrome.storage.local.set({ server: SERVER }); $('#settings').classList.remove('on'); if (last) render(last) }
$('#autoRun').onchange = () => chrome.storage.local.set({ autoRun: $('#autoRun').checked })
let debounce = null
const refresh = () => { clearTimeout(debounce); debounce = setTimeout(async () => { await init(); if ($('#autoRun').checked && !$('#run').disabled) run() }, 400) }
chrome.tabs.onActivated.addListener(refresh)
chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'complete') refresh() })
chrome.windows.onFocusChanged.addListener(w => { if (w !== chrome.windows.WINDOW_ID_NONE) refresh() })

// 최신 발행 KRDS 기준 — guardians.ai.kr에서 받아 12시간 보관 (실패하면 보관본 → 없으면 내장 기준)
async function guardiansStd() {
  const K = 'krdsStd'; let c = {}; try { c = (await chrome.storage.local.get(K))[K] || {} } catch (_) {}
  if (c.data && Date.now() - (c.at || 0) < 12 * 3600e3) return c.data
  try { const r = await fetch('https://guardians.ai.kr/api/krds-standard', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); const d = j.package && j.package.data
      if (d && d.palette && Object.keys(d.palette).length >= 40) { await chrome.storage.local.set({ [K]: { data: d, at: Date.now() } }); return d } } } catch (_) {}
  return c.data || null
}
