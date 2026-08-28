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
  row.style.display = (shown('shift-filter-bar') || shown('view-expand-btn') || shown('action-bar') || shown('focus-daybar') || shown('focus-weekbar')) ? 'flex' : 'none'
}

export function renderFilterBar(dayShifts) {
  const bar = document.getElementById('shift-filter-bar')
  if (!bar) return
  _lastShifts = dayShifts
  // Drop any menu portalled to <body> by the previous render — rebuilding the
  // bar cannot remove it, since it is no longer inside the bar.
  document.querySelectorAll('body > .filter-dd-menu').forEach(el => el.remove())
  if (dayShifts.length === 0) { bar.style.display = 'none'; syncFilterRow(); return }
  bar.style.display = ''

  const active = getActiveFilters()
  // Counted with the same three states applyShiftFilters uses, so a chip's
  // number is exactly what clicking it will show.
  const emptyCount = dayShifts.filter(s =>
    (s.requiredWorkers || 0) > 0 && (s.assignments?.length || 0) === 0).length
  const thinCount = dayShifts.filter(s => {
    const a = s.assignments?.length || 0
    const r = s.requiredWorkers || 0
    return r > 0 && a > 0 && a < r
  }).length
  const hasUnderstaffed = thinCount > 0
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
        ${t('shifts.filterUnderstaffed')}<span class="filter-chip-count">${thinCount}</span>
       </button>
       <div class="filter-divider"></div>`
    : ''

  const chips = [
    { key: 'needs_workers', label: t('shifts.filterNeedsWorkers'), color: '#ef4444',
      icon: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>` },
    { key: 'morning',       label: t('shifts.filterMorning'),      color: 'var(--navy)',
      icon: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="2" x2="12" y2="9"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/></svg>` },
    { key: 'afternoon',     label: t('shifts.filterAfternoon'),    color: 'var(--navy)',
      icon: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>` },
    { key: 'evening',       label: t('shifts.filterEvening'),      color: 'var(--navy)',
      icon: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>` },
  ].filter(({ key }) => key !== 'needs_workers' || emptyCount > 0)
   .map(({ key, label, color, icon }) =>
    `<button class="filter-chip ${active.has(key) ? 'active' : ''}" style="--chip-color:${color}" onclick="toggleShiftFilter('${key}')">
      ${icon}${label}${key === 'needs_workers' ? `<span class="filter-chip-count">${emptyCount}</span>` : ''}
     </button>`
  ).join('')

  // Departments are a picker, not a chip each. One chip per department meant
  // the bar grew with the org — a ten-department factory pushed every other
  // control off the end of a horizontally scrolling row — while a picker costs
  // one control no matter how many there are. Still multi-select, as the chips
  // were: the filter keys are unchanged.
  const chosen = depts.filter(d => active.has(`dept:${d.id}`))
  const deptLabel = chosen.length === 0
    ? t('shifts.filterAllDepts')
    : chosen.length === 1
      ? chosen[0].name
      : t('shifts.filterNDepts', { n: chosen.length })

  const deptPicker = depts.length > 1
    ? `<div class="filter-divider"></div>
       <div class="filter-dd">
         <button class="filter-chip filter-dd-btn ${chosen.length ? 'active' : ''}"
                 style="--chip-color:${chosen.length === 1 ? getDeptColor(chosen[0].id) : 'var(--navy)'}"
                 aria-expanded="${_deptMenuOpen}" onclick="toggleDeptMenu(event)">
           ${chosen.length === 1 ? `<span class="filter-dd-dot" style="background:${getDeptColor(chosen[0].id)}"></span>` : ''}
           ${esc(deptLabel)}
           <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
         </button>
         <div class="filter-dd-menu" onclick="event.stopPropagation()" ${_deptMenuOpen ? '' : 'hidden'}>
           <button class="filter-dd-item ${chosen.length === 0 ? 'on' : ''}" onclick="clearDeptFilters(); closeDeptMenu()">
             ${t('shifts.filterAllDepts')}
           </button>
           <div class="filter-dd-sep"></div>
           ${depts.map(d => `
             <button class="filter-dd-item ${active.has(`dept:${d.id}`) ? 'on' : ''}"
                     onclick="toggleShiftFilter('dept:${esc(d.id)}')">
               <span class="filter-dd-dot" style="background:${getDeptColor(d.id)}"></span>
               <span class="filter-dd-name">${esc(d.name)}</span>
               <span class="filter-dd-tick">✓</span>
             </button>`).join('')}
         </div>
       </div>`
    : ''

  bar.innerHTML = `<div class="filter-bar-scroll">${clearBtn}${understaffedChip}${chips}${deptPicker}</div>`
  positionDeptMenu()
  syncFilterRow()
}

/**
 * Places the menu under its button.
 *
 * The menu is position:fixed to escape the chip row's overflow-x clipping,
 * which means its coordinates are viewport-relative and CSS cannot derive them
 * from the button. Runs after every render, because the bar is rebuilt whenever
 * a filter changes and the button may have moved.
 */
function positionDeptMenu() {
  const btn  = document.querySelector('.filter-dd-btn')
  const menu = document.querySelector('.filter-dd-menu')
  if (!btn || !menu || menu.hidden) return

  const r = btn.getBoundingClientRect()

  // Moved to <body> before positioning, and this is not optional.
  //
  // position:fixed is relative to the viewport ONLY while no ancestor has a
  // transform, filter or will-change — any of those makes that ancestor the
  // containing block instead. #view-shifts carries `.view-enter`, whose
  // animation has `fill-mode: both`, so it keeps `transform: translateY(0)`
  // forever after the entrance finishes. The menu was being measured against
  // the viewport and painted relative to the view, landing low and to the side
  // by exactly the sidebar width and topbar height.
  //
  // Portalling sidesteps the whole class of problem rather than compensating
  // for this one ancestor.
  if (menu.parentElement !== document.body) document.body.appendChild(menu)

  menu.style.top = `${Math.round(r.bottom + 6)}px`

  // RTL anchors the menu's right edge to the button's, LTR its left.
  const rtl = getComputedStyle(document.documentElement).direction === 'rtl'
  if (rtl) {
    menu.style.right = `${Math.round(window.innerWidth - r.right)}px`
    menu.style.left = 'auto'
  } else {
    // Nudged back inside if the button sits near the right edge.
    const width = menu.offsetWidth || 200
    menu.style.left = `${Math.round(Math.min(r.left, window.innerWidth - width - 8))}px`
    menu.style.right = 'auto'
  }
}

// The bar is rebuilt on every filter change, so without remembering this the
// menu would slam shut on each pick — unusable for a multi-select.
let _deptMenuOpen = false

export function toggleDeptMenu(e) {
  e?.stopPropagation()
  _deptMenuOpen = !_deptMenuOpen
  _rerenderFilterBar()
}

export function closeDeptMenu() {
  if (!_deptMenuOpen) return
  _deptMenuOpen = false
  _rerenderFilterBar()
}

/** Re-render in place from the shifts the bar was last given. */
let _lastShifts = []
function _rerenderFilterBar() { renderFilterBar(_lastShifts) }

document.addEventListener('click', closeDeptMenu)
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDeptMenu() })

window.toggleDeptMenu = toggleDeptMenu
window.closeDeptMenu  = closeDeptMenu
