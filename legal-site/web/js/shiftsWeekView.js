// Week roster — a rota grid. Workers down the side, work days across the top,
// and each cell holds the hours that worker is actually assigned that day.
// Click an hours chip to open the shift.
//
// ── Why this shape ──────────────────────────────────────────────────────────
// The grid is read one row at a time: "what is Adem doing this week." That is
// the question a rota answers and the one a board of day columns could not —
// there, a worker's week was scattered across seven columns and had to be
// reassembled by eye.
//
// The old objection to workers × days was that it put a pill in every cell for
// every shift a worker COULD take, growing as workers × days × shifts. This
// grid only ever draws what is actually assigned, so a cell holds nought or one
// chip and usually nought. Rest days are blank on purpose: an empty cell in a
// rota already means "not working" and needs no glyph to say so.
//
// Assignment stays out of here, as it did in the board — a chip opens the shift
// modal. The day roster matrix is where a manager assigns.
//
// The cost of the shape is that a shift nobody is on belongs to no row and
// would simply vanish. The "open shifts" row at the foot carries them, so an
// unstaffed Tuesday morning is still visible from the week view.
//
// Public surface:
//   renderWeekView

import { state, ensureOrgWorkers } from './state.js'
import { DAYS, isSameDay, toYMD, esc, getInitials, applyAvatars } from './utils.js'
import { t } from './i18n.js'
import {
  getDeptColor, getWeekViewDays, applyShiftFilters,
  STATUS_COLORS, toMins, normEnd,
} from './shifts.js'
import { renderFilterBar } from './shiftsFilterBar.js'

const coverageState = (assigned, required) =>
  required === 0 ? 'ok' : assigned === 0 ? 'short' : assigned < required ? 'thin' : 'ok'

function fmtMins(mins) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

const hhmm = (s) => (s || '').substring(0, 5)

// The hours a worker actually works, which is not always the shift's own span:
// an assignment may carry a narrower block. Those are the hours the manager
// assigned, so those are the hours the cell shows.
function assignedBlock(shift, assignment) {
  const sStart = toMins(shift.startTime)
  const sEnd   = normEnd(sStart, toMins(shift.endTime))
  if (!assignment.blockStart) return { start: shift.startTime, end: shift.endTime, mins: sEnd - sStart }
  const aStart = toMins(assignment.blockStart)
  const aEnd   = assignment.blockEnd ? normEnd(aStart, toMins(assignment.blockEnd)) : sEnd
  return { start: assignment.blockStart, end: assignment.blockEnd || shift.endTime, mins: aEnd - aStart }
}

