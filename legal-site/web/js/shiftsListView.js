// List view of the currently selected day — grouped by department, each
// shift rendered as a clickable row that opens the shift-edit modal.
//
// Public surface:
//   renderShiftsForDay     — paint the day's shifts into #shifts-content
//   renderFilterBar        — paint the chip bar above the list

import { state } from './state.js'
import { toYMD, fmtDate, esc } from './utils.js'
import { t } from './i18n.js'
import {
  getDeptColor,
  STATUS_COLORS,
  applyShiftFilters,
  getActiveFilters,
} from './shifts.js'
import { updateActionBar } from './shiftsActions.js'

export function renderShiftsForDay() {
  const key = toYMD(state.currentWeek)
  const all = state.shiftsCache[key] || []
  const selectedYMD = toYMD(state.selectedDay)
  const dayShifts = all
    .filter(s => s.date.substring(0, 10) === selectedYMD && s.status !== 'CANCELLED')
    .sort((a, b) => a.startTime.localeCompare(b.startTime))

  const el = document.getElementById('shifts-content')

  renderFilterBar(dayShifts)

  if (dayShifts.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <p>${t('shifts.noShiftsForDay', { date: fmtDate(state.selectedDay) })}</p>
        <button class="btn btn-success" style="margin-top:14px" onclick="openCreateShiftModal()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          ${t('shifts.createFirst')}
        </button>
      </div>`
    updateActionBar()
    return
  }

  const filteredShifts = applyShiftFilters(dayShifts)

  const groupMap = new Map()
  filteredShifts.forEach(s => {
    const deptId = s.department?.id || 'unknown'
    if (!groupMap.has(deptId)) groupMap.set(deptId, { dept: s.department, shifts: [] })
    groupMap.get(deptId).shifts.push(s)
  })

  if (filteredShifts.length === 0) {
    el.innerHTML = `
      <div class="empty-state" style="padding-top:40px">
        <p style="color:var(--muted)">${t('shifts.filterNoMatch')}</p>
        <button class="btn-link" style="margin-top:8px" onclick="clearShiftFilters()">${t('shifts.filterClearLink')}</button>
      </div>`
    updateActionBar()
    return
  }

  const groups = [...groupMap.entries()]
  el.innerHTML = renderDayStats(dayShifts) + `<div class="shifts-grid">${groups.map(([deptId, g], i) => deptSection(g, getDeptColor(deptId), i)).join('')}</div>`
  updateActionBar()
}

export function renderFilterBar(dayShifts) {
  const bar = document.getElementById('shift-filter-bar')
  if (!bar) return
  if (dayShifts.length === 0) { bar.style.display = 'none'; return }
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
}

function renderDayStats(dayShifts) {
  const totalAssigned = dayShifts.reduce((s, sh) => s + (sh.assignments?.length || 0), 0)
  const totalRequired = dayShifts.reduce((s, sh) => s + (sh.requiredWorkers || 0), 0)
  const pct = totalRequired > 0 ? Math.round(totalAssigned / totalRequired * 100) : 100
  const coverageColor = pct >= 100 ? '#059669' : pct >= 60 ? '#d97706' : '#dc2626'
  return `
    <div class="day-stats">
      <div class="stat-chip">
        <span class="stat-chip-num">${dayShifts.length}</span>
        <span class="stat-chip-label">${t('shifts.shiftsToday')}</span>
      </div>
      <div class="stat-chip">
        <span class="stat-chip-num">${totalAssigned}</span>
        <span class="stat-chip-label">${t('shifts.workersAssigned')}</span>
      </div>
      <div class="stat-chip">
        <span class="stat-chip-num" style="color:${coverageColor}">${pct}%</span>
        <span class="stat-chip-label">${t('shifts.coverage')}</span>
      </div>
    </div>`
}

function deptSection(group, color, index = 0) {
  const totalAssigned = group.shifts.reduce((sum, s) => sum + (s.assignments?.length || 0), 0)
  const totalRequired = group.shifts.reduce((sum, s) => sum + (s.requiredWorkers || 0), 0)
  const badgeColor = totalAssigned === 0 ? '#dc2626' : totalAssigned < totalRequired ? '#d97706' : color
  return `
    <div class="dept-section" style="animation-delay:${index * 0.06}s">
      <div class="dept-header" style="background:${color}10">
        <div class="dept-stripe" style="background:${color}"></div>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        <span class="dept-name" style="color:${color}">${esc(group.dept?.name || t('common.unknown'))}</span>
        <span class="dept-worker-badge" style="background:${badgeColor}22;color:${badgeColor}">${t('shifts.workerCountSlash', { assigned: totalAssigned, required: totalRequired })}</span>
      </div>
      ${group.shifts.map(s => shiftRow(s, color)).join('')}
    </div>`
}

function shiftRow(shift, color) {
  const assigned = shift.assignments || []
  const count    = assigned.length
  const required = shift.requiredWorkers || 1
  const pct      = Math.min(100, Math.round(count / required * 100))
  const workerColor = count === 0 ? '#dc2626' : count < required ? '#d97706' : '#059669'
  const workerText  = count === 0 ? t('shifts.noWorkers') : `${count} / ${required}`
  const understaffed = shift.understaffed ? `<span class="understaffed-badge">${t('shifts.understaffed')}</span>` : ''
  const borderColor  = STATUS_COLORS[shift.status] || '#94a3b8'
  const start = shift.startTime.substring(0, 5)
  const end   = shift.endTime.substring(0, 5)
  return `
    <div class="dept-shift-row" style="border-left:3px solid ${borderColor}" onclick="openShiftModal('${shift.id}')" role="button" tabindex="0">
      <div class="shift-time-col">
        <span class="shift-time">${start}</span>
        <div class="shift-time-sep"></div>
        <span class="shift-time">${end}</span>
      </div>
      <div class="shift-row-body">
        <div class="shift-row-top">
          <span class="status-pill status-${shift.status}">${t(`shifts.status.${shift.status}`)}</span>
          ${understaffed}
        </div>
        <div class="shift-coverage">
          <div class="coverage-bar">
            <div class="coverage-fill" style="width:${pct}%;background:${workerColor}"></div>
          </div>
          <span class="coverage-text" style="color:${workerColor}">${workerText}</span>
        </div>
      </div>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </div>`
}
