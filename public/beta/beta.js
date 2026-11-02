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
  // 크롬 확장 — 상단 메뉴에 바로가기 + 메인 화면 배너(최신 파일 바로 받기)
  const ext = () => { const n = document.querySelector('.g-gnb'); if (n && !n.querySelector('.a5ext')) { const more = n.querySelector('.g-more'); const a = document.createElement('a'); a.className = 'a5ext'; a.href = '/beta/download.html'; a.textContent = '크롬 확장'; more ? n.insertBefore(a, more) : n.appendChild(a) }
    const home = /^\/beta\/?(index\.html)?$/.test(location.pathname); const m = document.querySelector('main')
    if (home && m && !document.querySelector('.a5ext-banner')) { const b = document.createElement('section'); b.className = 'a5ext-banner'; b.setAttribute('aria-label', '크롬 확장 프로그램')
      b.innerHTML = '<span class="ic" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 3h4v3a2 2 0 1 0 4 0V5h1a2 2 0 0 1 2 2v4h-2a2 2 0 1 0 0 4h2v4a2 2 0 0 1-2 2h-4v-2a2 2 0 1 0-4 0v2H5a2 2 0 0 1-2-2v-4h2a2 2 0 1 0 0-4H3V7a2 2 0 0 1 2-2h5z"/></svg></span><div class="tx"><b>크롬 확장 프로그램</b><span>작업 중인 페이지를 브라우저 옆 패널에서 바로 검사합니다 — 개발 · 퍼블리싱 중에 창을 옮기지 않고, 결과는 이 화면과 같습니다.</span></div><div class="bt"><a class="p" id="a5extdl" href="/beta/download.html">확장 받기</a><a class="s" href="/beta/download.html">설치 방법</a></div>'
      m.appendChild(b); fetch('/api/downloads').then(r => r.json()).then(d => { const it = (d.items || []).find(x => x.key === 'ext' && x.url); if (it) { const a = document.getElementById('a5extdl'); a.href = it.url; a.textContent = '확장 받기 · v' + it.version; a.setAttribute('download', '') } }).catch(() => {}) } }
  const run0 = run; const runAll = () => { run0() }
  runAll(); new MutationObserver(runAll).observe(document.documentElement, { subtree: true, childList: true })
})()
