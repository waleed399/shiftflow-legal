// Week roster — shift slots down the side, days across the top, grouped by
// department. Each cell is one shift on one day: who is on it, how close it is
// to full, and a click straight into the shift modal to change it.
//
// ── Why this shape ──────────────────────────────────────────────────────────
// The previous version put workers down the side and, in every worker × day
// cell, a pill for every shift that worker could take. That grows as
// workers × days × shifts: ten workers, seven days and six shift times is ~420
// individually clickable pills with nothing to say which one matters. It also
// competed with the day roster, which already does shifts × workers well for a
// single day.
//
// Turning the matrix on its side makes the cell count shifts × days — around
// forty — and, crucially, it stops growing when the org hires. It is also the
// shape a schedule takes when it is printed and put on a wall.
//
// Assignment is deliberately NOT done inline here. Clicking a cell opens the
// shift modal, so the manager makes one decision about one shift instead of
// choosing among hundreds of pills at once.
//
// Public surface:
//   renderWeekView

import { state } from './state.js'
import { DAYS, isSameDay, toYMD, esc, getInitials, applyAvatars } from './utils.js'
import { t } from './i18n.js'
import {
  getDeptColor,
  getWeekViewDays,
  STATUS_COLORS,
  applyShiftFilters,
} from './shifts.js'
import { renderFilterBar } from './shiftsFilterBar.js'

// Avatars shown in a cell before collapsing the rest into a "+n" chip.
const MAX_FACES = 4

export async function renderWeekView() {
  const key = toYMD(state.currentWeek)
  const el  = document.getElementById('shifts-content')
  const allActive = (state.shiftsCache[key] || []).filter(s => s.status !== 'CANCELLED')

  renderFilterBar(allActive)
  const shifts = applyShiftFilters(allActive)

  if (shifts.length === 0) {
    el.innerHTML = `<div class="empty-state"><p>${t('shifts.noShiftsWeek')}</p></div>`
    return
  }

  const weekDays = getWeekViewDays()
  const today    = new Date()

  // ── Rows: one per (department, time slot) ────────────────────────────────
  // Shifts carry no template object here, so the slot IS its time range. Two
  // shifts at 07:00–15:00 in the same department on different days are the
  // same row, which is what a manager means by "the morning shift".
  const depts = new Map()   // deptId -> { name, color, slots: Map(slotKey -> row) }
  for (const s of shifts) {
    const deptId = s.department?.id || '__none'
    if (!depts.has(deptId)) {
      depts.set(deptId, {
        name:  s.department?.name || t('shifts.noDepartment'),
        color: getDeptColor(s.department?.id),
        slots: new Map(),
      })
    }
    const slotKey = `${s.startTime}-${s.endTime}`
    const slots   = depts.get(deptId).slots
    if (!slots.has(slotKey)) {
      slots.set(slotKey, { start: s.startTime, end: s.endTime, byDay: new Map() })
    }
    // Same slot twice on one day (a duplicate shift) — keep both so neither
    // silently disappears from the week.
    const byDay = slots.get(slotKey).byDay
    const ymd   = s.date.substring(0, 10)
    if (!byDay.has(ymd)) byDay.set(ymd, [])
    byDay.get(ymd).push(s)
  }

  // ── Per-day totals for the header ────────────────────────────────────────
  const dayTotals = new Map()
  for (const { ymd } of weekDays) dayTotals.set(ymd, { assigned: 0, required: 0 })
  for (const s of shifts) {
    const bucket = dayTotals.get(s.date.substring(0, 10))
    if (!bucket) continue
    bucket.assigned += s.assignments?.length || 0
    bucket.required += s.requiredWorkers || 0
  }

  const stateOf = (assigned, required) =>
    required === 0 ? 'none' : assigned === 0 ? 'short' : assigned < required ? 'thin' : 'ok'

  const dayHeaders = weekDays.map(({ date, ymd }) => {
    const isToday = isSameDay(date, today)
    const { assigned, required } = dayTotals.get(ymd)
    const pct = required > 0 ? Math.min(100, Math.round(assigned / required * 100)) : 0
    return `<th class="wv-day-th wv-state-${stateOf(assigned, required)}${isToday ? ' wv-today' : ''}">
      <div class="wv-day-name">${DAYS[date.getDay()]}</div>
      <div class="wv-day-num">${date.getDate()}</div>
      ${required > 0
        ? `<div class="wv-day-meter"><i style="width:${pct}%"></i></div>
           <div class="wv-day-cov">${assigned}/${required}</div>`
        : '<div class="wv-day-cov wv-day-cov-none">—</div>'}
    </th>`
  }).join('')

  // ── Cells ────────────────────────────────────────────────────────────────
  function cell(dayShifts) {
    if (!dayShifts || dayShifts.length === 0) {
      return '<td class="wv-cell wv-cell-nil"></td>'
    }
    return dayShifts.map(s => {
      const assigned = s.assignments || []
      const required = s.requiredWorkers || 0
      const cellState = stateOf(assigned.length, required)
      const statusColor = STATUS_COLORS[s.status] || '#94a3b8'

      const faces = assigned.slice(0, MAX_FACES).map(a => `
        <span class="wv-face" data-avatar="${esc(a.worker?.avatarUrl || '')}"
              title="${esc(a.worker?.name || '')}">${esc(getInitials(a.worker?.name || '?'))}</span>`).join('')
      const overflow = assigned.length > MAX_FACES
        ? `<span class="wv-face wv-face-more">+${assigned.length - MAX_FACES}</span>` : ''
      // An empty slot needs a target of its own, or a fully unstaffed shift
      // would be a blank cell that does not look clickable.
      const empty = assigned.length === 0
        ? `<span class="wv-face wv-face-empty">+</span>` : ''

      return `<td class="wv-cell wv-state-${cellState}"
                  onclick="openShiftModal('${s.id}')" role="button" tabindex="0"
                  title="${esc(`${s.startTime.substring(0,5)}–${s.endTime.substring(0,5)}`)}">
        <div class="wv-cell-inner">
          <div class="wv-faces">${faces}${overflow}${empty}</div>
          <div class="wv-cell-foot">
            <span class="wv-cell-cov">${assigned.length}/${required}</span>
            <span class="wv-cell-status" style="background:${statusColor}"></span>
          </div>
        </div>
      </td>`
    }).join('')
  }

  const colSpan = weekDays.length + 1

  const bodyRows = [...depts.entries()]
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(([, dept]) => {
      const band = `<tr class="wv-dept-band"><td colspan="${colSpan}" class="wv-dept-label">
        <span class="wv-dept-stripe" style="background:${dept.color}"></span>
        <span style="color:${dept.color}">${esc(dept.name)}</span>
      </td></tr>`

      const rows = [...dept.slots.values()]
        .sort((a, b) => a.start.localeCompare(b.start))
        .map(slot => {
          const cells = weekDays.map(({ ymd }) => cell(slot.byDay.get(ymd))).join('')
          return `<tr class="wv-slot-row">
            <td class="wv-slot-cell">
              <div class="wv-slot-time">${esc(slot.start.substring(0, 5))}</div>
              <div class="wv-slot-end">${esc(slot.end.substring(0, 5))}</div>
            </td>
            ${cells}
          </tr>`
        }).join('')

      return band + rows
    }).join('')

  el.innerHTML = `
    <div class="wv-outer">
      <div class="wv-scroll">
        <table class="wv-table">
          <thead><tr>
            <th class="wv-corner">${t('shifts.weekSlotHeader')}</th>
            ${dayHeaders}
          </tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    </div>`
  applyAvatars(el)
}
