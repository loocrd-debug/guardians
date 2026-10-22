// ═══════════════════════════════════════════════════════════
//  scheduler.cjs — 예약·자동 검사 (v6.0)
//  · 예약 저장: data/schedules.json   · 회차 결과: data/schedule-results/<id>/<ts>.json
//  · 1분마다 예정 시각 확인 → 기존 /api/scan 을 그대로 호출(결과·보고서 동일)
//  · 직전 회차와 비교(점수·위반) → 웹훅 알림(악화 시 / 매회)
// ═══════════════════════════════════════════════════════════
const fs = require('fs')
const path = require('path')

module.exports = function attachScheduler(app, APP_ROOT, getPort) {
  const DATA_DIR = path.join(APP_ROOT, 'data')
  const FILE = path.join(DATA_DIR, 'schedules.json')
  const RES_DIR = path.join(DATA_DIR, 'schedule-results')
  const KEEP = 60                       // 예약당 보관 회차 수
  fs.mkdirSync(RES_DIR, { recursive: true })

  // ── 저장/로드 ──
  let schedules = []
  const load = () => { try { schedules = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch (_) { schedules = [] } }
  const save = () => { try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(schedules, null, 2)) } catch (e) { console.warn('[예약 저장 실패]', e.message) } }
  load()

  const WD = ['일', '월', '화', '수', '목', '금', '토']
  const pad = n => String(n).padStart(2, '0')
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`

  // ── 다음 실행 시각 계산 ──
  function nextRunOf(s, from = new Date()) {
    const [hh, mm] = String(s.time || '09:00').split(':').map(Number)
    const d = new Date(from)
    if (s.freq === 'hourly') { d.setMinutes(mm || 0, 0, 0); if (d <= from) d.setHours(d.getHours() + 1); return d }
    d.setHours(hh, mm, 0, 0)
    if (s.freq === 'daily') { if (d <= from) d.setDate(d.getDate() + 1); return d }
    if (s.freq === 'weekly') {
      const wd = Number.isInteger(s.weekday) ? s.weekday : 1
      let diff = (wd - d.getDay() + 7) % 7
      if (diff === 0 && d <= from) diff = 7
      d.setDate(d.getDate() + diff); return d
    }
    return null
  }
  const withNext = s => ({ ...s, nextRun: s.enabled ? (nextRunOf(s) || null)?.toISOString() : null })

  // ── 회차 결과 파일 ──
  const resDir = id => path.join(RES_DIR, id)
  function listRuns(id) {
    try { return fs.readdirSync(resDir(id)).filter(f => f.endsWith('.json')).sort() } catch (_) { return [] }
  }
  function readRun(id, ts) { try { return JSON.parse(fs.readFileSync(path.join(resDir(id), ts + '.json'), 'utf8')) } catch (_) { return null } }

  // ── 실행 ──
  const running = new Set()
  async function runSchedule(s, trigger = 'auto') {
    if (running.has(s.id)) return { skipped: true }
    running.add(s.id)
    const startedAt = new Date()
    try {
      const body = { url: s.url, level: s.level || 'wcag2aa', includeScreenshot: true, scanMode: s.scanMode || 'expert',
        checkLinks: !!s.checkLinks, checkSpelling: !!s.checkSpelling, checkKRDS: !!s.checkKRDS, checkW3C: !!s.checkW3C, useW3CLinks: false,
        reportMeta: { project: s.name || s.url, generatedAt: fmt(startedAt), toolVersion: 'v6.0' } }
      const r = await fetch(`http://127.0.0.1:${getPort()}/api/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const result = await r.json()
      if (!r.ok || result.error) throw new Error(result.error || `HTTP ${r.status}`)

      // 직전 회차와 비교
      const prevTs = listRuns(s.id).slice(-1)[0]
      const prev = prevTs ? readRun(s.id, prevTs.replace('.json', '')) : null
      const sum = {
        ts: startedAt.toISOString(), trigger, ok: true,
        score: result.score ?? null, violations: result.summary?.violations ?? 0, passes: result.summary?.passes ?? 0,
        impact: result.summary?.impactCounts || {},
        deadLinks: result.links ? (result.links.dead || []).length : null,
        typos: result.spelling ? (result.spelling.totalIssues ?? (result.spelling.issues || []).length) : null,
        krdsFailed: result.krds ? result.krds.failed : null,
        durationSec: Math.round((Date.now() - startedAt) / 1000),
      }
      if (prev && prev.summary) {
        sum.deltaScore = (sum.score ?? 0) - (prev.summary.score ?? 0)
        sum.deltaViolations = sum.violations - (prev.summary.violations ?? 0)
        sum.worse = sum.deltaScore < 0 || sum.deltaViolations > 0
        sum.newRules = (result.violations || []).map(v => v.id).filter(id => !(prev.violationIds || []).includes(id))
      }
      // 저장 (전체 결과 + 요약) — 보관 수 초과분 삭제
      fs.mkdirSync(resDir(s.id), { recursive: true })
      const tsKey = startedAt.toISOString().replace(/[:.]/g, '-')
      fs.writeFileSync(path.join(resDir(s.id), tsKey + '.json'), JSON.stringify({ summary: sum, violationIds: (result.violations || []).map(v => v.id), result }))
      const runs = listRuns(s.id); while (runs.length > KEEP) { try { fs.unlinkSync(path.join(resDir(s.id), runs.shift())) } catch (_) {} }

      s.lastRun = sum.ts; s.lastSummary = sum; s.lastError = null; save()
      await notify(s, sum)
      console.log(`[예약] ${s.name || s.url} 실행 완료 · ${sum.score}점 · 위반 ${sum.violations}건${sum.deltaScore != null ? ` (${sum.deltaScore >= 0 ? '+' : ''}${sum.deltaScore})` : ''}`)
      return sum
    } catch (e) {
      s.lastRun = startedAt.toISOString(); s.lastError = e.message; save()
      console.warn(`[예약 실패] ${s.name || s.url}: ${e.message}`)
      return { ok: false, error: e.message }
    } finally { running.delete(s.id) }
  }

  // ── 웹훅 알림 (Slack/Teams/카카오워크 등 JSON POST) ──
  async function notify(s, sum) {
    if (!s.webhook) return
    const when = s.notifyWhen || 'worse'
    if (when === 'worse' && !sum.worse) return
    const arrow = sum.deltaScore == null ? '' : sum.deltaScore > 0 ? ` ▲${sum.deltaScore}` : sum.deltaScore < 0 ? ` ▼${Math.abs(sum.deltaScore)}` : ' ―'
    const text = `[가디언즈 예약 검사] ${s.name || s.url}\n접근성 ${sum.score}점${arrow} · 위반 ${sum.violations}건${sum.deltaViolations ? ` (${sum.deltaViolations > 0 ? '+' : ''}${sum.deltaViolations})` : ''}`
      + (sum.newRules?.length ? `\n새로 생긴 위반: ${sum.newRules.join(', ')}` : '') + `\n${fmt(new Date(sum.ts))} · ${s.url}`
    try {
      await fetch(s.webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, schedule: s.name, url: s.url, ...sum }) })
    } catch (e) { console.warn('[웹훅 실패]', e.message) }
  }

  // ── 1분마다 예정 확인 ──
  let lastTick = Date.now()
  setInterval(async () => {
    const now = new Date(); const prev = new Date(lastTick); lastTick = now.getTime()
    for (const s of schedules) {
      if (!s.enabled || !s.url) continue
      const due = nextRunOf(s, prev)             // 직전 tick 기준 다음 예정 시각
      if (due && due <= now && (!s.lastRun || new Date(s.lastRun) < due)) runSchedule(s, 'auto')
    }
  }, 60 * 1000)

  // ── API ──
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  app.get('/api/schedules', (req, res) => res.json(schedules.map(withNext)))
  app.post('/api/schedules', (req, res) => {
    const b = req.body || {}
    if (!b.url) return res.status(400).json({ error: 'URL이 필요합니다' })
    let url = String(b.url).trim(); if (!/^https?:\/\//i.test(url)) url = 'https://' + url
    const s = { id: uid(), name: b.name || url.replace(/^https?:\/\//, ''), url, freq: b.freq || 'daily', time: b.time || '09:00',
      weekday: Number.isInteger(b.weekday) ? b.weekday : 1, enabled: b.enabled !== false, scanMode: b.scanMode || 'expert', level: b.level || 'wcag2aa',
      checkLinks: !!b.checkLinks, checkSpelling: !!b.checkSpelling, checkKRDS: !!b.checkKRDS, checkW3C: !!b.checkW3C,
      webhook: b.webhook || '', notifyWhen: b.notifyWhen || 'worse', createdAt: new Date().toISOString() }
    schedules.push(s); save(); res.json(withNext(s))
  })
  app.put('/api/schedules/:id', (req, res) => {
    const s = schedules.find(x => x.id === req.params.id); if (!s) return res.status(404).json({ error: '없음' })
    const allow = ['name', 'url', 'freq', 'time', 'weekday', 'enabled', 'scanMode', 'level', 'checkLinks', 'checkSpelling', 'checkKRDS', 'checkW3C', 'webhook', 'notifyWhen']
    for (const k of allow) if (k in (req.body || {})) s[k] = req.body[k]
    save(); res.json(withNext(s))
  })
  app.delete('/api/schedules/:id', (req, res) => {
    const i = schedules.findIndex(x => x.id === req.params.id); if (i < 0) return res.status(404).json({ error: '없음' })
    schedules.splice(i, 1); save()
    try { fs.rmSync(resDir(req.params.id), { recursive: true, force: true }) } catch (_) {}
    res.json({ ok: true })
  })
  app.post('/api/schedules/:id/run', async (req, res) => {
    const s = schedules.find(x => x.id === req.params.id); if (!s) return res.status(404).json({ error: '없음' })
    const sum = await runSchedule(s, 'manual'); res.json(sum)
  })
  app.get('/api/schedules/:id/history', (req, res) => {
    const runs = listRuns(req.params.id).map(f => readRun(req.params.id, f.replace('.json', ''))).filter(Boolean)
    res.json(runs.map(r => ({ ...r.summary, key: r.summary.ts.replace(/[:.]/g, '-') })).reverse())
  })
  app.get('/api/schedules/:id/results/:key', (req, res) => {
    const r = readRun(req.params.id, req.params.key); if (!r) return res.status(404).json({ error: '없음' })
    res.json(r.result)
  })

  console.log(`[예약] 스케줄러 시작 · 예약 ${schedules.length}건 · ${FILE}`)
  return { runSchedule, schedules }
}
