const $ = s => document.querySelector(s)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const LV = { critical: '치명적', serious: '심각', moderate: '보통', minor: '경미' }
const SERVER = 'http://localhost:3000'
const KO = (typeof KO_DATA!=='undefined')?KO_DATA:{}, KW = (typeof KWCAG_DATA!=='undefined')?KWCAG_DATA:{}
let last = null, tabId = null

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  tabId = tab?.id
  $('#url').textContent = tab?.url || ''
  const bad = !tab?.url || !/^https?:/i.test(tab.url)
  if (bad) { $('#run').disabled = true; $('#url').textContent = '이 페이지는 검사할 수 없습니다. (http/https 페이지에서 사용하세요)' }
  // 같은 탭의 최근 결과 복원
  const saved = (await chrome.storage.session?.get('last_' + tabId))?.['last_' + tabId]
  if (saved && saved.url === tab?.url) render(saved)
  const m = (await chrome.storage.local.get('mode')).mode
  if (m) document.querySelector(`input[name=mode][value=${m}]`).checked = true
}

async function run() {
  const mode = document.querySelector('input[name=mode]:checked').value
  chrome.storage.local.set({ mode })
  $('#run').disabled = true; $('#run').textContent = '검사 중… (몇 초)'; $('#err').classList.remove('on')
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: (m) => { window.__guardiansMode = m }, args: [mode] })
    await chrome.scripting.executeScript({ target: { tabId }, files: ['suggest.js', 'axe.min.js'] })
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, files: ['runner.js'] })
    if (!result?.ok) throw new Error(result?.error || '검사 실패')
    // 규칙 라벨을 요소에 표시할 수 있도록 rule 속성 부착
    await chrome.scripting.executeScript({ target: { tabId }, func: (vs) => {
      vs.forEach(v => v.nodes.forEach(n => { try { const el = document.querySelector(n.target); if (el) el.setAttribute('data-guardians-rule', v.id) } catch (_) {} }))
    }, args: [result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target })) }))] })
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
}

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
$('#deep').addEventListener('click', deep)
$('#crit').addEventListener('click', e => { e.preventDefault(); chrome.tabs.create({ url: `${SERVER}/criteria.html` }) })
init()
