// ═══════════════════════════════════════════════════════════
//  ai.cjs — AI 보조 (Claude API)  v6.5
//  · 원칙: AI는 검사 결과를 바꾸지 않는다. 빈칸(문장)·요약·지시 해석만 한다.
//  · 키가 없거나 인터넷이 없으면 status.enabled=false → 화면에서 AI 기능 자동 숨김
//  · 키 저장: data/settings.json (이 PC에만) 또는 환경변수 ANTHROPIC_API_KEY
// ═══════════════════════════════════════════════════════════
const fs = require('fs')
const path = require('path')

const MODEL = 'claude-sonnet-4-6'
const API = 'https://api.anthropic.com/v1/messages'

// ── 사이트 별칭표 (AI 없이 즉시 해석) ──
const ALIASES = [
  [/정부\s?24|정부이십사|gov24|gov\.kr/i, 'https://www.gov.kr'],
  [/공공데이터\s?포털|data\.go\.kr/i, 'https://www.data.go.kr'],
  [/정책\s?브리핑|korea\.kr/i, 'https://www.korea.kr'],
  [/행정안전부|행안부|mois/i, 'https://www.mois.go.kr'],
  [/국민신문고|epeople/i, 'https://www.epeople.go.kr'],
  [/홈택스|hometax/i, 'https://www.hometax.go.kr'],
  [/복지로|bokjiro/i, 'https://www.bokjiro.go.kr'],
  [/법제처|국가법령|law\.go\.kr/i, 'https://www.law.go.kr'],
  [/나라장터|g2b/i, 'https://www.g2b.go.kr'],
  [/워크넷|work\.go\.kr/i, 'https://www.work.go.kr'],
  [/국민건강보험|건보|nhis/i, 'https://www.nhis.or.kr'],
  [/우체국|epost/i, 'https://www.epost.go.kr'],
  [/교육부|moe\.go\.kr/i, 'https://www.moe.go.kr'],
  [/서울시|seoul\.go\.kr/i, 'https://www.seoul.go.kr'],
  [/kdi|한국개발연구원/i, 'https://www.kdi.re.kr'],
]

