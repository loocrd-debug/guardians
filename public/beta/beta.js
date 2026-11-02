// 가디언즈 베타 — 모든 화면의 링크를 /beta/ 안에서 오가게 하고, 상단에 베타 표시 · 기존 화면 버튼
(() => {
  const skip = /^\/(beta\/|api\/|downloads\/|lib\/|static\/)/
  const fix = a => { if (a.classList.contains('a5old')) return; const h = a.getAttribute('href'); if (!h || skip.test(h)) return
    if (/^\/[\w-]+\.html(#.*)?$/.test(h)) a.setAttribute('href', '/beta' + h)
    else if (h === '/' || /^\/#/.test(h)) a.setAttribute('href', '/beta/' + h.slice(1)) }
  const run = () => { document.querySelectorAll('a[href]').forEach(fix)
    const b = document.querySelector('.g-brand'); if (b && !b.dataset.a5) { b.dataset.a5 = '1'; b.insertAdjacentHTML('beforeend', '<span class="a5beta">베타</span>'); b.setAttribute('href', '/beta/') }
    const n = document.querySelector('.g-gnb'); if (n && !n.querySelector('.a5old')) { const here = location.pathname.replace(/^\/beta/, '') || '/'; n.insertAdjacentHTML('beforeend', `<a class="a5old" href="${here === '/index.html' ? '/' : here}">기존 화면</a>`) } }
  // 화면 제목의 핵심 단어 하나에 포인트 색 (제목이 바뀌면 다시)
  const KEY = [/KRDS/, /스크린 리더/, /브라우저 호환/, /사이트 전체/, /전문가/, /예약/, /보안/, /정합성/, /민원안내/, /개인정보/, /다운로드/, /기준/, /검사(?=할까요)/, /항목/, /결과/, /문제/]
  const em = () => document.querySelectorAll('main h1, .g-title h1').forEach(h => { if (h.querySelector('.a5em')) return
    const w = document.createTreeWalker(h, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode())) { for (const re of KEY) { const m = t.data.match(re); if (m) {
      const r = document.createRange(); r.setStart(t, m.index); r.setEnd(t, m.index + m[0].length); const s = document.createElement('em'); s.className = 'a5em'; r.surroundContents(s); return } } } })
  const run0 = run; const runAll = () => { run0(); em() }
  runAll(); new MutationObserver(runAll).observe(document.documentElement, { subtree: true, childList: true })
})()
