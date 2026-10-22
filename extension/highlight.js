// highlight.js — 위반 요소에 빨강/주황 테두리와 규칙 라벨을 씌웁니다. 다시 실행하면 제거됩니다.
(() => {
  const ID = 'guardians-hl-style'
  const on = !document.getElementById(ID)
  document.getElementById(ID)?.remove()
  document.querySelectorAll('.guardians-hl-tag').forEach(e => e.remove())
  if (!on) return { on: false }
  const st = document.createElement('style'); st.id = ID
  st.textContent = `
    [data-guardians-hit]{outline:3px solid #ef6253!important;outline-offset:2px!important;box-shadow:0 0 0 6px rgba(239,98,83,.18)!important}
    [data-guardians-hit="moderate"],[data-guardians-hit="minor"]{outline-color:#f0a34d!important;box-shadow:0 0 0 6px rgba(240,163,77,.18)!important}
    .guardians-hl-tag{position:absolute;z-index:2147483647;font:700 11px/1.4 Pretendard,"Malgun Gothic",sans-serif;color:#fff;background:#ef6253;padding:1px 6px;border-radius:4px;pointer-events:none;white-space:nowrap}
    .guardians-hl-tag.moderate,.guardians-hl-tag.minor{background:#f0a34d}`;
  ;(document.head || document.documentElement).appendChild(st);
  const labels = window.__guardiansLabels || {}
  document.querySelectorAll('[data-guardians-hit]').forEach(el => {
    const r = el.getBoundingClientRect(); if (!r.width && !r.height) return
    const t = document.createElement('div'); t.className = 'guardians-hl-tag ' + el.getAttribute('data-guardians-hit')
    t.textContent = labels[el.getAttribute('data-guardians-rule') || ''] || (el.getAttribute('data-guardians-hit') === 'critical' ? '치명적' : el.getAttribute('data-guardians-hit') === 'serious' ? '심각' : el.getAttribute('data-guardians-hit') === 'moderate' ? '보통' : '경미')
    t.style.left = (window.scrollX + r.left) + 'px'; t.style.top = (window.scrollY + r.top - 18) + 'px'
    ;(document.body || document.documentElement).appendChild(t);
  })
  return { on: true, count: document.querySelectorAll('[data-guardians-hit]').length }
})()