module.exports = function attachAI(app, APP_ROOT, OFFLINE) {
  const SETTINGS = path.join(APP_ROOT, 'data', 'settings.json')
  const readSettings = () => { try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')) } catch (_) { return {} } }
  const writeSettings = s => { fs.mkdirSync(path.dirname(SETTINGS), { recursive: true }); fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2)) }
  const PUBLIC = process.env.GUARDIANS_PUBLIC === '1'
  let reqKey = ''   // 공개 모드: 요청마다 헤더로 받은 키 (서버에 저장하지 않음)
  const getKey = () => process.env.ANTHROPIC_API_KEY || (PUBLIC ? reqKey : readSettings().anthropicKey) || ''
  const mask = k => k ? k.slice(0, 10) + '…' + k.slice(-4) : ''

  async function status() {
    const key = getKey()
    if (process.env.GUARDIANS_AI_MOCK === '1') return { enabled: true, mock: true, model: MODEL, keyMasked: 'mock', reason: '시험용 모의 응답' }
    if (!key) return { enabled: false, reason: 'API 키가 없습니다. 오른쪽 위 AI 설정에서 입력하세요.' }
    const net = await OFFLINE.netStatus().catch(() => ({ online: true }))
    if (!net.online) return { enabled: false, reason: '폐쇄망(인터넷 없음)에서는 AI 보조를 쓸 수 없습니다. 검사는 그대로 됩니다.', keyMasked: mask(key) }
    return { enabled: true, model: MODEL, keyMasked: mask(key) }
  }

  // ── Claude 호출 ──
  async function ask(system, content, { maxTokens = 1200, json = false, keyOverride = null } = {}) {
    if (process.env.GUARDIANS_AI_MOCK === '1') return mock(system, content, json)
    const key = keyOverride || getKey(); if (!key) throw new Error('API 키 없음')
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 60000)
    const r = await fetch(API, { method: 'POST', signal: ctl.signal, headers: Object.assign({ 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' }, /^sk-ant-api/.test(key) ? { 'x-api-key': key } : { Authorization: 'Bearer ' + key }),
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }) })
    clearTimeout(t)
    const j = await r.json()
    if (!r.ok) throw new Error(j.error?.message || `API ${r.status}`)
    const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
    if (!json) return text
    const s = text.replace(/```json|```/g, '').trim()
    try { return JSON.parse(s) } catch (_) { const m = s.match(/[\[{][\s\S]*[\]}]/); if (m) return JSON.parse(m[0]); throw new Error('JSON 파싱 실패: ' + s.slice(0, 80)) }
  }

  // 시험용 모의 응답 (키 없이 화면 흐름 확인용, GUARDIANS_AI_MOCK=1)
  function mock(system, content, json) {
    const txt = typeof content === 'string' ? content : JSON.stringify(content)
    if (/빈칸/.test(system)) return json ? { fills: [{ i: 0, text: '2025년 분기별 민원 처리 건수 그래프' }] } : '모의'
    if (/요약/.test(system)) return json ? { summary: ['접근성 위반 5건 중 치명적 3건은 이미지 대체 텍스트·버튼 이름·입력 레이블 누락입니다.', '오탈자 2건, 깨진 링크 1건이 있어 이용자 신뢰에 영향을 줍니다.', '치명적 3건은 코드 3줄 수정으로 해결 가능하며 개발사 전달 시 하루 안에 조치할 수 있습니다.'], actions: ['이미지 alt 속성 추가 (KWCAG 1)', '빈 버튼에 aria-label 추가 (KWCAG 33)', '입력 칸 label 연결 (KWCAG 29)'], email: '안녕하세요, 웹 품질 검사 결과 접근성 위반 5건이 확인되어 수정을 요청드립니다. 첨부 결과서의 "어떻게" 항목에 수정 코드가 있습니다. 치명적 3건은 이번 주 내 반영 부탁드립니다.' } : '모의'
    if (/지시/.test(system)) return json ? { url: 'https://www.gov.kr', checks: { checkLinks: true, checkSpelling: false, checkKRDS: true, checkW3C: false }, scanMode: 'expert', schedule: { freq: 'weekly', weekday: 1, time: '09:00' }, report: 'pptx', reply: '정부24를 접근성·링크·KRDS로 검사하고 매주 월요일 09:00 예약을 등록합니다.' } : '모의'
    return json ? {} : '모의'
  }

  // ── 페이지 이미지 가져오기 (alt 생성용) ──
  async function fetchImage(pageUrl, src) {
    try {
      const u = new URL(src, pageUrl).href
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000)
      const r = await fetch(u, { signal: ctl.signal }); clearTimeout(t)
      if (!r.ok) return null
      const ct = (r.headers.get('content-type') || '').split(';')[0]
      if (!/^image\/(png|jpeg|gif|webp)$/.test(ct)) return null
      const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 4 * 1024 * 1024) return null
      return { media_type: ct, data: buf.toString('base64') }
    } catch (_) { return null }
  }
  const attr = (html, name) => { const m = String(html || '').match(new RegExp('\\s' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i')); return m ? (m[2] ?? m[3] ?? m[4]) : null }

  // ── A. 빈칸 채움 ──
  // items: [{ i, ruleId, html, ctx, after, target }]
  async function fill(pageUrl, pageTitle, items) {
    const SYS = `너는 한국 정부 웹사이트 접근성 담당자를 돕는 보조자다. 검사 도구가 만든 수정 코드의 빈칸 [ ] 안에 들어갈 "문장"만 채운다. 코드 구조는 바꾸지 않는다.
규칙: 한국어, 간결(대체 텍스트 15자 내외, 레이블 2~6자, 링크 목적 10자 내외), 존댓말 아님, 마침표 없음. 이미지가 장식용으로 보이면 빈 문자열 "".
반드시 JSON만 출력: {"fills":[{"i":번호,"text":"채울 문장"}]}`
    const content = [{ type: 'text', text: `페이지: ${pageTitle || ''} (${pageUrl})\n아래 각 항목의 [ ] 빈칸에 들어갈 문장을 정하라.\n` }]
    for (const it of items) {
      let line = `\n[항목 ${it.i}] 규칙 ${it.ruleId}\n요소: ${String(it.html || '').slice(0, 300)}\n주변: ${String(it.ctx || '').replace(/\s+/g, ' ').slice(0, 400)}\n수정안: ${String(it.after || '').slice(0, 300)}`
      content.push({ type: 'text', text: line })
      if (/image-alt|input-image-alt/.test(it.ruleId)) {
        const src = attr(it.html, 'src'); const img = src ? await fetchImage(pageUrl, src) : null
        if (img) content.push({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } })
        else content.push({ type: 'text', text: '(이미지를 가져오지 못함 — 파일명과 주변 문맥으로 추정)' })
      }
    }
    const r = await ask(SYS, content, { json: true, maxTokens: 800 })
    const fills = (r && r.fills) || []
    return items.map(it => {
      const f = fills.find(x => Number(x.i) === Number(it.i)); if (!f) return { i: it.i, filled: null }
      const text = String(f.text ?? '').trim()
      const filled = String(it.after || '').replace(/\[[^\]]*\]/, text)   // 첫 빈칸
      return { i: it.i, text, filled }
    })
  }

  // ── C. 요약·전달문 ──
  async function summary(result, opts = {}) {
    const SYS = `너는 한국 공공기관 웹 품질 담당자를 돕는 보조자다. 검사 결과를 요약하고 전달문을 쓴다. 검사 결과의 사실을 바꾸거나 추가하지 않는다. 숫자는 주어진 값만 쓴다.
출력 JSON: {"summary":["한 줄","한 줄","한 줄"],"actions":["우선 조치 1","2","3"],"email":"개발사(또는 담당 부서) 전달 메일 본문 6~8문장, 존댓말"}`
    const s = result.summary || {}, vs = (result.violations || []).slice(0, 25)
    const text = `페이지: ${result.pageTitle || ''} (${result.url})
접근성 점수 ${result.score}점 · 위반 ${s.violations} (치명 ${s.impactCounts?.critical || 0}, 심각 ${s.impactCounts?.serious || 0}, 보통 ${s.impactCounts?.moderate || 0}, 경미 ${s.impactCounts?.minor || 0}) · 통과 ${s.passes}
${result.links ? `깨진 링크 ${(result.links.dead || []).length}건 · ` : ''}${result.spelling ? `오탈자 ${result.spelling.totalIssues ?? 0}건 · ` : ''}${result.krds ? `KRDS 미준수 ${result.krds.failed}건 · ` : ''}${result.w3c ? `HTML 오류 ${result.w3c.errorCount}건` : ''}
위반 목록:
${vs.map(v => `- [${v.impact}] ${v.kwcag ? 'KWCAG ' + v.kwcag.no + ' ' : ''}${v.help} (${v.id}, 요소 ${v.nodes?.length || 0}개)${v.fix ? ' — 해결: ' + v.fix.how : ''}`).join('\n')}
수신자: ${opts.audience || '개발사'} · 기관: ${opts.org || '(기관명)'}`
    return ask(SYS, text, { json: true, maxTokens: 1000 })
  }

  // ── D. 자연어 지시 해석 ──
  async function command(text) {
    let url = null
    for (const [re, u] of ALIASES) if (re.test(text)) { url = u; break }
    const m = text.match(/https?:\/\/[^\s]+|(?:[a-z0-9-]+\.)+(?:go\.kr|or\.kr|kr|com|net|org)(?:\/\S*)?/i)
    if (!url && m) url = /^https?:/i.test(m[0]) ? m[0] : 'https://' + m[0]
    const SYS = `너는 웹 품질 검사 도구의 명령 해석기다. 사용자의 한국어 지시를 아래 JSON으로만 바꾼다. 모르는 값은 null.
{"url":"검사할 주소 또는 null","checks":{"checkLinks":bool,"checkSpelling":bool,"checkKRDS":bool,"checkW3C":bool},"scanMode":"expert|simple","schedule":{"freq":"daily|weekly|hourly","weekday":0-6,"time":"HH:MM"} 또는 null,"report":"pptx|excel|html|null","reply":"사용자에게 할 한 문장 확인 멘트"}
기본값: checks는 접근성 외에 언급된 것만 true(언급 없으면 링크 true, 나머지 false), scanMode expert. "매주 월요일"→weekly weekday 1. 주소가 제공되면 그대로 쓴다.`
    const r = await ask(SYS, `지시: ${text}\n${url ? `주소(별칭표로 확정): ${url}` : ''}`, { json: true, maxTokens: 400 })
    if (url) r.url = url
    r.checks = Object.assign({ checkLinks: true, checkSpelling: false, checkKRDS: false, checkW3C: false }, r.checks || {})
    return r
  }

  // ── API ──
  app.use('/api/ai', (req, res, next) => { reqKey = PUBLIC ? String(req.headers['x-anthropic-key'] || '') : ''; next() })
  app.get('/api/ai/status', async (req, res) => { const s = await status(); if (PUBLIC) { s.public = true; if (!s.enabled && !reqKey) s.reason = '공개 서비스에서는 키를 서버에 저장하지 않습니다. 이 브라우저에만 저장됩니다 — AI 설정에서 입력하세요.' } res.json(s) })
  app.post('/api/ai/settings', (req, res) => {
    if (PUBLIC) return res.json({ ok: true, public: true, keyMasked: '' })   // 서버 저장 안 함 (브라우저 localStorage 사용)
    const key = String((req.body || {}).anthropicKey || '').trim()
    const s = readSettings(); if (key) s.anthropicKey = key; else delete s.anthropicKey
    writeSettings(s); res.json({ ok: true, keyMasked: mask(getKey()) })
  })
  app.post('/api/ai/test', async (req, res) => {
    try { const k = String((req.body || {}).anthropicKey || '').trim() || null; const t = await ask('한 단어로만 답하라.', '연결 확인. "정상"이라고만 답해.', { maxTokens: 10, keyOverride: k }); res.json({ ok: true, reply: t }) }
    catch (e) { res.status(400).json({ ok: false, error: e.message }) }
  })
  app.post('/api/ai/fill', async (req, res) => {
    try { const { pageUrl, pageTitle, items } = req.body || {}; if (!items?.length) return res.status(400).json({ error: '항목 없음' })
      res.json({ ok: true, fills: await fill(pageUrl, pageTitle, items.slice(0, 12)) }) }
    catch (e) { res.status(500).json({ ok: false, error: e.message }) }
  })
  app.post('/api/ai/summary', async (req, res) => {
    try { const { result, audience, org } = req.body || {}; if (!result) return res.status(400).json({ error: '결과 없음' })
      res.json({ ok: true, ...(await summary(result, { audience, org })) }) }
    catch (e) { res.status(500).json({ ok: false, error: e.message }) }
  })
  app.post('/api/ai/command', async (req, res) => {
    try { const text = String((req.body || {}).text || '').trim(); if (!text) return res.status(400).json({ error: '지시 없음' })
      res.json({ ok: true, ...(await command(text)) }) }
    catch (e) { res.status(500).json({ ok: false, error: e.message }) }
  })
  app.get('/api/ai/aliases', (req, res) => res.json(ALIASES.map(([re, u]) => ({ pattern: re.source, url: u }))))
  console.log(`[AI] 보조 모듈 준비 · 모델 ${MODEL} · 키 ${getKey() ? '있음' : '없음'}`)
  return { status, fill, summary, command }
}
