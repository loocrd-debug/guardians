// goto.js — 고른 위반 요소로 이동해 강조하고, 요소를 따라다니는 수정 제안 말풍선을 띄웁니다
(() => {
  const { sel, title, after, note } = window.__guardiansGoto || {}
  document.querySelectorAll('.guardians-tip, .guardians-ring').forEach(e => e.remove())
  if (window.__guardiansCleanup) { window.__guardiansCleanup(); window.__guardiansCleanup = null }
  let el = null; try { el = document.querySelector(sel) } catch (_) {}
  if (!el) return { ok: false }
  const esc = s => String(s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  const F = "Pretendard,-apple-system,'Malgun Gothic',sans-serif"

  // 강조 테두리 (fixed, 요소를 따라감)
  const ring = document.createElement('div'); ring.className = 'guardians-ring'
  Object.assign(ring.style, { position: 'fixed', zIndex: 2147483646, border: '3px solid #ef6253', borderRadius: '6px', boxShadow: '0 0 0 6px rgba(239,98,83,.18)', pointerEvents: 'none' })
  // 말풍선 (fixed)
  const tip = document.createElement('div'); tip.className = 'guardians-tip'
  tip.innerHTML = `<div style="font:700 13px/1.4 ${F};color:#222;margin-bottom:5px;padding-right:18px">${esc(title)}</div>` +
    (after ? `<div style="font:11px/1.4 ${F};color:#8c8c8c;margin-bottom:4px">이렇게 고치세요${note ? ' · ' + esc(note) : ''}</div><pre style="margin:0;padding:8px 10px;background:#f1faf5;border:1px solid #bfe8d0;border-radius:6px;font:11px/1.5 ui-monospace,Consolas,monospace;color:#222;white-space:pre-wrap;word-break:break-all;max-height:140px;overflow:auto">${esc(after)}</pre>` : '') +
    `<div style="margin-top:6px;font:10px ${F};color:#8c8c8c">가디언즈 · Esc 또는 다른 곳 클릭으로 닫기</div>` +
    `<button class="guardians-x" style="position:absolute;top:8px;right:8px;width:22px;height:22px;border:0;border-radius:11px;background:#f4f4f4;color:#555;font:14px/22px ${F};cursor:pointer;padding:0" aria-label="닫기">×</button>` +
    `<div class="guardians-arrow" style="position:absolute;width:12px;height:12px;background:#fff;border-left:1px solid #ebebeb;border-top:1px solid #ebebeb;transform:rotate(45deg)"></div>`
  Object.assign(tip.style, { position: 'fixed', zIndex: 2147483647, background: '#fff', border: '1px solid #ebebeb', borderRadius: '10px', padding: '12px 14px', boxShadow: '0 8px 24px rgba(0,0,0,.14)', width: 'min(360px, calc(100vw - 24px))', boxSizing: 'border-box' })
  ;(document.body || document.documentElement).append(ring, tip)

  const place = () => {
    const r = el.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight, M = 12
    Object.assign(ring.style, { left: (r.left - 4) + 'px', top: (r.top - 4) + 'px', width: (r.width + 8) + 'px', height: (r.height + 8) + 'px', display: (r.width || r.height) ? '' : 'none' })
    const tw = tip.offsetWidth, th = tip.offsetHeight
    const below = r.bottom + 12 + th <= vh - M, above = r.top - 12 - th >= M
    const top = below ? r.bottom + 12 : above ? r.top - 12 - th : Math.max(M, Math.min(vh - th - M, r.bottom + 12))
    let left = r.left; left = Math.max(M, Math.min(vw - tw - M, left))
    tip.style.top = top + 'px'; tip.style.left = left + 'px'
    // 화살표: 요소 중앙을 가리키되 말풍선 안에 머물게
    const ar = tip.querySelector('.guardians-arrow'); const ax = Math.max(14, Math.min(tw - 26, r.left + Math.min(r.width / 2, 40) - left - 6))
    if (below || !above) { ar.style.top = '-7px'; ar.style.bottom = ''; ar.style.borderLeft = '1px solid #ebebeb'; ar.style.borderTop = '1px solid #ebebeb'; ar.style.borderRight = '0'; ar.style.borderBottom = '0' }
    else { ar.style.bottom = '-7px'; ar.style.top = ''; ar.style.borderLeft = '0'; ar.style.borderTop = '0'; ar.style.borderRight = '1px solid #ebebeb'; ar.style.borderBottom = '1px solid #ebebeb' }
    ar.style.left = ax + 'px'
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
  place(); const raf = () => { place(); if (alive) requestAnimationFrame(raf) }; let alive = true; requestAnimationFrame(raf)
  const close = () => { alive = false; tip.remove(); ring.remove(); document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey, true); window.__guardiansCleanup = null }
  const onDown = e => { if (!tip.contains(e.target)) close() }
  const onKey = e => { if (e.key === 'Escape') close() }
  tip.querySelector('.guardians-x').onclick = close
  setTimeout(() => { document.addEventListener('mousedown', onDown, true); document.addEventListener('keydown', onKey, true) }, 300)
  window.__guardiansCleanup = close
  return { ok: true }
})()
