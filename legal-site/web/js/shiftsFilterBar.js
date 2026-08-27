// The filter chip bar above the day and week rosters, plus the row that holds
// it alongside the Expand button.
//
// This was shiftsListView.js. The list view it belonged to has been removed —
// the day roster shows the same information as a matrix, which is what a
// manager assigning people actually needs — but the filter bar outlived it,
// because department filtering is what trims the roster's worker columns.
//
// Public surface:
//   renderFilterBar  — paint the chip bar for a day's shifts
//   syncFilterRow    — show/hide the row that holds the chips and Expand

import { t } from './i18n.js'
import { esc } from './utils.js'
import { getDeptColor, getActiveFilters } from './shifts.js'

// The filter row holds three independent things — the focus-mode day nav, the
// scrolling chips and the Expand button — and any of them can be hidden alone. Show the row (and the
// dividing rule it carries) only when at least one of them is actually there.
export function syncFilterRow() {
  const row = document.getElementById('filter-row')
  if (!row) return
  const shown = (id) => {
    const el = document.getElementById(id)
    return !!el && el.style.display !== 'none'
  }
  row.style.display = (shown('shift-filter-bar') || shown('view-expand-btn') || shown('focus-daybar') || shown('focus-weekbar')) ? 'flex' : 'none'
}

export function renderFilterBar(dayShifts) {
  const bar = document.getElementById('shift-filter-bar')
  if (!bar) return
  if (dayShifts.length === 0) { bar.style.display = 'none'; syncFilterRow(); return }
  bar.style.display = ''

  const active = getActiveFilters()
  const hasUnderstaffed = dayShifts.some(s => (s.assignments?.length || 0) < (s.requiredWorkers || 0))
  const depts = []
  const seen = new Set()
  dayShifts.forEach(s => {
    if (s.department?.id && !seen.has(s.department.id)) {
      seen.add(s.department.id)
      depts.push(s.department)
    }
  })

  const clearBtn = active.size > 0
    ? `<button class="filter-chip filter-chip-clear" onclick="clearShiftFilters()">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        ${t('shifts.filterClear', { count: active.size })}
       </button>
       <div class="filter-divider"></div>`
    : ''

  const understaffedChip = hasUnderstaffed
    ? `<button class="filter-chip ${active.has('understaffed') ? 'active' : ''}" style="--chip-color:#f59e0b" onclick="toggleShiftFilter('understaffed')">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        ${t('shifts.filterUnderstaffed')}
       </button>
       <div class="filter-divider"></div>`
    : ''

  const chips = [
    { key: 'needs_workers', label: t('shifts.filterNeedsWorkers'), color: '#ef4444',
      icon: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>` },
    { key: 'morning',       label: t('shifts.filterMorning'),      color: '#f59e0b',
      icon: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="2" x2="12" y2="9"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/></svg>` },
    { key: 'afternoon',     label: t('shifts.filterAfternoon'),    color: '#3b82f6',
      icon: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>` },
    { key: 'evening',       label: t('shifts.filterEvening'),      color: '#8b5cf6',
      icon: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>` },
  ].map(({ key, label, color, icon }) =>
    `<button class="filter-chip ${active.has(key) ? 'active' : ''}" style="--chip-color:${color}" onclick="toggleShiftFilter('${key}')">
      ${icon}${label}
     </button>`
  ).join('')

  const deptChips = depts.length > 1
    ? `<div class="filter-divider"></div>` + depts.map(d =>
        `<button class="filter-chip ${active.has(`dept:${d.id}`) ? 'active' : ''}" style="--chip-color:${getDeptColor(d.id)}" onclick="toggleShiftFilter('dept:${esc(d.id)}')">
          ${esc(d.name)}
         </button>`
      ).join('')
    : ''

  bar.innerHTML = `<div class="filter-bar-scroll">${clearBtn}${understaffedChip}${chips}${deptChips}</div>`
  syncFilterRow()
}