export async function renderWeekView() {
  const key = toYMD(state.currentWeek)
  const el  = document.getElementById('shifts-content')
  const allActive = (state.shiftsCache[key] || []).filter(s => s.status !== 'CANCELLED')

  renderFilterBar(allActive)
  const shifts = applyShiftFilters(allActive)

  if (allActive.length === 0) {
    el.innerHTML = `<div class="empty-state"><p>${t('shifts.noShiftsWeek')}</p></div>`
    return
  }
  if (shifts.length === 0) {
    el.innerHTML = `
      <div class="empty-state" style="padding-top:40px">
        <p style="color:var(--muted)">${t('shifts.filterNoMatch')}</p>
        <button class="btn-link" style="margin-top:8px" onclick="clearShiftFilters()">${t('shifts.filterClearLink')}</button>
      </div>`
    return
  }

  // Rows are people, so the roster has to be loaded before anything can be
  // drawn — unlike the old board, which needed only the shifts.
  if (!state.orgWorkers) {
    el.innerHTML = '<div class="loader-inline"><div class="spinner"></div></div>'
    await ensureOrgWorkers()
  }
  const allWorkers = state.orgWorkers || []
  if (allWorkers.length === 0) {
    el.innerHTML = `<div class="empty-state"><p>${t('shifts.noWorkersFound')}</p></div>`
    return
  }

  // Same narrowing the day roster applies: filtering to a department should not
  // leave every other worker on screen as an empty row. A worker with no
  // memberships is unrestricted, and a shift with no department is open to all,
  // so the presence of one skips the narrowing entirely.
  const visibleDeptIds = new Set(shifts.map(s => s.department?.id).filter(Boolean))
  const anyDeptless    = shifts.some(s => !s.department?.id)
  const workers = anyDeptless ? allWorkers : allWorkers.filter(w => {
    const ids = w.departmentIds || []
    return ids.length === 0 || ids.some(id => visibleDeptIds.has(id))
  })

  if (workers.length === 0) {
    el.innerHTML = `
      <div class="empty-state" style="padding-top:40px">
        <p style="color:var(--muted)">${t('shifts.noWorkersInDepts')}</p>
        <button class="btn-link" style="margin-top:8px" onclick="clearShiftFilters()">${t('shifts.filterClearLink')}</button>
      </div>`
    return
  }

  const days = getWeekViewDays()

  // shifts → day, so each column is built from one bucket rather than a scan.
  const byDay = new Map()
  for (const s of shifts) {
    const ymd = s.date.substring(0, 10)
    if (!byDay.has(ymd)) byDay.set(ymd, [])
    byDay.get(ymd).push(s)
  }
  for (const list of byDay.values()) list.sort((a, b) => a.startTime.localeCompare(b.startTime))

  // workerId|ymd → [{ shift, block }], the grid's cell contents.
  const cells = new Map()
  const weekMins = new Map()
  for (const s of shifts) {
    const ymd = s.date.substring(0, 10)
    for (const a of s.assignments || []) {
      const wid = a.worker?.id
      if (!wid) continue
      const block = assignedBlock(s, a)
      const k = `${wid}|${ymd}`
      if (!cells.has(k)) cells.set(k, [])
      cells.get(k).push({ shift: s, block })
      weekMins.set(wid, (weekMins.get(wid) || 0) + block.mins)
    }
  }
  for (const list of cells.values()) list.sort((a, b) => a.block.start.localeCompare(b.block.start))

  const today = new Date()

  // ── Header ──
  const dayHeads = days.map(({ date, ymd }) => {
    const dayShifts = byDay.get(ymd) || []
    const assigned  = dayShifts.reduce((n, s) => n + (s.assignments?.length || 0), 0)
    const required  = dayShifts.reduce((n, s) => n + (s.requiredWorkers || 0), 0)
    const pct       = required > 0 ? Math.min(100, Math.round(assigned / required * 100)) : 0

    return `
      <th class="rt-day wb-state-${coverageState(assigned, required)}${isSameDay(date, today) ? ' rt-today' : ''}">
        <div class="rt-day-name">${DAYS[date.getDay()]}</div>
        <div class="rt-day-num">${date.getDate()}</div>
        ${required > 0
          ? `<div class="wb-meter"><i style="width:${pct}%"></i></div>
             <div class="rt-day-cov">${assigned}/${required}</div>`
          : '<div class="rt-day-cov rt-day-cov-none">—</div>'}
      </th>`
  }).join('')

  // ── Worker rows ──
  const chip = ({ shift, block }) => {
    const color  = getDeptColor(shift.department?.id)
    const sColor = STATUS_COLORS[shift.status] || '#94a3b8'
    const dept   = shift.department?.name || t('shifts.noDepartment')
    return `
      <button class="rt-chip${shift.status === 'DRAFT' ? ' rt-chip-draft' : ''}"
              style="--dept:${color};--status:${sColor}"
              title="${esc(dept)} · ${t(`shifts.status.${shift.status}`)}"
              onclick="openShiftModal('${shift.id}')">
        <span class="rt-chip-time">${esc(hhmm(block.start))} – ${esc(hhmm(block.end))}</span>
        <span class="rt-chip-dept">${esc(dept)}</span>
      </button>`
  }

  const workerRows = workers.map(w => {
    const mins = weekMins.get(w.id) || 0
    const dayCells = days.map(({ ymd }) => {
      const list = cells.get(`${w.id}|${ymd}`) || []
      // A blank cell is the rest day. Nothing is drawn in it on purpose.
      return `<td class="rt-cell${list.length === 0 ? ' rt-cell-off' : ''}">${list.map(chip).join('')}</td>`
    }).join('')

    return `
      <tr class="rt-row">
        <th class="rt-worker" scope="row">
          <span class="rt-worker-inner">
            <span class="rt-avatar" data-avatar="${esc(w.avatarUrl || '')}">${esc(getInitials(w.name))}</span>
            <span class="rt-worker-name">${esc(w.name)}</span>
          </span>
        </th>
        ${dayCells}
        <td class="rt-total${mins === 0 ? ' rt-total-zero' : ''}">${mins === 0 ? '—' : esc(fmtMins(mins))}</td>
      </tr>`
  }).join('')

  // ── Gap block ──
  // Shifts nobody has filled belong to no worker row, so without this block
  // they vanish from the week entirely. It sits ABOVE the roster because it is
  // the manager's to-do list, and it splits by DEPARTMENT because "who is
  // missing" is only answerable as "who is missing, where" — a colour on a chip
  // made that a lookup rather than something you can read.
  const visibleDays = new Set(days.map(d => d.ymd))
  const gapsByDept = new Map()
  for (const s of shifts) {
    const ymd = s.date.substring(0, 10)
    if (!visibleDays.has(ymd)) continue
    const assigned = s.assignments?.length || 0
    const required = s.requiredWorkers || 0
    const missing  = required - assigned
    if (missing <= 0) continue

    const id = s.department?.id || '__none'
    if (!gapsByDept.has(id)) {
      gapsByDept.set(id, {
        name:  s.department?.name || t('shifts.noDepartment'),
        color: getDeptColor(s.department?.id),
        days:  new Map(),
        total: 0,
      })
    }
    const g = gapsByDept.get(id)
    if (!g.days.has(ymd)) g.days.set(ymd, [])
    g.days.get(ymd).push({ shift: s, assigned, required, missing })
    g.total += missing
  }
  const gapDepts = [...gapsByDept.values()].sort((a, b) => a.name.localeCompare(b.name))
  for (const g of gapDepts) {
    // Emptiest first within a day: a 0/2 is a different problem from a 2/3.
    for (const list of g.days.values()) {
      list.sort((a, b) => a.assigned - b.assigned || a.shift.startTime.localeCompare(b.shift.startTime))
    }
  }

  const spacerCells = days.map(() => '<td class="rt-band-cell"></td>').join('')
  const bandRow = (cls, label) => `
    <tr class="rt-band ${cls}">
      <th class="rt-worker rt-band-label" scope="row">${label}</th>
      ${spacerCells}
      <td class="rt-band-cell"></td>
    </tr>`

  const gapRows = gapDepts.map(g => {
    const dayCells = days.map(({ ymd }) => {
      const list = g.days.get(ymd) || []
      if (list.length === 0) return '<td class="rt-cell rt-cell-off"></td>'
      return `<td class="rt-cell">${list.map(({ shift, assigned, required, missing }) => `
        <button class="rt-chip rt-chip-gap wb-state-${coverageState(assigned, required)}"
                style="--dept:${g.color}"
                title="${esc(g.name)} · ${assigned}/${required}"
                onclick="openShiftModal('${shift.id}')">
          <span class="rt-chip-time">${esc(hhmm(shift.startTime))} – ${esc(hhmm(shift.endTime))}</span>
          <span class="rt-chip-need">${t('shifts.rota.needs', { n: missing })}</span>
        </button>`).join('')}</td>`
    }).join('')

    return `
      <tr class="rt-row rt-gap-row" style="--dept:${g.color}">
        <th class="rt-worker rt-gap-dept" scope="row">
          <span class="rt-worker-inner">
            <span class="rt-dept-swatch"></span>
            <span class="rt-worker-name">${esc(g.name)}</span>
          </span>
        </th>
        ${dayCells}
        <td class="rt-total rt-gap-total">${g.total}</td>
      </tr>`
  }).join('')

  const gapBlock = gapDepts.length === 0 ? '' :
    bandRow('rt-band-gap', `⚠ ${t('shifts.rota.needsStaff')}`) + gapRows +
    bandRow('rt-band-scheduled', t('shifts.rota.scheduled'))

  el.innerHTML = `
    <div class="wv-outer">
      <div class="wv-scroll">
        <table class="rt-table">
          <thead>
            <tr>
              <th class="rt-corner">${t('shifts.cell.workers')}</th>
              ${dayHeads}
              <th class="rt-total-head">${t('shifts.rota.total')}</th>
            </tr>
          </thead>
          <tbody>${gapBlock}${workerRows}</tbody>
        </table>
      </div>
      <div class="dt-legend">
        <span class="dt-legend-item"><span class="dt-legend-dot" style="background:#1a2d4f"></span>${t('shifts.legend.published')}</span>
        <span class="dt-legend-item"><span class="dt-legend-dot" style="background:#94a3b8"></span>${t('shifts.legend.draft')}</span>
        <span class="dt-legend-item"><span class="dt-legend-dot" style="background:#f59e0b"></span>${t('shifts.legend.active')}</span>
        <span class="dt-legend-sep">·</span>
        <span class="dt-legend-item" style="color:#d97706">${t('shifts.rota.legendNeeds')}</span>
        <span class="dt-legend-item">${t('shifts.rota.legendBlank')}</span>
      </div>
    </div>`
  applyAvatars(el)
}
