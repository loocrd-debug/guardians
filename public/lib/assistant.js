/* 가디언즈 AI 비서 — 말로 주고받는 검사 (v6.21)
   듣기(크롬·엣지 음성 인식 · 인터넷 필요) → Claude가 해석(/api/ai/command) → 말하기(Windows 한국어 음성) → 검사 → 결과 안내 → 결과서 제안
   접근성: 모든 말을 자막으로 · 키보드로도 동일 · ESC 닫기 · 낭독기 알림 · 움직임 줄이기 존중 */
(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  const $ = s => document.querySelector(s)
  const css = document.createElement('style'); css.textContent = `
.gv-fab{position:fixed;right:24px;bottom:24px;z-index:9000;display:none;align-items:center;gap:8px;border:0;border-radius:28px;background:#0e1a1b;color:#fff;padding:12px 18px 12px 14px;font:inherit;font-weight:600;font-size:14.5px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.18)}
.gv-fab.on{display:inline-flex}.gv-fab i{width:26px;height:26px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#7fb8ff,#256ef4 55%,#5b3fd1);box-shadow:0 0 0 3px rgba(37,110,244,.18)}
.gv-fab:focus-visible,.gv-x:focus-visible,.gv-btn:focus-visible,.gv-in:focus-visible{outline:3px solid #f79009;outline-offset:2px}
.gv{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9001;width:min(560px,calc(100vw - 32px));background:#0e1a1b;color:#ece5d2;border-radius:24px;padding:22px 22px 16px;box-shadow:0 24px 60px rgba(0,0,0,.35);display:none}
.gv.on{display:block}.gv-top{display:flex;align-items:center;gap:16px}
.gv-orb{flex:none;width:64px;height:64px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#9cc8ff,#256ef4 50%,#5b3fd1 80%);position:relative;transition:transform .12s}
.gv-orb::after{content:"";position:absolute;inset:-6px;border-radius:50%;border:2px solid rgba(156,200,255,.35);opacity:0}
.gv[data-s=think] .gv-orb{animation:gvspin 1.6s linear infinite;background:conic-gradient(#256ef4,#5b3fd1,#9cc8ff,#256ef4)}
.gv[data-s=speak] .gv-orb::after{animation:gvwave 1.2s ease-out infinite;opacity:1}
.gv[data-s=run] .gv-orb{background:radial-gradient(circle at 35% 35%,#ffd38a,#f79009 55%,#c7742d)}
@keyframes gvspin{to{transform:rotate(360deg)}}@keyframes gvwave{from{transform:scale(1);opacity:.8}to{transform:scale(1.35);opacity:0}}
.gv-state{font-size:12.5px;letter-spacing:.06em;color:#9aa39a;margin-bottom:4px}
.gv-say{font-size:17px;line-height:1.5;color:#fff;min-height:26px}
.gv-heard{font-size:14px;color:#c9d2c9;margin-top:6px;min-height:20px}.gv-heard:empty{display:none}
.gv-meter{display:flex;align-items:center;gap:4px;height:34px;margin:14px 0 4px}.gv-meter i{flex:1;background:#7fb8ff;border-radius:3px;height:4px;transition:height .08s}
.gv[data-s=listen] .gv-meter{display:flex}.gv-meter{display:none}
.gv-bar{height:6px;background:#26332f;border-radius:6px;margin:14px 0 4px;overflow:hidden;display:none}.gv[data-s=run] .gv-bar{display:block}.gv-bar i{display:block;height:100%;width:30%;background:#f79009;border-radius:6px;animation:gvbar 1.6s ease-in-out infinite}
@keyframes gvbar{0%{margin-left:-30%}100%{margin-left:100%}}
.gv-row{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}
.gv-btn{border:0;border-radius:12px;padding:10px 14px;font:inherit;font-weight:600;font-size:14px;cursor:pointer;background:#26332f;color:#ece5d2}.gv-btn.pri{background:#ece5d2;color:#0e1a1b}
.gv-in{flex:1;min-width:180px;border:1px solid #3a4a44;background:#16211e;color:#fff;border-radius:12px;padding:10px 12px;font:inherit;font-size:14px}
.gv-x{position:absolute;right:14px;top:12px;border:0;background:transparent;color:#9aa39a;font-size:20px;cursor:pointer;width:34px;height:34px;border-radius:50%}
.gv-hint{font-size:12px;color:#7f8b84;margin-top:10px}
@media (prefers-reduced-motion:reduce){.gv-orb,.gv-orb::after,.gv-bar i{animation:none!important}.gv-meter i{transition:none}}`
  document.head.appendChild(css)
  const fab = document.createElement('button'); fab.type = 'button'; fab.className = 'gv-fab'; fab.innerHTML = '<i aria-hidden="true"></i>AI 비서'; fab.title = 'AI 비서와 말로 검사하기 (Alt+V)'
  const box = document.createElement('div'); box.className = 'gv'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'AI 비서'); box.dataset.s = 'idle'
  box.innerHTML = `<button type="button" class="gv-x" aria-label="AI 비서 닫기">✕</button>
<div class="gv-top"><div class="gv-orb" aria-hidden="true"></div><div style="flex:1;min-width:0"><div class="gv-state" id="gvState">AI 비서</div><div class="gv-say" id="gvSay" aria-live="polite"></div><div class="gv-heard" id="gvHeard"></div></div></div>
<div class="gv-meter" aria-hidden="true">${'<i></i>'.repeat(24)}</div><div class="gv-bar" aria-hidden="true"><i></i></div>
<div class="gv-row"><input class="gv-in" id="gvIn" placeholder="말 대신 입력해도 됩니다 — 예: 정부24 접근성 검사해 줘" aria-label="AI 비서에게 입력"><button type="button" class="gv-btn pri" id="gvSend">보내기</button><button type="button" class="gv-btn" id="gvMic">🎙 다시 말하기</button></div>
<div class="gv-hint">말한 내용은 크롬·엣지 음성 인식 서비스로 글로 바뀝니다 · 비서의 모든 말은 이 자막으로도 표시 · ESC 닫기</div>`
  document.body.appendChild(fab); document.body.appendChild(box)
  const ST = { idle: 'AI 비서', listen: '● 듣는 중', think: '생각하는 중…', speak: '말하는 중', run: '검사 중' }
  const set = s => { box.dataset.s = s; $('#gvState').textContent = ST[s] || s }
  let stream = null, ac = null, raf = 0, rec = null, open = false, lastFocus = null, mode = 'cmd'
  // ── 말하기 (Windows 한국어 음성) — 자막과 함께
  const voice = () => (speechSynthesis.getVoices() || []).find(v => /ko(-|_)KR/i.test(v.lang))
  const say = (t, then) => { $('#gvSay').textContent = t; set('speak'); try { speechSynthesis.cancel() } catch (_) {}
    if (!('speechSynthesis' in window)) { set('idle'); then && setTimeout(then, 600); return }
    const u = new SpeechSynthesisUtterance(t.replace(/PPTX/g, '피피티엑스').replace(/KRDS/g, '케이알디에스')); u.lang = 'ko-KR'; const v = voice(); if (v) u.voice = v; u.rate = 1.05
    let done = false; const fin = () => { if (done) return; done = true; if (box.dataset.s === 'speak') set('idle'); then && then() }
    u.onend = fin; u.onerror = fin; setTimeout(fin, Math.max(3000, t.length * 170)); speechSynthesis.speak(u) }
  // ── 마이크 게이지 (PC 안에서만 계산)
  async function meterOn() { try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); ac = new (window.AudioContext || window.webkitAudioContext)(); const an = ac.createAnalyser(); an.fftSize = 512; ac.createMediaStreamSource(stream).connect(an)
      const bars = [...box.querySelectorAll('.gv-meter i')], d = new Uint8Array(an.frequencyBinCount); const orb = box.querySelector('.gv-orb')
      const loop = () => { an.getByteFrequencyData(d); let sum = 0; bars.forEach((b, i) => { const v = d[2 + i * 3] / 255; sum += v; b.style.height = Math.max(4, v * 34) + 'px' }); orb.style.transform = `scale(${1 + Math.min(.25, sum / bars.length * .5)})`; raf = requestAnimationFrame(loop) }; loop(); return true
    } catch (e) { return e } }
  function meterOff() { cancelAnimationFrame(raf); box.querySelector('.gv-orb').style.transform = ''; try { stream && stream.getTracks().forEach(t => t.stop()) } catch (_) {} try { ac && ac.close() } catch (_) {} stream = ac = null }
  // ── 듣기
  async function listen() { if (!SR) { say('이 브라우저는 음성 인식을 지원하지 않습니다. 아래 칸에 입력해 주세요.'); return }
    try { speechSynthesis.cancel() } catch (_) {}
    const m = await meterOn(); if (m !== true) { say(m && m.name === 'NotAllowedError' ? '마이크가 차단되어 있습니다. 주소창 왼쪽 자물쇠 → 마이크 → 허용 후 다시 시도해 주세요.' : '마이크를 찾을 수 없습니다. 아래 칸에 입력해 주세요.'); return }
    set('listen'); $('#gvHeard').textContent = ''
    rec = new SR(); rec.lang = 'ko-KR'; rec.interimResults = true; rec.maxAlternatives = 1; let final = ''
    rec.onresult = ev => { let t = ''; for (const r of ev.results) { t += r[0].transcript; if (r.isFinal) final = t } $('#gvHeard').textContent = '“' + t + '”' }
    rec.onerror = ev => { meterOff(); const m = { 'no-speech': '말씀을 듣지 못했습니다. 🎙 다시 말하기를 눌러 주세요.', network: '음성 인식은 인터넷이 필요합니다. 아래 칸에 입력해 주세요.', 'not-allowed': '마이크 사용이 차단되었습니다. 주소창 왼쪽 자물쇠 → 마이크 → 허용.' }[ev.error]; if (m) say(m) }
    rec.onend = () => { meterOff(); if (box.dataset.s === 'listen') set('idle'); const t = (final || '').trim(); if (t) handle(t) }
    try { rec.start() } catch (_) {} }
  // ── 대화 처리
  const yes = t => /^(응|어|네|예|그래|좋아|부탁|해\s*줘|만들어|저장|ㅇㅇ|오케이|ok|yes)|피피티|pptx|엑셀|excel|html|둘\s*다|전부|모두/i.test(t)
  const no = t => /^(아니|아뇨|됐어|괜찮아|필요\s*없|그만|no)/i.test(t)
  async function handle(t) { $('#gvHeard').textContent = '“' + t + '”'
    if (mode === 'report') { mode = 'cmd'
      if (no(t)) return say('알겠습니다. 결과는 화면에서 바로 보실 수 있어요. 더 필요한 게 있으시면 불러 주세요.', () => setTimeout(close, 2500))
      if (yes(t)) { const want = []; if (/엑셀|excel/i.test(t)) want.push(['#dlXlsx', 'Excel']); if (/html/i.test(t)) want.push(['#dlHtml', 'HTML']); if (/피피티|pptx|파워|ppt/i.test(t) || !want.length || /둘\s*다|전부|모두/.test(t)) want.unshift(['#dlPptx', 'PPTX'])
        if (/둘\s*다|전부|모두/.test(t) && !want.find(w => w[1] === 'Excel')) want.push(['#dlXlsx', 'Excel'])
        say(want.map(w => w[1]).join('와 ') + ' 결과서를 만들겠습니다.', async () => { set('run'); for (const [sel] of want) { const b = $(sel); if (b) { b.click(); await new Promise(r => setTimeout(r, 2500)) } }
          say('결과서를 저장했습니다. 다운로드 폴더를 확인해 주세요. 더 필요한 게 있으신가요?', () => { mode = 'cmd'; listen() }) }); return }
      mode = 'report'; return say('결과서를 만들어 드릴까요? 피피티엑스, 엑셀, 또는 아니요로 말씀해 주세요.', listen) }
    if (no(t)) return say('네, 필요하시면 언제든 불러 주세요.', () => setTimeout(close, 2000))
    set('think'); $('#gvSay').textContent = '말씀을 이해하는 중입니다…'
    let r; try { r = await (await fetch('/api/ai/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t }) })).json() } catch (e) { r = { ok: false, error: e.message } }
    if (!r.ok) return say('죄송합니다. AI가 응답하지 않았습니다. ' + (r.error ? '(' + r.error + ')' : ''))
    if (!r.url) return say('어느 사이트를 검사할까요? 사이트 이름이나 주소를 말씀해 주세요.', listen)
    const names = { checkLinks: '깨진 링크', checkSpelling: '오탈자', checkW3C: 'HTML 표준', checkKRDS: 'KRDS' }; const on = Object.entries(r.checks || {}).filter(([k, v]) => v && names[k]).map(([k]) => names[k])
    const host = r.url.replace(/^https?:\/\//, '').replace(/\/$/, '')
    say(`${host} 에서 접근성${on.length ? '과 ' + on.join(', ') : ''} 검사를 시작하겠습니다.`, () => { set('run'); $('#gvSay').textContent = '검사하는 중입니다… 보통 30초 정도 걸려요.'; watch() })
    try { window.runCommand ? window.runCommand(t, r) : null } catch (_) {}
  }
  // 검사 진행 → 끝나면 결과 안내
  function watch() { const t0 = Date.now(); const iv = setInterval(() => { const now = $('#run-now'); if (now && box.dataset.s === 'run') $('#gvHeard').textContent = now.textContent
      const p3 = $('#p3'); if (p3 && p3.classList.contains('on')) { clearInterval(iv)
        const n = ($('#score') || {}).textContent || ''; const verdict = ($('#h3a') || {}).textContent || ''; const cnt = parseInt(n) || 0
        $('#gvHeard').textContent = verdict
        say(cnt ? `검사가 끝났습니다. 고쳐야 할 문제가 ${cnt}건 있습니다. ${verdict.split('—')[0].trim()}. 결과서를 피피티엑스로 만들어 드릴까요?` : '검사가 끝났습니다. 자동 검사로 찾은 문제가 없습니다. 결과서를 만들어 드릴까요?', () => { mode = 'report'; listen() }) }
      else if (Date.now() - t0 > 240000) { clearInterval(iv); say('검사가 오래 걸리고 있습니다. 화면에서 진행 상황을 확인해 주세요.') } }, 1200) }
  // ── 열기 · 닫기
  function openBox() { if (open) return; open = true; lastFocus = document.activeElement; box.classList.add('on'); fab.setAttribute('aria-expanded', 'true'); mode = 'cmd'
    say('무엇을 검사할까요? 예를 들어 "정부24 접근성 검사해 줘"라고 말씀해 주세요.', listen); setTimeout(() => $('#gvIn').focus(), 50) }
  function close() { open = false; try { rec && rec.abort() } catch (_) {} meterOff(); try { speechSynthesis.cancel() } catch (_) {} box.classList.remove('on'); set('idle'); fab.setAttribute('aria-expanded', 'false'); lastFocus && lastFocus.focus && lastFocus.focus() }
  fab.onclick = openBox; box.querySelector('.gv-x').onclick = close; $('#gvMic').onclick = listen
  $('#gvSend').onclick = () => { const v = $('#gvIn').value.trim(); if (v) { $('#gvIn').value = ''; try { rec && rec.abort() } catch (_) {} handle(v) } }
  $('#gvIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('#gvSend').click() })
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) close(); if (e.altKey && (e.key === 'v' || e.key === 'V' || e.key === 'ㅍ')) { e.preventDefault(); open ? close() : (fab.classList.contains('on') && openBox()) } })
  // AI가 켜져 있을 때만 버튼 표시 (키 없음 · 행정망이면 숨김)
  const check = async () => { try { const a = await (await fetch('/api/ai/status')).json(); fab.classList.toggle('on', !!a.enabled) } catch (_) {} }
  check(); setInterval(check, 60000); try { speechSynthesis.getVoices() } catch (_) {}
})()
