// 가디언즈 베타 — 모든 화면의 링크를 /beta/ 안에서 오가게 하고, 상단에 베타 표시 · 기존 화면 버튼
(() => {
  const skip = /^\/(beta\/|api\/|downloads\/|lib\/|static\/)/
  const fix = a => { if (a.classList.contains('a5old')) return; const h = a.getAttribute('href'); if (!h || skip.test(h)) return
    if (/^\/[\w-]+\.html(#.*)?$/.test(h)) a.setAttribute('href', '/beta' + h)
    else if (h === '/' || /^\/#/.test(h)) a.setAttribute('href', '/beta/' + h.slice(1)) }
  const run = () => { document.querySelectorAll('a[href]').forEach(fix)
    const b = document.querySelector('.g-brand'); if (b && !b.dataset.a5) { b.dataset.a5 = '1'; b.insertAdjacentHTML('beforeend', '<span class="a5beta">베타</span>'); b.setAttribute('href', '/beta/') }
    const n = document.querySelector('.g-gnb'); if (n && !n.querySelector('.a5old')) { const here = location.pathname.replace(/^\/beta/, '') || '/'; n.insertAdjacentHTML('beforeend', `<a class="a5old" href="${here === '/index.html' ? '/' : here}">기존 화면</a>`) } }
  run(); new MutationObserver(run).observe(document.documentElement, { subtree: true, childList: true })
})()
