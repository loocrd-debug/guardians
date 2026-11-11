// KRDS 기준 · 검사 엔진 자동 추적 — ① 매주 KRDS 공식 사이트·토큰 CSS 감시 → ② 바뀐 부분을 AI(Claude)가 해석해 영향 규칙·수정안 작성 → ③ 알림
// 반영은 담당자 승인 후 수동 (판정 기준이 몰래 바뀌지 않도록). 키가 없으면 ①③만 동작.
const { join } = require('path'); const fs = require('fs'); const crypto = require('crypto')
const BASE = 'https://www.krds.go.kr'
const SOURCES = [
  { id: 'tokens', name: '공식 디자인 토큰 CSS', url: BASE + '/resources/css/krds_tokens.css', type: 'css' },
  { id: 'color', name: '스타일 · 색상', url: BASE + '/html/site/style/style_02.html', type: 'page' },
  { id: 'typo', name: '스타일 · 타이포그래피', url: BASE + '/html/site/style/style_03.html', type: 'page' },
  { id: 'shape', name: '스타일 · 형태', url: BASE + '/html/site/style/style_04.html', type: 'page' },
  { id: 'layout', name: '스타일 · 레이아웃', url: BASE + '/html/site/style/style_05.html', type: 'page' },
  { id: 'token-doc', name: '스타일 · 디자인 토큰', url: BASE + '/html/site/style/style_07.html', type: 'page' },
  { id: 'component', name: '컴포넌트 (공식 배너 외)', url: BASE + '/html/site/component/component_summary.html', type: 'page' },
  { id: 'global', name: '기본 패턴', url: BASE + '/html/site/global/global_summary.html', type: 'page' },
  { id: 'service', name: '서비스 패턴', url: BASE + '/html/site/service/service_summary.html', type: 'page' },
  { id: 'principle', name: '디자인 원칙', url: BASE + '/html/site/utility/utility_02.html', type: 'page' },
  { id: 'designer', name: '시작하기 · 디자이너', url: BASE + '/html/site/outline/outline_02.html', type: 'page' }
]
// 검사 엔진 추적 — 설치된 버전과 공개된 최신 버전을 비교
const ENGINES = [
  { id: 'axe-core', name: 'axe-core · 접근성 규칙 엔진', pkg: 'axe-core', repo: 'dequelabs/axe-core' },
  { id: 'playwright', name: 'Playwright · 검사용 브라우저', pkg: 'playwright', repo: 'microsoft/playwright' }
]
const vcmp = (a, b) => { const x = String(a).split(/[.-]/).map(n => parseInt(n, 10) || 0), y = String(b).split(/[.-]/).map(n => parseInt(n, 10) || 0); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0) } return 0 }
const MODEL = 'claude-sonnet-4-6', API = 'https://api.anthropic.com/v1/messages'
module.exports = function (app, APP_ROOT, opts = {}) {
  const DIR = join(APP_ROOT, 'data', 'krds-watch'), SNAP = join(DIR, 'snapshots'), REP = join(DIR, 'reports'), STATE = join(DIR, 'state.json')
  for (const d of [DIR, SNAP, REP]) try { fs.mkdirSync(d, { recursive: true }) } catch (_) {}
  const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (_) { return d } }
  const writeJ = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 1))
  const key = () => process.env.GUARDIANS_WATCH_AI_KEY || process.env.ANTHROPIC_API_KEY || ''
  let running = false
  const tell = (t, b, link) => { try { if (opts.notify) opts.notify(t, b, { kind: 'watch', link: link || '/krds-watch.html' }) } catch (_) {} }
  const installed = pkg => { try { return JSON.parse(fs.readFileSync(join(APP_ROOT, 'node_modules', pkg, 'package.json'), 'utf8')).version } catch (_) { try { return require(pkg + '/package.json').version } catch (_) { return null } } }
  async function interpretEngine(e, cur, latest, notes) {
    const k = key(); if (!k) return { skipped: true, reason: 'AI 키 없음 — 버전 비교 결과만 기록' }
    const prompt = `당신은 정부 웹사이트 품질 검사 도구 "가디언즈"의 검사 엔진 관리자입니다.\n${e.name}의 새 버전이 나왔습니다 (현재 ${cur} → 최신 ${latest}).\n아래 릴리스 노트를 읽고, 가디언즈의 검사 결과(접근성 판정 규칙 · 화면 캡처 · 브라우저 동작)에 어떤 영향이 있는지 분석하세요.\n\n[릴리스 노트]\n${String(notes || '(릴리스 노트를 가져오지 못함)').slice(0, 9000)}\n\nJSON만 출력: {"summary":"한두 문장 요약","impact":"high|medium|low|none","items":[{"what":"바뀐 점","impact":"high|medium|low|none","affects":["영향받는 검사 항목"],"proposal":"가디언즈에서 할 일","reason":"근거"}]}`
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 90000)
    try { const r = await fetch(API, { method: 'POST', signal: ctl.signal, headers: Object.assign({ 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' }, /^sk-ant-api/.test(k) ? { 'x-api-key': k } : { Authorization: 'Bearer ' + k }), body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }) })
      const j = await r.json(); if (!r.ok) throw new Error((j.error && j.error.message) || 'HTTP ' + r.status)
      const text = (j.content || []).map(x => x.text || '').join('').replace(/```json|```/g, '').trim(); const out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); out.model = MODEL; return out
    } catch (err) { return { error: 'AI 해석 실패: ' + err.message } } finally { clearTimeout(t) } }
  async function checkEngines(st, now, trigger) { st.engines = st.engines || {}; const made = []
    for (const e of ENGINES) { const prev = st.engines[e.id] || {}; const cur = installed(e.pkg)
      try { const j = JSON.parse(await get('https://registry.npmjs.org/' + e.pkg + '/latest')); const latest = j.version
        const isNew = cur && vcmp(latest, cur) > 0 && prev.latest !== latest
        st.engines[e.id] = { installed: cur, latest, ok: true, checkedAt: now, upToDate: !cur || vcmp(latest, cur) <= 0 }
        if (isNew) { let notes = ''; try { notes = (JSON.parse(await get('https://api.github.com/repos/' + e.repo + '/releases/latest')).body) || '' } catch (_) {}
          const rep = { id: now.replace(/[-:.TZ]/g, '').slice(0, 14) + String(made.length), at: now, trigger, kind: 'engine', changedSources: [e.id], changes: [{ source: e.id, name: e.name, url: 'https://github.com/' + e.repo + '/releases', diff: [{ kind: '변경', name: '버전', before: cur, after: latest }] }] }
          rep.ai = await interpretEngine(e, cur, latest, notes); rep.status = '검토 대기'; writeJ(join(REP, rep.id + '.json'), rep); made.push(rep)
          tell('가디언즈 — 검사 엔진 새 버전', `${e.name} ${latest} 공개 (현재 ${cur}). 검증 후 다음 업데이트에 반영됩니다.`, '/krds-watch.html#' + rep.id) }
      } catch (err) { st.engines[e.id] = Object.assign({}, prev, { installed: cur, ok: false, error: err.message, checkedAt: now }) } }
    return made }
  async function get(url) { const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 30000)
    try { const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'Guardians-KRDS-Watch/1.0 (+https://guardians.ai.kr)' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.text() } finally { clearTimeout(t) } }
  function normalize(src, raw) {
    if (src.type === 'css') { const m = {}; for (const x of raw.matchAll(/(--krds-[\w-]+)\s*:\s*([^;}{]+);/g)) m[x[1]] = x[2].trim().replace(/\s+/g, ' '); return Object.keys(m).sort().map(k => k + ': ' + m[k]).join('\n') }
    let t = raw; const main = t.match(/<main[\s\S]*?<\/main>/i) || t.match(/id="(?:container|contents?)"[\s\S]*$/i); if (main) t = main[0]
    t = t.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, '').replace(/<(br|\/p|\/li|\/h\d|\/tr|\/dt|\/dd|\/div|\/td|\/th)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
    t = t.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    const seen = new Set(); return t.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l.length > 1 && !seen.has(l) && seen.add(l)).join('\n')
  }
  function diff(src, before, after) {
    if (src.type === 'css') { const p = s => Object.fromEntries(s.split('\n').filter(Boolean).map(l => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()])); const a = p(before), b = p(after); const ch = []
      for (const k of Object.keys(b)) if (!(k in a)) ch.push({ kind: '추가', name: k, after: b[k] }); else if (a[k] !== b[k]) ch.push({ kind: '변경', name: k, before: a[k], after: b[k] })
      for (const k of Object.keys(a)) if (!(k in b)) ch.push({ kind: '삭제', name: k, before: a[k] })
      return ch }
    const A = new Set(before.split('\n')), B = new Set(after.split('\n'))
    return [...[...B].filter(l => !A.has(l)).map(l => ({ kind: '추가', text: l })), ...[...A].filter(l => !B.has(l)).map(l => ({ kind: '삭제', text: l }))].slice(0, 80)
  }
  function rulesSummary() {
    const c = readJ(join(APP_ROOT, 'public', 'criteria.json'), {}); const ins = id => (c.inspections || []).find(x => x.id === id) || {}
    return { krdsRules: (ins('krds').items || []).map(i => `${i.id}: ${i.name} — ${i.what} (${i.ref})`), tokenItems: (ins('krds-tokens').items || []).map(i => `${i.no}. ${i.name}: ${i.what} [기준값 ${i.ref}]`) }
  }
  async function interpret(changes) {
    const k = key(); if (!k) return { skipped: true, reason: 'AI 키 없음 — 기계적 비교 결과만 기록' }
    const rs = rulesSummary(); let body = JSON.stringify(changes, null, 1); if (body.length > 14000) body = body.slice(0, 14000) + '\n…(생략)'
    const prompt = `당신은 정부 웹사이트 품질 검사 도구 "가디언즈"의 KRDS 기준 관리자입니다.\nKRDS(디지털 정부서비스 UI/UX 가이드라인) 공식 사이트에서 지난 점검 이후 바뀐 내용을 받았습니다. 가디언즈의 현재 판정 기준에 영향이 있는지 분석하세요.\n\n[가디언즈 KRDS 구조 규칙 28개]\n${rs.krdsRules.join('\n')}\n\n[가디언즈 KRDS 디자인 토큰 판정 11항목]\n${rs.tokenItems.join('\n')}\n(색상 팔레트 판정은 공식 토큰 CSS의 --krds-light-* 90색을 기준으로 함)\n\n[KRDS 사이트 변경 내용]\n${body}\n\n다음 JSON만 출력하세요(설명 문장·코드블록 금지):\n{"summary":"한두 문장 요약","impact":"high|medium|low|none","items":[{"source":"출처 id","what":"무엇이 바뀌었나","affects":["영향받는 가디언즈 규칙 id 또는 토큰 항목 번호"],"impact":"high|medium|low|none","proposal":"가디언즈에서 고칠 내용(구체적으로, 없으면 '변경 불필요')","reason":"근거"}],"needsReview":true}\n주의: 메뉴·날짜·예시 문구만 바뀐 경우는 impact "none". 추측은 하지 말고 근거가 부족하면 그렇게 쓰세요.`
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 90000)
    try { const r = await fetch(API, { method: 'POST', signal: ctl.signal, headers: Object.assign({ 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' }, /^sk-ant-api/.test(k) ? { 'x-api-key': k } : { Authorization: 'Bearer ' + k }, process.env.GUARDIANS_WATCH_AI_WORKSPACE ? { 'anthropic-workspace-id': process.env.GUARDIANS_WATCH_AI_WORKSPACE } : {}), body: JSON.stringify({ model: MODEL, max_tokens: 3000, messages: [{ role: 'user', content: prompt }] }) })
      const j = await r.json(); if (!r.ok) throw new Error((j.error && j.error.message) || 'HTTP ' + r.status)
      const text = (j.content || []).map(x => x.text || '').join('').replace(/```json|```/g, '').trim(); const out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); out.model = MODEL; return out
    } catch (e) { return { error: 'AI 해석 실패: ' + e.message } } finally { clearTimeout(t) }
  }
  async function notify(rep) { const url = process.env.GUARDIANS_WATCH_WEBHOOK; if (!url) return
    const ai = rep.ai || {}; const lines = [`[가디언즈] KRDS 변경 감지 — ${rep.changedSources.length}곳`, ai.summary ? 'AI 요약: ' + ai.summary : (ai.reason || ai.error || ''), ai.impact ? '영향도: ' + ai.impact : '', `자세히: ${process.env.GUARDIANS_WEB_URL || ''}/krds-watch.html#${rep.id}`].filter(Boolean)
    try { await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: lines.join('\n') }) }) } catch (_) {} }
  async function run(trigger = 'manual') {
    if (running) return { busy: true }; running = true
    try { const st = readJ(STATE, { sources: {} }); const now = new Date().toISOString(); const changes = []; const baseline = []
      for (const s of SOURCES) { const prev = st.sources[s.id] || {}
        try { const norm = normalize(s, await get(s.url)); const hash = crypto.createHash('sha256').update(norm).digest('hex').slice(0, 16); const f = join(SNAP, s.id + '.txt')
          if (!prev.hash || !fs.existsSync(f)) baseline.push(s.id)
          else if (prev.hash !== hash) { const d = diff(s, fs.readFileSync(f, 'utf8'), norm); if (d.length) changes.push({ source: s.id, name: s.name, url: s.url, diff: d }) }
          fs.writeFileSync(f, norm); st.sources[s.id] = { hash, fetchedAt: now, ok: true, size: norm.length }
        } catch (e) { st.sources[s.id] = Object.assign(prev, { ok: false, error: e.message, checkedAt: now }) } }
      st.lastRun = now; st.lastTrigger = trigger
      let rep = null
      if (changes.length) { rep = { id: now.replace(/[-:.TZ]/g, '').slice(0, 14), at: now, trigger, changedSources: changes.map(c => c.source), changes }
        rep.ai = await interpret(changes); rep.status = '검토 대기'; writeJ(join(REP, rep.id + '.json'), rep); await notify(rep)
        tell('가디언즈 — KRDS 변경 감지', `공식 자료 ${changes.length}곳이 바뀌었습니다.` + (rep.ai && rep.ai.summary ? ' ' + rep.ai.summary : ''), '/krds-watch.html#' + rep.id) }
      const eng = await checkEngines(st, now, trigger)
      writeJ(STATE, st); return { ok: true, baseline, changed: changes.length, report: rep && rep.id, engines: eng.length }
    } finally { running = false } }
  // 일정: GUARDIANS_WATCH=1 일 때 매주 월요일 06시(한국) 무렵 1회
  if (process.env.GUARDIANS_WATCH === '1') setInterval(() => { const k = new Date(Date.now() + 9 * 3600e3); const st = readJ(STATE, {})
    if (k.getUTCDay() === 1 && k.getUTCHours() === 6 && (!st.lastRun || Date.now() - Date.parse(st.lastRun) > 6 * 864e5)) run('schedule').catch(() => {}) }, 15 * 60e3)
  const isAdmin = req => { const t = process.env.GUARDIANS_ADMIN_TOKEN; if (t) return req.headers['x-admin-token'] === t; const ip = (req.socket.remoteAddress || ''); return /127\.0\.0\.1|::1$/.test(ip) }
  app.get('/api/krds-watch', (req, res) => { const st = readJ(STATE, { sources: {} })
    const reps = (() => { try { return fs.readdirSync(REP).filter(f => f.endsWith('.json')).sort().reverse().slice(0, 30).map(f => { const r = readJ(join(REP, f), {}); return { id: r.id, at: r.at, kind: r.kind || 'krds', changedSources: r.changedSources, status: r.status, summary: r.ai && (r.ai.summary || r.ai.reason || r.ai.error), impact: r.ai && r.ai.impact } }) } catch (_) { return [] } })()
    res.json({ enabled: process.env.GUARDIANS_WATCH === '1', ai: !!key(), schedule: '매주 월요일 06시', lastRun: st.lastRun || null, sources: SOURCES.map(s => Object.assign({ id: s.id, name: s.name, url: s.url }, st.sources[s.id] || {})), engines: ENGINES.map(e => Object.assign({ id: e.id, name: e.name, url: 'https://github.com/' + e.repo + '/releases', installed: installed(e.pkg) }, (st.engines || {})[e.id] || {})), reports: reps, running }) })
  app.get('/api/krds-watch/report/:id', (req, res) => { const f = join(REP, String(req.params.id).replace(/[^0-9]/g, '') + '.json'); fs.existsSync(f) ? res.json(readJ(f, {})) : res.status(404).json({ error: '없음' }) })
  app.post('/api/krds-watch/run', async (req, res) => { if (!isAdmin(req)) return res.status(403).json({ error: '관리자만 실행할 수 있습니다' }); res.json(await run('manual')) })
  app.post('/api/krds-watch/report/:id/status', (req, res) => { if (!isAdmin(req)) return res.status(403).json({ error: '관리자만' }); const f = join(REP, String(req.params.id).replace(/[^0-9]/g, '') + '.json'); if (!fs.existsSync(f)) return res.status(404).end()
    const r = readJ(f, {}); r.status = ['반영함', '보류', '검토 대기', '영향 없음'].includes((req.body || {}).status) ? req.body.status : r.status; r.statusAt = new Date().toISOString(); writeJ(f, r); res.json({ ok: true, status: r.status }) })
  return { run, SOURCES }
}
