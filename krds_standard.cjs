// KRDS 기준 데이터(판정 기준값) 관리 — 버전 · 서명 · 배포 · 수신 (v6.20)
//  · 기준 데이터 = 공식 토큰 CSS에서 뽑은 팔레트 90색 + 토큰 값 + 판정 기준값(본문 크기 · 줄 간격 · 래디어스 등)
//  · 팀 웹(guardians.ai.kr)이 담당자 승인 후 "발행"하고 Ed25519로 서명 → 설치형은 인터넷이 되면 자동 수신, 행정망은 파일로 가져오기
//  · 서명이 맞지 않으면 절대 적용하지 않음. 결과에는 적용한 기준 버전을 기록.
const fs = require('fs'), path = require('path'), crypto = require('crypto')
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEABoZa4cKqFrcj5MZGr6JaH++o4a73QcIyQXqZvwODWUk=
-----END PUBLIC KEY-----`
let ROOT = __dirname, BASE = null, ACTIVE = null
const canon = o => JSON.stringify(o, Object.keys(o).sort())   // 최상위 키 정렬 (data는 아래 stable로)
const stable = o => Array.isArray(o) ? '[' + o.map(stable).join(',') + ']' : (o && typeof o === 'object') ? '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}' : JSON.stringify(o)
function bundled() {
  let ref = { palette: {}, tok: {} }; try { ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'krds_palette.json'), 'utf8')) } catch (_) {}
  return { version: '2026.10.0', basedOn: 'krds.go.kr 공식 토큰 CSS · 스타일 가이드 (2026-10)', publishedAt: '2026-10-02T00:00:00Z', bundled: true,
    font: 'Pretendard GOV', bodyPx: 17, bodyMinPx: 16, weights: [400, 700], lineHeight: 1.5, letterSpacing: 0, radii: [2, 4, 6, 8, 10, 12], radiusMax: 12, paletteDeltaE: 4, pointMaxPct: 10,
    palette: ref.palette || {}, tok: ref.tok || {} }
}
const vnum = v => String(v || '0').split('.').map(n => +n || 0).reduce((a, n) => a * 1000 + n, 0)
function verify(pkg) { try { if (!pkg || !pkg.data || !pkg.sig) return false; return crypto.verify(null, Buffer.from(stable(pkg.data)), PUBLIC_KEY, Buffer.from(pkg.sig, 'base64')) } catch (_) { return false } }
function load() { BASE = bundled(); ACTIVE = BASE
  try { const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'krds-standard.json'), 'utf8')); if (verify(pkg) && vnum(pkg.data.version) >= vnum(BASE.version)) ACTIVE = Object.assign({}, pkg.data, { signed: true }) } catch (_) {} }
function current() { if (!ACTIVE) load(); return ACTIVE }
function save(pkg) { fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'data', 'krds-standard.json'), JSON.stringify(pkg, null, 1)); load() }
function apply(pkg) { if (!verify(pkg)) return { ok: false, error: '서명이 올바르지 않아 적용하지 않았습니다' }
  if (vnum(pkg.data.version) <= vnum(current().version)) return { ok: true, unchanged: true, version: current().version }
  save(pkg); return { ok: true, version: current().version } }
// 공식 토큰 CSS(정규화 스냅샷: "--name: value" 줄들)에서 새 기준 데이터 만들기
function fromTokens(text, prev) {
  const m = {}; for (const l of String(text).split('\n')) { const i = l.indexOf(':'); if (i > 0) m[l.slice(0, i).trim()] = l.slice(i + 1).trim() }
  const fam = new Set(Object.keys(prev.palette || {}).map(k => k.replace(/-\d+$/, '')))   // 기존 색 계열만 (새 계열 추가는 사람이 검토)
  const palette = {}; for (const [k, v] of Object.entries(m)) if (fam.has(k.replace(/-\d+$/, '')) && /^--krds-light-[a-z-]+-\d+$/.test(k) && /^#[0-9a-f]{6}$/i.test(v)) palette[k] = v.toLowerCase()
  const tok = {}; for (const k of Object.keys(prev.tok || {})) if (m[k] != null) tok[k] = m[k]
  const d = Object.assign({}, prev, { palette: Object.keys(palette).length >= 40 ? palette : prev.palette, tok: Object.keys(tok).length ? tok : prev.tok })
  if (tok['--krds-font-type']) d.font = tok['--krds-font-type'].replace(/["']/g, '').split(',')[0].trim()
  const bs = tok['--krds-pc-typo-body-medium-size']; if (bs && /rem$/.test(bs)) d.bodyPx = Math.round(parseFloat(bs) * 10)
  delete d.bundled; delete d.signed; return d
}
module.exports = function (app, APP_ROOT, opts = {}) {
  ROOT = APP_ROOT; load()
  const PUB = process.env.GUARDIANS_PUBLIC === '1'
  const KEYF = path.join(APP_ROOT, 'data', 'std-signing.key')
  const canPublish = () => PUB && fs.existsSync(KEYF)
  const isAdmin = opts.isAdmin || (() => false)
  app.get('/api/krds-standard', (req, res) => { const c = current(); let pkg = null; try { pkg = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'data', 'krds-standard.json'), 'utf8')) } catch (_) {}
    res.json({ version: c.version, basedOn: c.basedOn, publishedAt: c.publishedAt, signed: !!c.signed, bundled: !!c.bundled, canPublish: canPublish(), source: process.env.GUARDIANS_STD_SOURCE || (PUB ? null : 'https://guardians.ai.kr'), package: pkg && verify(pkg) ? pkg : null,
      summary: { font: c.font, bodyPx: c.bodyPx, lineHeight: c.lineHeight, radii: c.radii, paletteColors: Object.keys(c.palette || {}).length } }) })
  app.get('/api/krds-standard/download', (req, res) => { const f = path.join(APP_ROOT, 'data', 'krds-standard.json'); if (!fs.existsSync(f)) return res.status(404).json({ error: '발행된 기준이 아직 없습니다 (기본 기준 사용 중)' })
    res.setHeader('Content-Disposition', `attachment; filename="guardians-krds-standard-${current().version}.json"`); res.type('application/json').send(fs.readFileSync(f)) })
  app.post('/api/krds-standard/import', (req, res) => res.json(apply(req.body || {})))
  // 발행 (팀 웹 · 관리자) — 최신 공식 토큰 CSS 스냅샷으로 새 기준을 만들고 서명
  app.post('/api/krds-standard/publish', (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: '관리자만 발행할 수 있습니다' }); if (!canPublish()) return res.status(400).json({ error: '이 서버에는 서명 키가 없어 발행할 수 없습니다' })
    let snap = ''; try { snap = fs.readFileSync(path.join(APP_ROOT, 'data', 'krds-watch', 'snapshots', 'tokens.txt'), 'utf8') } catch (_) { return res.status(400).json({ error: '토큰 CSS 스냅샷이 없습니다 — KRDS 기준 추적을 먼저 실행하세요' }) }
    const prev = current(); const d = fromTokens(snap, prev); const now = new Date(); const ymd = now.toISOString().slice(0, 10).replace(/-/g, '.').slice(0, 7)
    let seq = 1; if (String(prev.version).startsWith(ymd + '.')) seq = (+String(prev.version).split('.')[2] || 0) + 1
    d.version = ymd + '.' + seq; d.publishedAt = now.toISOString(); d.basedOn = 'krds.go.kr 공식 토큰 CSS · ' + now.toISOString().slice(0, 10) + ' 확인분'; d.report = (req.body || {}).report || null; d.note = String((req.body || {}).note || '').slice(0, 300)
    const sig = crypto.sign(null, Buffer.from(stable(d)), fs.readFileSync(KEYF, 'utf8')).toString('base64'); const pkg = { format: 'guardians-krds-standard/1', data: d, sig }
    if (!verify(pkg)) return res.status(500).json({ error: '서명 확인 실패 — 서명 키가 공개 키와 맞지 않습니다' })
    save(pkg); res.json({ ok: true, version: d.version, paletteColors: Object.keys(d.palette).length }) })
  // 수신 (설치형 등 · 인터넷이 될 때) — 시작 1분 뒤 + 12시간마다
  const src = process.env.GUARDIANS_STD_SOURCE || (PUB ? '' : 'https://guardians.ai.kr')
  const pull = async () => { if (!src) return; try { const r = await fetch(src + '/api/krds-standard', { signal: AbortSignal.timeout(15000) }); if (!r.ok) return; const j = await r.json(); if (j.package) { const out = apply(j.package); if (out.ok && !out.unchanged) console.log('[KRDS 기준] 새 기준 적용:', out.version) } } catch (_) {} }
  if (src) { setTimeout(pull, 60e3); setInterval(pull, 12 * 3600e3) }
  app.post('/api/krds-standard/pull', async (req, res) => { await pull(); res.json({ version: current().version }) })
  return { current, verify }
}
module.exports.current = current
