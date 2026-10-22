// nav.js — 좁은 화면에서 메뉴를 햄버거로
(function(){
  const top = document.querySelector('.g-top-in, .top-in'); const nav = document.querySelector('.g-gnb, .gnb'); if (!top || !nav) return
  nav.classList.add('g-gnb')
  // ── 로고 옆 공통 배지: 망 상태 · AI ──
  const brand = top.querySelector('.g-brand, .brand')
  if (brand && !top.querySelector('.g-badges')) {
    const b = document.createElement('span'); b.className = 'g-badges'
    b.innerHTML = '<span class="g-net" id="gNet" title="검사 서버의 인터넷 연결 상태"><i></i><em>확인 중</em></span><a class="g-ai" id="gAi" href="/#ai" title="AI 보조 설정 (개인 Claude API 키)"><i></i>AI</a>'
    brand.insertAdjacentElement('afterend', b)
    const refreshNet = () => fetch('/api/netstatus').then(r => r.json()).then(n => { const el = document.getElementById('gNet'); if (!el) return; el.classList.toggle('off', !n.online); el.querySelector('em').textContent = n.online ? '인터넷 연결' : '폐쇄망 모드'; el.title = n.online ? '검사 서버가 인터넷에 연결돼 있습니다 — 온라인 오탈자·W3C 검증 사용' : '폐쇄망(행정망) 모드 — 내장 오탈자·HTML 검증기로 동작' }).catch(() => {})
    const refreshAi = () => fetch('/api/ai/status').then(r => r.json()).then(a => { const el = document.getElementById('gAi'); if (!el) return; el.classList.toggle('on', !!a.enabled); el.classList.toggle('hidden', a.offline === true); el.title = a.enabled ? 'AI 보조 사용 중 — 눌러서 설정' : (a.reason || 'AI 보조 꺼짐 — 눌러서 키 입력') }).catch(() => {})
    // KRDS 기준 변경 알림 — 실제 변경 보고서가 "검토 대기"이고 영향이 있을 때만 AI 옆에 깜빡이는 표시등
    b.insertAdjacentHTML('beforeend', '<a class="g-kw" id="gKw" href="/krds-watch.html" hidden><i aria-hidden="true"></i><em></em></a>')
    const refreshKw = () => fetch('/api/krds-watch').then(r => r.ok ? r.json() : null).then(d => { const el = document.getElementById('gKw'); if (!el || !d) return
      const p = (d.reports || []).filter(r => r.status === '검토 대기' && r.impact !== 'none'); el.hidden = !p.length; if (!p.length) return
      el.querySelector('em').textContent = 'KRDS 변경 ' + p.length + '건'; el.href = '/krds-watch.html#' + p[0].id
      el.title = el.ariaLabel = 'KRDS 공식 사이트에서 기준 변경이 감지되었습니다 — AI 해석 보고서 ' + p.length + '건 확인 필요' }).catch(() => {})
    refreshNet(); refreshAi(); refreshKw(); setInterval(refreshNet, 60000); setInterval(refreshKw, 300000); window.__aiStatusHook = refreshAi
    document.getElementById('gAi').addEventListener('click', e => { if (window.__openAi) { e.preventDefault(); window.__openAi() } })
  }
  const b = document.createElement('button'); b.className = 'g-burger'; b.setAttribute('aria-label', '메뉴 열기'); b.setAttribute('aria-expanded', 'false'); b.innerHTML = '<span></span>'
  top.appendChild(b)
  b.addEventListener('click', () => { const o = nav.classList.toggle('open'); b.setAttribute('aria-expanded', String(o)); b.setAttribute('aria-label', o ? '메뉴 닫기' : '메뉴 열기') })
  document.addEventListener('click', e => { if (!top.contains(e.target)) { nav.classList.remove('open'); b.setAttribute('aria-expanded', 'false') } })
  window.addEventListener('resize', () => { if (innerWidth > 900) nav.classList.remove('open') })
  // 더보기 드롭다운
  const more = nav.querySelector('.g-more'); const mb = more && more.querySelector('.g-more-btn')
  if (mb) { mb.addEventListener('click', e => { e.stopPropagation(); const o = more.classList.toggle('open'); mb.setAttribute('aria-expanded', String(o)) })
    document.addEventListener('click', e => { if (!more.contains(e.target)) { more.classList.remove('open'); mb.setAttribute('aria-expanded', 'false') } })
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { more.classList.remove('open'); mb.setAttribute('aria-expanded', 'false') } }) }

  // ── 광고(공개 운영판 전용, /api/ads 가 on 일 때만) — 클릭 유도 문구 · 버튼 근처 배치 금지 원칙
  fetch('/api/ads').then(r => r.json()).then(a => { if (!a || !a.on) return
    const s = document.createElement('script'); s.async = true; s.crossOrigin = 'anonymous'; s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(a.client); document.head.appendChild(s)
    const css = document.createElement('style'); css.textContent = '.g-ad{max-width:1180px;margin:40px auto 0;padding:0 40px}.g-ad-l{font-size:11px;color:var(--muted);margin-bottom:6px;letter-spacing:.04em}.g-ad-box{min-height:100px;border-top:1px solid var(--line);padding-top:10px}.g-ad-side{position:fixed;right:16px;top:120px;width:160px;z-index:1}@media (max-width:1560px){.g-ad-side{display:none}}'; document.head.appendChild(css)
    const unit = (slot, style) => `<ins class="adsbygoogle" style="${style}" data-ad-client="${a.client}" data-ad-slot="${slot}"${style.includes('block') ? ' data-ad-format="auto" data-full-width-responsive="true"' : ''}></ins>`
    const foot = document.querySelector('.g-foot')
    if (a.slotFooter && foot) { const w = document.createElement('aside'); w.className = 'g-ad'; w.setAttribute('aria-label', '광고'); w.innerHTML = '<div class="g-ad-l">광고</div><div class="g-ad-box">' + unit(a.slotFooter, 'display:block') + '</div>'; foot.parentNode.insertBefore(w, foot); (window.adsbygoogle = window.adsbygoogle || []).push({}) }
    if (a.slotSide && innerWidth > 1560) { const w = document.createElement('aside'); w.className = 'g-ad-side'; w.setAttribute('aria-label', '광고'); w.innerHTML = '<div class="g-ad-l">광고</div>' + unit(a.slotSide, 'display:inline-block;width:160px;height:600px'); document.body.appendChild(w); (window.adsbygoogle = window.adsbygoogle || []).push({}) }
    if (foot && !foot.querySelector('a[href="/privacy.html"]')) { const fl = foot.querySelector('.fls'); if (fl) fl.insertAdjacentHTML('afterbegin', '<a href="/privacy.html" class="fl">개인정보처리방침</a><span class="sep">|</span>') }
  }).catch(() => {})

  // ── 응원하기(공개 운영판 전용, /api/support 가 on 일 때만) — 결과서를 받은 뒤 하루 1번 · '다음에요' 누르면 7일간 안 띄움
  fetch('/api/support').then(r => r.json()).then(S => { if (!S || !S.on) return
    const K = 'g-support', now = Date.now(), st = (() => { try { return JSON.parse(localStorage.getItem(K) || '{}') } catch (_) { return {} } })()
    const save = o => { try { localStorage.setItem(K, JSON.stringify(Object.assign(st, o))) } catch (_) {} }
    const css = document.createElement('style'); css.textContent = `
.gs-back{position:fixed;inset:0;background:rgba(15,20,19,.45);display:none;align-items:center;justify-content:center;z-index:9999;padding:20px}
.gs-back.on{display:flex}.gs{background:#fff;color:var(--ink);border-radius:20px;max-width:520px;width:100%;max-height:92vh;overflow:auto;padding:28px 28px 22px;box-shadow:0 24px 60px rgba(0,0,0,.18)}
.gs h2{font-size:21px;margin:0 0 16px;display:flex;justify-content:space-between;align-items:center;gap:12px}
.gs-x{border:0;background:var(--soft);width:36px;height:36px;border-radius:50%;font-size:18px;cursor:pointer;color:var(--ink)}
.gs dl{margin:0;border-top:1px solid var(--line)}.gs dt{font-weight:700;font-size:15px;margin-top:14px}.gs dd{margin:4px 0 14px;font-size:14px;color:var(--muted);line-height:1.6;padding-bottom:14px;border-bottom:1px solid var(--line)}
.gs-meter{background:var(--soft);border-radius:14px;padding:14px 16px;margin:16px 0}.gs-meter p{margin:0;font-size:13px;color:var(--muted);display:flex;justify-content:space-between}
.gs-bar{height:8px;background:#e6e6e6;border-radius:8px;margin:10px 0;overflow:hidden}.gs-bar i{display:block;height:100%;background:#2e9e5b;border-radius:8px}
.gs-qr{text-align:center;margin:8px 0 4px}.gs-qr img{width:150px;height:150px}.gs-qr p{font-size:12px;color:var(--muted);margin:6px 0 0}
.gs-pay{display:block;text-align:center;background:#fee500;color:#191919;font-weight:700;border-radius:12px;padding:15px;margin-top:14px;text-decoration:none;font-size:16px}
.gs-no{display:block;width:100%;border:0;background:var(--soft);border-radius:12px;padding:14px;margin-top:8px;font:inherit;font-weight:600;cursor:pointer;color:var(--ink)}
.gs a:focus-visible,.gs button:focus-visible{outline:3px solid #256ef4;outline-offset:2px}`; document.head.appendChild(css)
    const pct = S.pct == null ? '' : `<div class="gs-meter"><p><span>${S.month ? S.month + ' ' : '이번 달 '}서버 운영비 <b style="color:var(--ink)">${S.pct}%</b></span><span>오늘 ${S.today.toLocaleString()}번 검사했어요</span></p><div class="gs-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${S.pct}" aria-label="서버 운영비 모금률"><i style="width:${S.pct}%"></i></div><p><span>목표 ${S.goal.toLocaleString()}원</span><span>${S.raised.toLocaleString()}원</span></p></div>`
    const back = document.createElement('div'); back.className = 'gs-back'
    back.innerHTML = `<div class="gs" role="dialog" aria-modal="true" aria-labelledby="gsT" aria-describedby="gsD">
<h2 id="gsT">가디언즈를 응원해 주세요<button type="button" class="gs-x" aria-label="닫기">✕</button></h2>
<dl id="gsD"><dt>검사할 때마다 실제 브라우저를 띄워요</dt><dd>저장해 둔 결과를 보여 주는 게 아니라, 주소를 넣을 때마다 서버에서 실제 브라우저로 페이지를 열어 접근성 · 링크 · KRDS를 확인해요.</dd>
<dt>그래서 검사할 때마다 서버비가 들어요</dt><dd>쓰는 분이 많아질수록 서버비도 늘어나요. 지금은 운영자가 직접 부담하고 있어요.</dd>
<dt>커피 한 모금 값도 큰 힘이 돼요</dt><dd>보내 주신 응원은 서버 운영비에만 써요. 응원하지 않아도 모든 기능은 그대로 무료예요.</dd></dl>
${pct}${S.qr ? '<div class="gs-qr"><img src="/api/support/qr" alt="카카오페이 송금 QR 코드"><p>휴대폰 카메라로 QR을 비추면 바로 보낼 수 있어요</p></div>' : ''}
<a class="gs-pay" href="${S.url}" target="_blank" rel="noopener">카카오페이로 응원하기<span class="sr-only" style="position:absolute;left:-9999px"> (새 창)</span></a>
<button type="button" class="gs-no">괜찮아요, 다음에요</button>${S.owner ? `<p style="font-size:12px;color:var(--muted);text-align:center;margin:12px 0 0">받는 곳: ${S.owner}</p>` : ''}</div>`
    document.body.appendChild(back)
    let lastFocus = null
    const close = (snooze) => { back.classList.remove('on'); if (snooze) save({ until: Date.now() + 7 * 864e5 }); lastFocus && lastFocus.focus && lastFocus.focus() }
    const open = () => { if (back.classList.contains('on')) return; lastFocus = document.activeElement; back.classList.add('on'); save({ shown: kday() }); back.querySelector('.gs-pay').focus() }
    const kday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
    back.querySelector('.gs-x').onclick = () => close(false); back.querySelector('.gs-no').onclick = () => close(true)
    back.querySelector('.gs-pay').addEventListener('click', () => save({ until: Date.now() + 30 * 864e5 }))
    back.addEventListener('click', e => { if (e.target === back) close(false) })
    back.addEventListener('keydown', e => { if (e.key === 'Escape') close(false)
      if (e.key === 'Tab') { const f = [...back.querySelectorAll('button, a[href]')]; const a = f[0], z = f[f.length - 1]
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus() } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus() } } })
    window.__gSupport = open
    // 결과서(PPTX · Excel · HTML · 증적)를 받은 직후에만 — 하루 1번, '다음에요' 후 7일 · 응원 후 30일은 안 띄움
    const RX = /\/api\/(report\/|compat-pptx|krds-pptx|minwon.*(excel|pptx|zip)|batch.*(excel|pptx))/
    const of = window.fetch; window.fetch = async function (u, o) { const r = await of.apply(this, arguments)
      try { const url = typeof u === 'string' ? u : (u && u.url) || ''
        if (RX.test(url) && r.ok && !(st.until > Date.now()) && st.shown !== kday()) setTimeout(open, 1500) } catch (_) {}
      return r }
    const fl = document.querySelector('.g-foot .fls'); if (fl) fl.insertAdjacentHTML('afterbegin', '<a href="#" class="fl" id="gsLink">응원하기</a><span class="sep">|</span>' + (fl.querySelector('a[href="/privacy.html"]') ? '' : '<a href="/privacy.html" class="fl">개인정보처리방침</a><span class="sep">|</span>'))
    const gl = document.getElementById('gsLink'); if (gl) gl.addEventListener('click', e => { e.preventDefault(); open() })
  }).catch(() => {})
})()
