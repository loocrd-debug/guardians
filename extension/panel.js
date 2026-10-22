const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const LV = { critical:'치명적', serious:'심각', moderate:'보통', minor:'경미' }
const evalP = (code) => new Promise((res, rej) => chrome.devtools.inspectedWindow.eval(code, (r, e) => e ? rej(new Error(e.value || e.description || 'eval 실패')) : res(r)))
async function inject(file) { const src = await (await fetch(chrome.runtime.getURL(file))).text(); await evalP(src) }
document.getElementById('run').onclick = async () => {
  const st = document.getElementById('st'), list = document.getElementById('list')
  st.textContent = '검사 중…'
  try {
    await inject('suggest.js'); await inject('axe.min.js')
    await evalP("window.__guardiansMode='expert'")
    const runner = await (await fetch(chrome.runtime.getURL('runner.js'))).text()
    // runner는 async IIFE → 결과를 window에 저장하게 감싸 실행 후 폴링
    await evalP(`(async()=>{ window.__gRes = null; window.__gRes = await (${runner.trim().replace(/;\s*$/, '')}) })()`)
    let r = null; for (let i = 0; i < 60 && !r; i++) { await new Promise(x => setTimeout(x, 250)); r = await evalP('window.__gRes') }
    if (!r || !r.ok) throw new Error(r?.error || '결과 없음')
    st.textContent = `${r.violations.length}건 위반 · ${r.summary.passes} 통과 · axe ${r.axe}`
    list.innerHTML = r.violations.length ? r.violations.map((v, i) => {
      const ko = (typeof KO_DATA !== 'undefined' && KO_DATA[v.id]), kw = (typeof KWCAG_DATA !== 'undefined' && KWCAG_DATA[v.id]); const n = v.nodes[0] || {}
      return `<div class="v"><div class="lv ${v.impact}">${LV[v.impact]||v.impact}</div><div>
        <div class="t">${kw ? 'KWCAG '+esc(kw.no)+' · ' : ''}${esc(ko ? ko[0] : v.help)}</div>
        <div class="d">${esc(ko ? ko[1] : v.description)} · 요소 ${v.nodes.length}개 · ${esc(v.id)}</div>
        <div class="sel">${esc(n.target||'')}</div>
        ${n.suggest?.after ? `<pre>${esc(n.suggest.after)}</pre>` : ''}</div>
        <button class="ins" data-sel="${esc(n.target||'')}">요소 검사</button></div>`
    }).join('') : `<div class="empty">자동 검사 기준의 위반이 없습니다.</div>`
    list.querySelectorAll('.ins').forEach(b => b.onclick = () => evalP(`inspect(document.querySelector(${JSON.stringify(b.dataset.sel)}))`).catch(e => st.textContent = '요소 검사 실패: ' + e.message))
  } catch (e) { st.textContent = '검사 실패: ' + e.message; list.innerHTML = '' }
}
