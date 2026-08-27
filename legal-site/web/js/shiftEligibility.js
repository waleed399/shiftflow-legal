// Can this worker take this shift, and what does their day look like?
//
// The day roster answers this in every cell of its matrix; the assign picker
// needs the same answers for every row of its list. Written twice they would
// drift, and the two would disagree about who is assignable — the roster
// refusing what the picker had just offered. So the rules live here once.
//
// The rules mirror what the server enforces on POST /shifts/:id/assign. They
// are a courtesy, not a gate: the server is still the authority, and a client
// that gets one wrong shows a toast rather than corrupting anything.
//
// Imports only utils.js, deliberately. shifts.js imports the views, and the
// views import this — pulling shifts.js in here would close that loop.
//
// Public surface:
//   buildDayLoad, evaluateAssignment, buildDayPrefs, prefKeyOf

import { toMins, normEnd } from './utils.js'

/** Nobody may be scheduled past twelve hours in a day. Matches the server. */
const DAY_LIMIT_MINS = 720

/**
 * What each worker is already committed to on a given day.
 *
 * An assignment may cover a sub-range of its shift (blockStart/blockEnd); when
 * it does not, it covers the whole shift. Both the hours total and the overlap
 * check have to read the same ranges or a part-shift would be counted as a
 * full one.
 */
export function buildDayLoad(dayShifts) {
  const minsByWorker   = new Map()
  const rangesByWorker = new Map()

  for (const shift of dayShifts || []) {
    const sStart = toMins(shift.startTime)
    const sEnd   = normEnd(sStart, toMins(shift.endTime))

    for (const a of shift.assignments || []) {
      const wid = a.worker?.id || a.id
      if (!wid) continue
      const aStart = a.blockStart ? toMins(a.blockStart) : sStart
      const aEnd   = a.blockEnd ? normEnd(aStart, toMins(a.blockEnd)) : sEnd

      minsByWorker.set(wid, (minsByWorker.get(wid) || 0) + (aEnd - aStart))
      const ranges = rangesByWorker.get(wid) || []
      ranges.push({ startMins: aStart, endMins: aEnd, shiftId: shift.id })
      rangesByWorker.set(wid, ranges)
    }
  }

  return { minsByWorker, rangesByWorker }
}

/**
 * Whether `worker` can be put on `shift`, and if not, why.
 *
 * Returns a `code`, in the order the day roster tests them — already on it,
 * then the three blocks, then room or no room. The order is what decides which
 * single reason a cell shows, so it is part of the contract, not an accident:
 * a worker in the wrong department who is also over twelve hours reads as the
 * department problem, which is the one the manager can actually act on.
 *
 *   assigned  — already on this shift
 *   wrongDept — belongs to departments, none of them this shift's
 *   limit     — would pass twelve hours that day
 *   conflict  — already working an overlapping shift
 *   full      — shift has everyone it needs
 *   open      — assignable
 */
export function evaluateAssignment(worker, shift, load) {
  const assignments = shift.assignments || []
  if (assignments.some(a => (a.worker?.id || a.id) === worker.id)) return { code: 'assigned' }

  const deptIds = worker.departmentIds || []
  // No memberships means unrestricted, and a shift with no department is open
  // to everyone — the same rule the server applies.
  if (shift.department?.id && deptIds.length > 0 && !deptIds.includes(shift.department.id)) {
    return { code: 'wrongDept' }
  }

  const sStart    = toMins(shift.startTime)
  const sEnd      = normEnd(sStart, toMins(shift.endTime))
  const shiftMins = sEnd - sStart

  if ((load.minsByWorker.get(worker.id) || 0) + shiftMins > DAY_LIMIT_MINS) return { code: 'limit' }

  const ranges = load.rangesByWorker.get(worker.id) || []
  if (ranges.some(r => r.shiftId !== shift.id && r.startMins < sEnd && r.endMins > sStart)) {
    return { code: 'conflict' }
  }

  if (assignments.length >= (shift.requiredWorkers || 0)) return { code: 'full' }

  return { code: 'open' }
}

/** True for the codes that mean "cannot be assigned right now". */
export const isBlocked = (code) => code === 'wrongDept' || code === 'limit' || code === 'conflict'

/**
 * Each worker's stated availability for one day, keyed by worker id.
 *
 * `rosterRows` is the payload of /availability/week-roster/{weekOf}. A worker
 * with no slot for the day has said nothing, which the roster treats as off.
 */
export function buildDayPrefs(rosterRows, dayFullName) {
  return new Map((rosterRows || []).map(r => {
    if (!r.availability) return [r.worker.id, null]
    const slot = (r.availability.slots || []).find(s => s.day === dayFullName)
    return [r.worker.id, slot
      ? { preference: slot.preference, startTime: slot.startTime, endTime: slot.endTime }
      : { preference: 'off' }]
  }))
}

/**
 * The palette/label key for a preference, or null when nothing was stated.
 * A slot carrying only times is a custom range.
 */
export function prefKeyOf(pref) {
  if (!pref) return null
  return pref.preference || (pref.startTime && pref.endTime ? 'custom' : null)
}
