import { state } from './state.js'
import { apiFetch } from './api.js'
import { esc, getInitials, applyAvatars, toYMD, addDays, getWeekStartOf, MONTHS, DAY_FULL, AVAIL_ICONS } from './utils.js'
import { t } from './i18n.js'
import { requireWebManage } from './profile.js'

// ── Preference config (colours match mobile exactly) ──────────────────────────

const PREF_STYLE = {
  morning:   { color: '#f59e0b', bg: '#fffbeb' },
  afternoon: { color: '#f97316', bg: '#fff7ed' },
  night:     { color: '#60a5fa', bg: '#eff6ff' },
  any:       { color: '#22c55e', bg: '#f0fdf4' },
  custom:    { color: '#3b82f6', bg: '#eff6ff' },
  off:       { color: '#94a3b8', bg: '#f8fafc' },
}
const PREF = new Proxy({}, { get: (_, key) => {
  const s = PREF_STYLE[key]; return s ? { ...s, label: t(`availability.pref.${key}`) } : undefined
} })


const ICON_BELL     = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`
const ICON_BELL_RING = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/><line x1="2" y1="2" x2="4" y2="4"/><line x1="20" y1="2" x2="22" y2="4"/></svg>`

// ── Day helpers ───────────────────────────────────────────────────────────────

const DAY_META_FULL = {
  MON: 'MONDAY', TUE: 'TUESDAY', WED: 'WEDNESDAY', THU: 'THURSDAY',
  FRI: 'FRIDAY', SAT: 'SATURDAY', SUN: 'SUNDAY',
}
const DAY_META = new Proxy({}, { get: (_, code) => {
  const full = DAY_META_FULL[code]
  return full ? { full, label: t(`days.short.${code}`) } : undefined
} })

const ALL_DAYS_ORDERED = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

function getWorkDays() {
  const startCode = state.currentOrg?.weekStartsOn === 'SUNDAY' ? 'SUN' : 'MON'
  const startIdx  = ALL_DAYS_ORDERED.indexOf(startCode)
  const ordered   = [...ALL_DAYS_ORDERED.slice(startIdx), ...ALL_DAYS_ORDERED.slice(0, startIdx)]
  const workDays  = state.currentOrg?.workDays
  return workDays?.length
    ? ordered.filter(d => workDays.includes(d))
    : ordered.filter(d => d !== 'SAT' && d !== 'SUN')
}

function avatarUrl(workerId) {
  return state.orgWorkers?.find(w => w.id === workerId)?.avatarUrl || ''
}

// ── Module state ──────────────────────────────────────────────────────────────

let _roster    = []
let _nudgedIds = new Set()

// ── Entry point ───────────────────────────────────────────────────────────────

export async function renderAvailability() {
  const el = document.getElementById('avail-content')
  el.innerHTML = '<div class="loader-inline"><div class="spinner"></div></div>'
  updateWeekLabel()

  const res = await apiFetch(`/availability/week-roster/${toYMD(state.currentWeek)}`)
  if (!res?.ok) {
    el.innerHTML = `<div class="empty-state"><p>${t('availability.failedLoad')}</p></div>`
    return
  }
  _roster    = await res.json()
  _nudgedIds = new Set()
  renderRoster()
}

export function changeAvailWeek(dir) {
  state.currentWeek = getWeekStartOf(addDays(state.currentWeek, dir * 7), state.currentOrg?.weekStartsOn)
  renderAvailability()
}

function updateWeekLabel() {
  const end = addDays(state.currentWeek, 6)
  const el  = document.getElementById('avail-week-label')
  if (el) el.textContent = `${state.currentWeek.getDate()} ${MONTHS[state.currentWeek.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`
}

// ── Roster render ─────────────────────────────────────────────────────────────

