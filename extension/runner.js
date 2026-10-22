// runner.js — 페이지 안에서 실행됩니다 (axe.min.js가 먼저 주입됨)
// 반환값: { ok, url, title, summary, violations[] } — 팝업이 표시
(async () => {
  try {
    if (!window.axe) return { ok: false, error: 'axe-core를 불러오지 못했습니다.' }
    const mode = window.__guardiansMode || 'expert'
    const SIMPLE = ['image-alt','input-image-alt','button-name','link-name','label','document-title','html-has-lang',
      'color-contrast','skip-link','heading-order','list','frame-title','duplicate-id-aria','meta-viewport','video-caption']
    const opts = mode === 'simple'
      ? { runOnly: { type: 'rule', values: SIMPLE } }
      : { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'best-practice'] } }
    const r = await window.axe.run(document, opts)

    // 점수 — 가디언즈 서버와 같은 산식
    const ic = { critical: 0, serious: 0, moderate: 0, minor: 0 }
    r.violations.forEach(v => { if (ic[v.impact] !== undefined) ic[v.impact]++ })
    const total = r.violations.length + r.passes.length
    const score = total > 0 ? Math.max(0, 100 - (ic.critical*15 + ic.serious*10 + ic.moderate*5 + ic.minor*2)) : null   // 가디언즈 v6.0 산식과 동일

    // 요소 강조용: 위반 요소에 표시 속성 부여
    document.querySelectorAll('[data-guardians-hit]').forEach(el => el.removeAttribute('data-guardians-hit'))
    const violations = r.violations.map(v => ({
      id: v.id, impact: v.impact, help: v.help, description: v.description, helpUrl: v.helpUrl, tags: v.tags,
      nodes: v.nodes.slice(0, 20).map(n => {
        let rect = null
        try {
          const el = document.querySelector(n.target[0])
          if (el) { el.setAttribute('data-guardians-hit', v.impact); const b = el.getBoundingClientRect(); rect = { x: b.x, y: b.y, w: b.width, h: b.height } }
        } catch (_) {}
        const data = (n.any && n.any[0] && n.any[0].data) || null
        const sug = (window.GuardiansSuggest ? window.GuardiansSuggest.suggest(v.id, n.html, data) : null)
        return { target: n.target[0], html: (n.html || '').slice(0, 300), summary: n.failureSummary || '', rect, suggest: sug }
      })
    }))
    return {
      ok: true, url: location.href, title: document.title, mode, axe: window.axe.version, at: new Date().toISOString(),
      summary: { score, violations: r.violations.length, passes: r.passes.length, incomplete: r.incomplete.length, impact: ic },
      violations,
    }
  } catch (e) { return { ok: false, error: e.message } }
})()
