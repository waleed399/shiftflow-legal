// Week roster — a board of day columns. Each column holds that day's shifts
// grouped by department, in time order within each group. Click a card to
// open the shift.
//
// ── Why a board and not a matrix ────────────────────────────────────────────
// Two earlier shapes failed for the same underlying reason. Workers × days put
// a pill in every cell for every shift a worker could take, which grows as
// workers × days × shifts. Shift-slots × days fixed the growth but had to
// invent the rows: shifts carry no template here, so a "slot" was a time range,
// and an 07:00 shift on one day and an 08:00 shift on the next became two
// half-empty rows. Every day a slot did not run left an inert cell meaning
// "nothing scheduled" that read like "nothing wrong".
//
// A day column has no row identity to invent and no dead cells: a quiet day is
// simply a shorter column. It is also the shape a schedule takes when it is
// printed and stuck on a wall.
//
// Assignment stays out of here on purpose — a card opens the shift modal, so
// the manager makes one decision about one shift rather than choosing among
// hundreds of inline targets.
//
// Public surface:
//   renderWeekView

import { state } from './state.js'
import { DAYS, isSameDay, toYMD, esc, getInitials, applyAvatars } from './utils.js'
import { t } from './i18n.js'
import { getDeptColor, getWeekViewDays, applyShiftFilters } from './shifts.js'
import { renderFilterBar } from './shiftsFilterBar.js'

// Faces shown on a card before the rest collapse into a "+n" chip.
const MAX_FACES = 4

const coverageState = (assigned, required) =>
  required === 0 ? 'ok' : assigned === 0 ? 'short' : assigned < required ? 'thin' : 'ok'

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

  const byDay = new Map()
  for (const s of shifts) {
    const ymd = s.date.substring(0, 10)
    if (!byDay.has(ymd)) byDay.set(ymd, [])
    byDay.get(ymd).push(s)
  }

  const today = new Date()

  const columns = getWeekViewDays().map(({ date, ymd }) => {
    const dayShifts = (byDay.get(ymd) || []).slice()
      .sort((a, b) => a.startTime.localeCompare(b.startTime))

    const assigned = dayShifts.reduce((n, s) => n + (s.assignments?.length || 0), 0)
    const required = dayShifts.reduce((n, s) => n + (s.requiredWorkers || 0), 0)
    const dayState = coverageState(assigned, required)
    const pct      = required > 0 ? Math.min(100, Math.round(assigned / required * 100)) : 0

    const head = `
      <div class="wb-head wb-state-${dayState}${isSameDay(date, today) ? ' wb-today' : ''}">
        <div class="wb-day-name">${DAYS[date.getDay()]}</div>
        <div class="wb-day-num">${date.getDate()}</div>
        ${required > 0
          ? `<div class="wb-meter"><i style="width:${pct}%"></i></div>
             <div class="wb-day-cov">${assigned}/${required}</div>`
          : '<div class="wb-day-cov wb-day-cov-none">—</div>'}
      </div>`

    // Group the day's shifts by department. Departments are ordered by name so
    // the same one sits in the same place in every column, which is what makes
    // the board scannable across days as well as down a single day.
    const groups = new Map()
    for (const s of dayShifts) {
      const id = s.department?.id || '__none'
      if (!groups.has(id)) {
        groups.set(id, { name: s.department?.name || t('shifts.noDepartment'), color: getDeptColor(s.department?.id), shifts: [] })
      }
      groups.get(id).shifts.push(s)
    }
    const ordered = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))

    const card = (s) => {
      const list  = s.assignments || []
      const need  = s.requiredWorkers || 0
      const cs    = coverageState(list.length, need)
      const color = getDeptColor(s.department?.id)

      const faces = list.slice(0, MAX_FACES).map(a => `
        <span class="wb-face" data-avatar="${esc(a.worker?.avatarUrl || '')}"
              title="${esc(a.worker?.name || '')}">${esc(getInitials(a.worker?.name || '?'))}</span>`).join('')
      const more = list.length > MAX_FACES
        ? `<span class="wb-face wb-face-more">+${list.length - MAX_FACES}</span>` : ''
      // An unstaffed shift needs something to click at, or the card's busiest
      // half is simply blank and does not look actionable.
      const none = list.length === 0 ? '<span class="wb-face wb-face-empty">+</span>' : ''

      return `
        <button class="wb-card wb-state-${cs}${cs === 'short' ? ' wb-card-short' : ''}"
                style="--dept:${color}" onclick="openShiftModal('${s.id}')">
          <span class="wb-card-top">
            <span class="wb-time">${esc(s.startTime.substring(0, 5))}–${esc(s.endTime.substring(0, 5))}</span>
          </span>
          <span class="wb-card-bot">
            <span class="wb-faces">${faces}${more}${none}</span>
            <span class="wb-cov">${list.length}/${need}</span>
          </span>
        </button>`
    }

    const cards = ordered.map(g => `
      <div class="wb-group" style="--dept:${g.color};--dept-tint:${g.color}1c">
        <div class="wb-dept-head">${esc(g.name)}</div>
        ${g.shifts.map(card).join('')}
      </div>`).join('')

    return `
      <div class="wb-col">
        ${head}
        <div class="wb-stack">
          ${cards || `<div class="wb-empty">${t('shifts.dayEmpty')}</div>`}
        </div>
      </div>`
  }).join('')

  el.innerHTML = `
    <div class="wv-outer">
      <div class="wv-scroll">
        <div class="wb-board">${columns}</div>
      </div>
    </div>`
  applyAvatars(el)
}
