/* 가디언즈 AI 비서 v2 — "가디언즈~" 하고 부르면 바로 듣고, 검사하고, 결과서까지 (손 안 대는 모드)
   · 오른쪽 아래 검은 버튼으로 '부르기 모드'를 한 번 켜 두면(마이크 1회 허용) 계속 "가디언즈"를 기다림 — 상태는 브라우저에 기억
   · 부르면 화면 아래에 비서가 나타나 자막과 음성으로 대답 → 검사 → "결과서도 출력해 드릴까요?" → "네" → 저장
   · 크롬·엣지 음성 인식(인터넷 필요) · 비서 음성은 Google 한국어 음성 우선 · 모든 말 자막 · ESC 닫기 · 움직임 줄이기 존중 */
(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  const $ = s => document.querySelector(s)
  const WAKE = /(가디언즈|가디언스|가디언|과디언즈|guardians?)/i
  const css = document.createElement('style'); css.textContent = `
.gv-fab{position:fixed;right:22px;bottom:22px;z-index:9000;display:none;align-items:center;gap:7px;border:0;border-radius:22px;background:#111;color:#fff;padding:9px 15px;font:inherit;font-weight:600;font-size:13px;cursor:pointer;opacity:.82}
.gv-fab:hover{opacity:1}.gv-fab.on{display:inline-flex}.gv-fab b{width:7px;height:7px;border-radius:50%;background:#666}.gv-fab.live b{background:#3ddc84;animation:gvdot 2s ease-in-out infinite}
@keyframes gvdot{50%{opacity:.35}}
.gv-fab:focus-visible{outline:3px solid #f79009;outline-offset:2px}
.gv{position:fixed;left:50%;bottom:28px;transform:translate(-50%,20px);opacity:0;pointer-events:none;z-index:9001;width:min(620px,calc(100vw - 32px));background:#0e1a1b;color:#ece5d2;border-radius:28px;padding:22px 26px;box-shadow:0 24px 60px rgba(0,0,0,.35);transition:opacity .25s,transform .25s}
.gv.on{opacity:1;transform:translate(-50%,0);pointer-events:auto}.gv-top{display:flex;align-items:center;gap:18px}
.gv-orb{flex:none;width:58px;height:58px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#9cc8ff,#256ef4 50%,#5b3fd1 80%);position:relative;transition:transform .1s}
.gv-orb::after{content:"";position:absolute;inset:-7px;border-radius:50%;border:2px solid rgba(156,200,255,.4);opacity:0}
.gv[data-s=think] .gv-orb{animation:gvspin 1.4s linear infinite;background:conic-gradient(#256ef4,#5b3fd1,#9cc8ff,#256ef4)}
.gv[data-s=speak] .gv-orb::after{animation:gvwave 1.1s ease-out infinite;opacity:1}
.gv[data-s=run] .gv-orb{background:radial-gradient(circle at 35% 35%,#ffd38a,#f79009 55%,#c7742d);animation:gvpulse 1.4s ease-in-out infinite}
@keyframes gvspin{to{transform:rotate(360deg)}}@keyframes gvwave{from{transform:scale(1);opacity:.8}to{transform:scale(1.4);opacity:0}}@keyframes gvpulse{50%{transform:scale(1.08)}}
.gv-say{font-size:19px;line-height:1.5;color:#fff;font-weight:500}.gv-heard{font-size:14px;color:#9aa39a;margin-top:6px}.gv-heard:empty{display:none}
.gv-meter{display:none;align-items:center;gap:4px;height:30px;margin-top:14px}.gv[data-s=listen] .gv-meter{display:flex}.gv-meter i{flex:1;background:#7fb8ff;border-radius:3px;height:4px}
.gv-bar{height:5px;background:#26332f;border-radius:6px;margin-top:16px;overflow:hidden;display:none}.gv[data-s=run] .gv-bar{display:block}.gv-bar i{display:block;height:100%;width:30%;background:#f79009;border-radius:6px;animation:gvbar 1.5s ease-in-out infinite}
@keyframes gvbar{0%{margin-left:-30%}100%{margin-left:100%}}
@media (prefers-reduced-motion:reduce){.gv,.gv-orb,.gv-orb::after,.gv-bar i,.gv-fab b{animation:none!important;transition:none!important}}`
  document.head.appendChild(css)
  const fab = document.createElement('button'); fab.type = 'button'; fab.className = 'gv-fab'; fab.setAttribute('aria-pressed', 'false')
  const box = document.createElement('div'); box.className = 'gv'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); box.dataset.s = 'idle'
  box.innerHTML = `<div class="gv-top"><div class="gv-orb" aria-hidden="true"></div><div style="flex:1;min-width:0"><div class="gv-say" id="gvSay"></div><div class="gv-heard" id="gvHeard"></div></div></div><div class="gv-meter" aria-hidden="true">${'<i></i>'.repeat(28)}</div><div class="gv-bar" aria-hidden="true"><i></i></div>`
  document.body.appendChild(fab); document.body.appendChild(box)
  const K = 'g-assist-live'; let live = false, active = false, mode = 'cmd', speaking = false, rec = null, stream = null, ac = null, raf = 0, idleT = 0
  const setS = s => { box.dataset.s = s }
  const label = () => { fab.innerHTML = `<b aria-hidden="true"></b>${live ? '“가디언즈”라고 불러 주세요' : 'AI 비서'}`; fab.classList.toggle('live', live); fab.setAttribute('aria-pressed', String(live)); fab.title = live ? '누르면 부르기 모드를 끕니다' : '누르면 "가디언즈"라고 부를 때 바로 듣는 모드를 켭니다' }
  // ── 비서 음성 (Google 한국어 → Windows 한국어 순)
  const voice = () => { const v = (speechSynthesis.getVoices() || []).filter(v => /ko(-|_)KR/i.test(v.lang)); return v.find(x => /google/i.test(x.name)) || v[0] }
  function say(t, then) { $('#gvSay').textContent = t; setS('speak'); speaking = true; lastSaid = t; saidAt = Date.now(); buf = ''; clearTimeout(bufT); try { rec && rec.abort() } catch (_) {}
    try { speechSynthesis.cancel() } catch (_) {}
    const u = new SpeechSynthesisUtterance(t.replace(/PPTX/g, '피피티').replace(/KRDS/g, '케이알디에스')); u.lang = 'ko-KR'; const v = voice(); if (v) u.voice = v; u.rate = 1.07
    let done = false; const fin = () => { if (done) return; done = true; setTimeout(() => { speaking = false; saidAt = Date.now(); if (box.dataset.s === 'speak') setS(active ? 'listen' : 'idle'); if (then) { then() } startRec() }, 800) }
    u.onend = fin; u.onerror = fin; setTimeout(fin, Math.max(3500, t.length * 180)); speechSynthesis.speak(u) }
  // ── 마이크 게이지 (부르기 모드에서 이미 허용된 마이크 · PC 안에서만 계산)
  async function meterOn() { if (stream) return; try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); ac = new (window.AudioContext || window.webkitAudioContext)(); const an = ac.createAnalyser(); an.fftSize = 512; ac.createMediaStreamSource(stream).connect(an)
      const bars = [...box.querySelectorAll('.gv-meter i')], d = new Uint8Array(an.frequencyBinCount), orb = box.querySelector('.gv-orb')
      const loop = () => { an.getByteFrequencyData(d); let sum = 0; bars.forEach((b, i) => { const v = d[2 + i * 3] / 255; sum += v; b.style.height = Math.max(4, v * 30) + 'px' }); if (box.dataset.s === 'listen') orb.style.transform = `scale(${1 + Math.min(.22, sum / bars.length * .5)})`; raf = requestAnimationFrame(loop) }; loop() } catch (_) {} }
  function meterOff() { cancelAnimationFrame(raf); box.querySelector('.gv-orb').style.transform = ''; try { stream && stream.getTracks().forEach(t => t.stop()) } catch (_) {} try { ac && ac.close() } catch (_) {} stream = ac = null }
  // ── 계속 듣기 (부르기 모드)
  let buf = '', bufT = 0, lastSaid = '', saidAt = 0, askAgain = 0
  const norm = x => String(x || '').replace(/[^가-힣a-z0-9]/gi, '')
  const isEcho = t => { const a = norm(t), b = norm(lastSaid); if (!a || !b) return false; if (Date.now() - saidAt > 15000) return false
    let hit = 0; for (let i = 0; i + 2 <= a.length; i++) if (b.includes(a.slice(i, i + 2))) hit++; return hit / Math.max(1, a.length - 1) > .6 }   // 비서가 방금 한 말과 60% 이상 겹치면 되울림
  function flush() { const t = buf.trim(); buf = ''; if (!t || isEcho(t)) return
    if (box.dataset.s === 'run' || box.dataset.s === 'think') return   // 검사 · 해석 중에는 듣지 않음
    if (!active) { if (!WAKE.test(t)) return; wake(); const rest = t.split(WAKE).pop().replace(/^[\s,.~!?]+/, '').trim(); $('#gvHeard').textContent = '“' + t + '”'; if (rest.length > 3) handle(rest); else say('네, 말씀하세요.'); return }
    $('#gvHeard').textContent = '“' + t + '”'; handle(t.replace(WAKE, '').replace(/^[\s,.~!?]+/, '').trim() || t) }
  function startRec() { if (!live || speaking || !SR) return; try { rec && rec.abort() } catch (_) {}
    rec = new SR(); rec.lang = 'ko-KR'; rec.continuous = true; rec.interimResults = true
    rec.onresult = ev => { let interim = ''; for (let i = ev.resultIndex; i < ev.results.length; i++) { const r = ev.results[i]; if (r.isFinal) buf += ' ' + r[0].transcript; else interim += r[0].transcript }
      const now = (buf + ' ' + interim).trim(); if (!now || isEcho(now)) return
      if (!active && WAKE.test(now)) wake(); if (active) { $('#gvHeard').textContent = '“' + now + '”'; bumpIdle() }
      clearTimeout(bufT); bufT = setTimeout(flush, interim ? 1600 : 1100) }   // 말이 끝나고 잠깐 조용해지면 한 문장으로 처리
    rec.onerror = ev => { if (ev.error === 'not-allowed') { live = false; localStorage.removeItem(K); label() } }
    rec.onend = () => { if (live && !speaking) setTimeout(startRec, 250) }
    try { rec.start(); if (active && box.dataset.s !== 'run') setS('listen') } catch (_) {} }
  function wake() { if (active) return; active = true; box.classList.add('on'); setS('listen'); meterOn(); bumpIdle() }
  function bumpIdle() { clearTimeout(idleT); idleT = setTimeout(() => { if (active && box.dataset.s === 'listen') close() }, 25000) }
  function close() { active = false; mode = 'cmd'; box.classList.remove('on'); setS('idle'); meterOff(); $('#gvHeard').textContent = ''; clearTimeout(idleT); try { speechSynthesis.cancel() } catch (_) {} speaking = false; startRec() }
  // ── 대화
  const yes = t => /(응|어|네|예|그래|좋아|부탁|해\s*줘|해\s*주세요|출력|만들어|저장|오케이|ok|yes|피피티|ppt|엑셀|excel|html|둘\s*다|전부|모두)/i.test(t)
  const no = t => /^(아니|아뇨|됐어|괜찮아|필요\s*없|그만|no)/i.test(t.trim())
  async function handle(t) { if (!t) return; bumpIdle()
    if (mode === 'report') {
      if (no(t)) { mode = 'cmd'; return say('알겠습니다. 결과는 화면에서 바로 보실 수 있습니다.', () => setTimeout(close, 1500)) }
      if (yes(t)) { mode = 'cmd'; const want = []; if (/엑셀|excel/i.test(t)) want.push(['#dlXlsx', '엑셀']); if (/html/i.test(t)) want.push(['#dlHtml', 'HTML']); if (/피피티|ppt|파워/i.test(t) || !want.length || /둘\s*다|전부|모두/.test(t)) want.unshift(['#dlPptx', '피피티'])
        return say(`네, ${want.map(w => w[1]).join('와 ')} 결과서를 출력하겠습니다.`, async () => { setS('run'); $('#gvHeard').textContent = '결과서를 만드는 중…'; for (const [sel] of want) { const b = $(sel); if (b) { b.click(); await new Promise(r => setTimeout(r, 3000)) } }
          $('#gvHeard').textContent = ''; say('결과서를 저장했습니다. 감사합니다.', () => setTimeout(close, 2500)) }) }
      return say('결과서를 출력해 드릴까요? 네 또는 아니요로 말씀해 주세요.') }
    if (no(t)) return say('네, 필요하시면 언제든 불러 주세요.', () => setTimeout(close, 1500))
    setS('think'); $('#gvSay').textContent = '네, 알겠습니다…'
    let r; try { r = await (await fetch('/api/ai/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t }) })).json() } catch (e) { r = { ok: false, error: e.message } }
    if (!r.ok) return say(r.error && /체험/.test(r.error) ? r.error : '죄송합니다. 잠시 후 다시 말씀해 주세요.')
    if (!r.url) { askAgain++; if (askAgain > 2) { askAgain = 0; return say('사이트 이름을 알아듣지 못했습니다. 화면의 주소 칸에 입력해 주세요.', () => setTimeout(close, 2500)) } return say(`“${t}”에서 사이트 이름을 찾지 못했습니다. 예를 들어 국민신문고 접근성 검사해 줘, 처럼 말씀해 주세요.`) }
    askAgain = 0
    const host = r.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''); const nm = (r.reply || '').match(/^([^(（\s]+)\s*\(/); const site = nm ? nm[1] : host
    say(`네, 알겠습니다. ${site} 검사를 시작합니다.`, () => { setS('run'); $('#gvHeard').textContent = '검사 중… 보통 30초 정도 걸립니다'; watch() })
    try { window.runCommand && window.runCommand(t, r) } catch (_) {} }
  function watch() { const t0 = Date.now(); const iv = setInterval(() => { const now = $('#run-now'); if (now && box.dataset.s === 'run') $('#gvHeard').textContent = now.textContent; bumpIdle()
      const p3 = $('#p3'); if (p3 && p3.classList.contains('on')) { clearInterval(iv); const cnt = parseInt(($('#score') || {}).textContent) || 0; $('#gvHeard').textContent = (($('#h3a') || {}).textContent || '').split('—')[0]
        mode = 'report'; say(cnt ? `검사가 끝났습니다. 고쳐야 할 문제가 ${cnt}건 있습니다. 결과서도 출력해 드릴까요?` : '검사가 끝났습니다. 자동 검사로 찾은 문제가 없습니다. 결과서도 출력해 드릴까요?') }
      else if (Date.now() - t0 > 240000) { clearInterval(iv); say('검사가 오래 걸리고 있습니다. 화면에서 진행 상황을 확인해 주세요.') } }, 1000) }
  // ── 부르기 모드 켜기 · 끄기 (버튼 한 번 — 마이크는 처음 한 번만 허용)
  async function toggle() { if (!SR) { alert('이 브라우저는 음성 인식을 지원하지 않습니다. 크롬이나 엣지를 사용해 주세요.'); return }
    if (live) { live = false; localStorage.removeItem(K); try { rec && rec.abort() } catch (_) {} close(); label(); return }
    try { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); st.getTracks().forEach(t => t.stop()) } catch (e) { alert(e && e.name === 'NotFoundError' ? '이 PC에서 마이크를 찾지 못했습니다.\n헤드셋 · USB 마이크를 연결하고, Windows 설정 › 개인 정보 › 마이크에서 데스크톱 앱 · 브라우저의 마이크 사용을 켠 뒤 다시 눌러 주세요.' : '마이크 사용이 막혀 있습니다.\n주소창 왼쪽 자물쇠 → 마이크 → 허용(이 사이트 방문 시 항상)으로 바꾼 뒤 다시 눌러 주세요.'); return }
    live = true; localStorage.setItem(K, '1'); label(); startRec() }
  fab.onclick = toggle
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && active) close(); if (e.altKey && /^[vVㅍ]$/.test(e.key)) { e.preventDefault(); toggle() } })
  // AI가 켜졌거나 체험 모드일 때만 버튼 · 부르기 모드는 다시 열어도 유지(마이크가 이미 허용된 경우)
  const check = async () => { try { const a = await (await fetch('/api/ai/status')).json(); fab.classList.toggle('on', !!a.enabled || !!(a.demo && a.demo.on)) } catch (_) {} }
  label(); check(); setInterval(check, 60000); try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => {} } catch (_) {}
  if (localStorage.getItem(K) && SR && navigator.permissions) navigator.permissions.query({ name: 'microphone' }).then(p => { if (p.state === 'granted') { live = true; label(); startRec() } else localStorage.removeItem(K) }).catch(() => {})
})()
