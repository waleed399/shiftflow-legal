import { state, ensureOrgWorkers } from './state.js'
import { esc, getInitials, applyAvatars, toYMD } from './utils.js'

let _allWorkers = []
let _counts = null

export async function renderWorkers() {
  const el = document.getElementById('workers-content')
  el.innerHTML = '<div class="loader-inline"><div class="spinner"></div></div>'

  _counts = null
  const workers = await ensureOrgWorkers()
  _allWorkers = workers
  _renderList(workers)
}

function getShiftCounts() {
  if (_counts) return _counts
  const key = toYMD(state.currentWeek)
  const shifts = state.shiftsCache[key] || []
  _counts = new Map()
  shifts.forEach(s => {
    ;(s.assignments || []).forEach(a => {
      const id = a.worker?.id
      if (id) _counts.set(id, (_counts.get(id) || 0) + 1)
    })
  })
  return _counts
}

function _renderList(workers) {
  const el = document.getElementById('workers-content')

  if (!workers.length) {
    el.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        <p>No workers yet</p>
        <p style="font-size:0.8rem;margin-top:6px;max-width:260px;margin-left:auto;margin-right:auto">Share your invite code from the <strong>Profile</strong> page so workers can join your organisation.</p>
      </div>`
    return
  }

  const counts = getShiftCounts()
  el.innerHTML = `
    <div class="workers-toolbar">
      <span class="workers-count">${workers.length} worker${workers.length !== 1 ? 's' : ''}</span>
      <input class="workers-search" id="workers-search" placeholder="Search by name or email…" oninput="filterWorkers(this.value)">
    </div>
    <div class="workers-grid" id="workers-grid">
      ${workers.map(w => _card(w, counts.get(w.id) || 0)).join('')}
    </div>`
  applyAvatars(el)
}

function _card(w, shiftCount) {
  const initials = esc(getInitials(w.name))
  const shiftLabel = shiftCount > 0
    ? `<span class="worker-card-shifts-badge">${shiftCount} shift${shiftCount !== 1 ? 's' : ''} this week</span>`
    : `<span class="worker-card-shifts-badge worker-card-shifts-none">No shifts this week</span>`
  return `
    <div class="worker-card">
      <div class="worker-card-avatar" data-avatar="${esc(w.avatarUrl || '')}">${initials}</div>
      <div class="worker-card-info">
        <div class="worker-card-name">${esc(w.name || '—')}</div>
        <div class="worker-card-email">${esc(w.email || '')}</div>
        ${shiftLabel}
      </div>
    </div>`
}

export function filterWorkers(query) {
  const q = query.toLowerCase().trim()
  const filtered = q
    ? _allWorkers.filter(w =>
        (w.name || '').toLowerCase().includes(q) ||
        (w.email || '').toLowerCase().includes(q))
    : _allWorkers

  const counts = getShiftCounts()
  const grid = document.getElementById('workers-grid')
  if (!grid) return
  if (!filtered.length) {
    grid.innerHTML = '<p class="workers-empty-filter">No workers match your search</p>'
    return
  }
  grid.innerHTML = filtered.map(w => _card(w, counts.get(w.id) || 0)).join('')
  applyAvatars(grid)
}

window.filterWorkers = filterWorkers