function renderRoster() {
  const el       = document.getElementById('avail-content')
  const workDays = getWorkDays()
  const submitted = _roster.filter(r => r.availability !== null)
  const pending   = _roster.filter(r => r.availability === null)
  const total     = _roster.length

  if (total === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        <p>${t('availability.noWorkers')}</p>
      </div>`
    return
  }

  const pct           = Math.round(submitted.length / total * 100)
  const progressColor = submitted.length === total ? '#10b981' : '#1a2d4f'
  const progressLabel = submitted.length === total
    ? t('availability.submittedAll')
    : t('availability.submittedOf', { submitted: submitted.length, total })

  const colCount = workDays.length + 2   // worker + days + nudge

  const dayHeaders = workDays.map(code =>
    `<th class="av-day-th">${DAY_META[code].label}</th>`).join('')

  const band = (color, label, extra = '') => `
    <tr class="av-band${extra}">
      <td class="av-band-cell" colspan="${colCount}">
        <span class="av-band-dot" style="background:${color}"></span>${label}
      </td>
    </tr>`

  el.innerHTML = `
    <div class="avail-progress-wrap">
      <div class="avail-progress-bar"><div class="avail-progress-fill" style="width:${pct}%;background:${progressColor}"></div></div>
      <span class="avail-progress-label">${esc(progressLabel)}</span>
    </div>

    <div class="av-outer">
      <div class="av-scroll">
        <table class="av-table">
          <thead>
            <tr>
              <th class="av-corner">${t('shifts.cell.workers')}</th>
              ${dayHeaders}
              <th class="av-nudge-th"></th>
            </tr>
          </thead>
          <tbody>
            ${submitted.length ? band('#10b981', t('availability.submittedLabel', { n: submitted.length }))
              + submitted.map(r => submittedRow(r, workDays)).join('') : ''}
            ${pending.length ? band('#f59e0b', t('availability.waitingLabel', { n: pending.length }))
              + pending.map(r => pendingRow(r, workDays)).join('') : ''}
          </tbody>
        </table>
      </div>
    </div>`

  applyAvatars(el)
}

// ── Row renderers ─────────────────────────────────────────────────────────────

function submittedRow(r, workDays) {
  const { worker, availability, timeOff } = r
  const initials    = esc(getInitials(worker.name))
  const slotByDay   = new Map((availability?.slots || []).map(s => [s.day, s]))
  const activeDays  = workDays.filter(code => {
    const s = slotByDay.get(DAY_META[code].full)
    return s && s.preference !== 'off'
  })

  const timeOffBadge = timeOff
    ? `<span class="avail-timeoff-badge">${t('availability.onLeave', { start: timeOff.startDate.slice(0, 10), end: timeOff.endDate.slice(0, 10) })}</span>`
    : ''
  const notes = availability?.notes
    ? `<div class="avail-notes">&ldquo;${esc(availability.notes)}&rdquo;</div>`
    : ''

  const cells = workDays.map(code => dayCell(slotByDay.get(DAY_META[code].full))).join('')

  return `
    <tr class="av-row">
      <td class="av-worker-cell">
        <div class="worker-row-avatar" data-avatar="${esc(avatarUrl(worker.id))}">${initials}</div>
        <div class="avail-worker-info">
          <div class="avail-worker-name">${esc(worker.name)}</div>
          ${timeOffBadge}
          ${notes}
          <div class="avail-days-count">${t('availability.daysAvailable', { active: activeDays.length, total: workDays.length })}</div>
        </div>
      </td>
      ${cells}
      <td class="av-nudge-cell"></td>
    </tr>`
}

function pendingRow(r, workDays) {
  const { worker, timeOff } = r
  const initials   = esc(getInitials(worker.name))
  const isNudged   = _nudgedIds.has(worker.id)
  const emptyCells = workDays.map(() => `<td class="av-cell av-cell-nil"><span class="avail-dash">—</span></td>`).join('')

  const sub = timeOff
    ? `<span class="avail-timeoff-badge">${t('availability.onLeave', { start: timeOff.startDate.slice(0, 10), end: timeOff.endDate.slice(0, 10) })}</span>`
    : `<span class="avail-waiting">${t('availability.waitingForAvailability')}</span>`

  return `
    <tr class="av-row av-row-pending">
      <td class="av-worker-cell">
        <div class="worker-row-avatar avail-avatar-muted" data-avatar="${esc(avatarUrl(worker.id))}">${initials}</div>
        <div class="avail-worker-info">
          <div class="avail-worker-name avail-name-muted">${esc(worker.name)}</div>
          ${sub}
        </div>
      </td>
      ${emptyCells}
      <td class="av-nudge-cell">
        <button class="avail-nudge-btn${isNudged ? ' avail-nudge-sent' : ''}"
                id="nudge-${esc(worker.id)}"
                onclick="nudgeWorker('${esc(worker.id)}')"
                ${isNudged ? 'disabled' : ''}
                title="${isNudged ? t('availability.nudgeSentTooltip') : t('availability.nudgeTooltip')}">
          ${isNudged ? ICON_BELL_RING : ICON_BELL}
        </button>
      </td>
    </tr>`
}

// The cell is a <td> now; the preference chip inside it is unchanged, so all
// the existing .avail-pref-* styling still applies.
function dayCell(slot) {
  const nil = `<td class="av-cell av-cell-nil"><span class="avail-dash">—</span></td>`
  if (!slot) return nil

  // Slots come back two shapes: preference-tagged (morning/night/any/off) or
  // raw time-range (startTime/endTime with no preference). For the raw shape,
  // fall through to a custom-style cell that shows the hours.
  const pref = slot.preference || (slot.startTime && slot.endTime ? 'custom' : null)
  if (!pref) return nil

  const p = PREF[pref]
  if (!p) return nil

  if (pref === 'custom') {
    return `
      <td class="av-cell">
        <div class="avail-cell avail-pref-custom">
          ${AVAIL_ICONS.custom}
          <span class="avail-cell-time">${esc(slot.startTime)}</span>
          <span class="avail-cell-time-sep">–</span>
          <span class="avail-cell-time">${esc(slot.endTime)}</span>
        </div>
      </td>`
  }

  const sub = pref === 'morning' && slot.until
    ? `<span class="avail-cell-sub">~ ${esc(slot.until)}</span>`
    : ''

  return `
    <td class="av-cell">
      <div class="avail-cell avail-pref-${pref}">
        ${AVAIL_ICONS[pref]}
        <span class="avail-cell-label">${p.label}</span>
        ${sub}
      </div>
    </td>`
}

// ── Nudge ─────────────────────────────────────────────────────────────────────

export async function nudgeWorker(workerId) {
  if (!requireWebManage()) return
  const btn = document.getElementById(`nudge-${workerId}`)
  if (!btn || btn.disabled) return
  btn.disabled = true
  btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px"></div>'

  try {
    await apiFetch('/availability/nudge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workerId, weekOf: toYMD(state.currentWeek) }),
    })
    _nudgedIds.add(workerId)
    btn.innerHTML = ICON_BELL_RING
    btn.classList.add('avail-nudge-sent')
  } catch {
    btn.disabled = false
    btn.innerHTML = ICON_BELL
  }
}

// ── Window exports ────────────────────────────────────────────────────────────

window.changeAvailWeek = changeAvailWeek
window.nudgeWorker     = nudgeWorker
