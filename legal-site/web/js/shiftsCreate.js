// "Create Shifts from Templates" modal — lets a manager batch-create shifts for
// N weeks ahead by toggling templates on/off per weekday in a grid.
//
// Public surface (wired to window.* in shifts.js):
//   openCreateShiftsModal, closeCreateShiftsModal, submitCreateShifts,
//   csNavWeek, csSetWeeks, csToggleCol, csToggleRow, csCellToggle,
//   onCreateShiftsOverlayClick

import { state } from './state.js'
import { apiFetch } from './api.js'
import { DAYS, MONTHS, addDays, toYMD, getWeekStartOf, esc, showToast } from './utils.js'
import { t } from './i18n.js'
import { requireWebManage } from './profile.js'
import { loadShifts, renderWeekLabel, renderDayTabs } from './shifts.js'

const CS_WEEK_OPTIONS = [1, 2, 4, 8, 12]
const CS_CODE_TO_IDX  = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 }
const CS_OFFSET_MON   = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 }
const CS_OFFSET_SUN   = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 }

let _csTemplates  = []
let _csGrid       = {}   // templateId → Set<dayCode>
let _csWeeksAhead = 4
let _csStartWeek  = null
let _csMinWeek    = null

function csWorkDays()   { return state.currentOrg?.workDays || ['MON','TUE','WED','THU','FRI'] }
function csWeekStart()  { return state.currentOrg?.weekStartsOn || 'MONDAY' }
function csDayOffset(d) { return csWeekStart() === 'SUNDAY' ? CS_OFFSET_SUN[d] : CS_OFFSET_MON[d] }
function csDayLabel(d)  { return DAYS[CS_CODE_TO_IDX[d]] || d.slice(0,3) }

function csTotalShifts() {
  const wd = csWorkDays()
  return Object.values(_csGrid).reduce((s, set) => s + [...set].filter(d => wd.includes(d)).length, 0) * _csWeeksAhead
}

export async function openCreateShiftsModal() {
  if (!requireWebManage()) return
  document.getElementById('create-shifts-modal').classList.remove('hidden')
  const body = document.getElementById('cs-modal-body')
  const btn  = document.getElementById('cs-submit-btn')
  body.innerHTML = `<div style="padding:32px;text-align:center"><div class="spinner" style="margin:0 auto 16px;width:32px;height:32px;border-width:3px"></div><p style="color:var(--muted);font-size:0.875rem">${t('shifts.csLoading')}</p></div>`
  btn.disabled = true
  _csTemplates = []; _csGrid = {}; _csWeeksAhead = 4

  const ws = csWeekStart()
  _csMinWeek   = getWeekStartOf(new Date(), ws)
  _csStartWeek = addDays(_csMinWeek, 7)

  try {
    // Defaults to next week. The picked range is now authoritative — it
    // replaces whatever drafts are already in it — so there's no longer any
    // reason to skip ahead of the last scheduled shift. That old jump is what
    // made the generator look like it could only ever add one week at a time.
    const tmplRes = await apiFetch('/shift-templates')
    if (!tmplRes) { closeCreateShiftsModal(); return }
    _csTemplates = await tmplRes.json()
    const wd = csWorkDays()
    _csTemplates.forEach(tmpl => { _csGrid[tmpl.id] = new Set(wd) })
    renderCreateShiftsGrid()
  } catch {
    body.innerHTML = `<div class="empty-state"><p>${t('common.networkError')}</p></div>`
  }
}

function renderCreateShiftsGrid() {
  if (_csTemplates.length === 0) {
    document.getElementById('cs-modal-body').innerHTML = `<div class="empty-state"><p>${t('shifts.csNoTemplates')}</p></div>`
    document.getElementById('cs-submit-btn').disabled = true
    return
  }

  const wd = csWorkDays()
  const weekEnd  = addDays(_csStartWeek, 6)
  const weekLabel = `${_csStartWeek.getDate()} ${MONTHS[_csStartWeek.getMonth()]} – ${weekEnd.getDate()} ${MONTHS[weekEnd.getMonth()]} ${weekEnd.getFullYear()}`
  const canPrev  = _csStartWeek > _csMinWeek

  // Week pills
  const pills = CS_WEEK_OPTIONS.map(w => {
    const on = _csWeeksAhead === w
    return `<button class="cs-week-pill${on ? ' cs-week-pill-on' : ''}" onclick="csSetWeeks(${w})">${w}w</button>`
  }).join('')

  // Day headers
  const dayHeaders = wd.map(d => {
    const allOn = _csTemplates.every(tmpl => _csGrid[tmpl.id]?.has(d))
    return `<th class="cs-day-th${allOn ? ' cs-day-all' : ''}" onclick="csToggleCol('${d}')">${csDayLabel(d)}</th>`
  }).join('')

  // Group templates by department
  const deptMap = new Map()
  _csTemplates.forEach(tmpl => {
    const key = tmpl.department?.id || 'none'
    if (!deptMap.has(key)) deptMap.set(key, { name: tmpl.department?.name || '—', templates: [] })
    deptMap.get(key).templates.push(tmpl)
  })
  const groups = [...deptMap.values()].sort((a, b) => a.name.localeCompare(b.name))

  const bodyRows = groups.map(({ name, templates }) => {
    const band = `<tr class="cs-dept-band"><td colspan="${wd.length + 1}">${esc(name)}</td></tr>`
    const rows = templates.map(tmpl => {
      const cells = wd.map(d => {
        const on = _csGrid[tmpl.id]?.has(d)
        return `<td class="cs-cell" onclick="csCellToggle('${tmpl.id}','${d}')">
          <div class="cs-dot${on ? ' cs-dot-on' : ''}" style="${on ? `background:${esc(tmpl.color||'#6366f1')}` : ''}"></div>
        </td>`
      }).join('')
      return `<tr class="cs-tmpl-row">
        <td class="cs-tmpl-cell" onclick="csToggleRow('${tmpl.id}')">
          <div class="cs-tmpl-inner">
            <div class="cs-tmpl-dot" style="background:${esc(tmpl.color||'#6366f1')}"></div>
            <div><span class="cs-tmpl-name">${esc(tmpl.name)}</span><span class="cs-tmpl-time">${tmpl.startTime.substring(0,5)} – ${tmpl.endTime.substring(0,5)}</span></div>
          </div>
        </td>${cells}
      </tr>`
    }).join('')
    return band + rows
  }).join('')

  document.getElementById('cs-modal-body').innerHTML = `
    <div class="cs-section-label">${t('shifts.csStartWeek')}</div>
    <div class="cs-week-nav">
      <button class="week-btn" onclick="csNavWeek(-1)" aria-label="${t('a11y.prevWeek')}" ${canPrev ? '' : 'disabled style="opacity:.3"'}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <span class="cs-week-label">${weekLabel}</span>
      <button class="week-btn" onclick="csNavWeek(1)" aria-label="${t('a11y.nextWeek')}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
    <p class="cs-hint">${t('shifts.csExistingHint')}</p>

    <div class="cs-section-label">${t('shifts.csWeeksAhead')}</div>
    <div class="cs-week-pills">${pills}</div>

    <div class="cs-section-label">${t('shifts.csShiftTypes')}</div>
    <div class="cs-grid-wrap">
      <table class="cs-grid">
        <thead><tr><th class="cs-tmpl-th">${t('shifts.csShift')}</th>${dayHeaders}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
    <p class="cs-hint">${t('shifts.csToggleHint')}</p>`

  const total = csTotalShifts()
  const btn = document.getElementById('cs-submit-btn')
  btn.disabled = total === 0
  btn.textContent = total > 0 ? t('shifts.csCreate', { count: total }) : t('shifts.csCreate', { count: 0 })
}

export function closeCreateShiftsModal() {
  document.getElementById('create-shifts-modal').classList.add('hidden')
}

export async function submitCreateShifts() {
  if (!requireWebManage()) return
  const wd       = csWorkDays()
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = toYMD(tomorrow)
  const jobs = []

  for (let w = 0; w < _csWeeksAhead; w++) {
    const weekStart = addDays(_csStartWeek, w * 7)
    for (const tmpl of _csTemplates) {
      const active = _csGrid[tmpl.id] || new Set()
      for (const d of wd) {
        if (!active.has(d)) continue
        const shiftDate = addDays(weekStart, csDayOffset(d))
        const dateStr   = toYMD(shiftDate)
        if (dateStr < tomorrowStr) continue
        jobs.push({ date: dateStr, startTime: tmpl.startTime, endTime: tmpl.endTime, departmentId: tmpl.departmentId, requiredWorkers: tmpl.requiredWorkers, templateId: tmpl.id })
      }
    }
  }

  if (jobs.length === 0) { showToast(t('shifts.csNothingSelected')); return }

  const btn = document.getElementById('cs-submit-btn')
  const prev = btn.textContent
  btn.disabled = true
  btn.textContent = t('shifts.csGenerating')

  // The whole picked range is replaced, not just the ticked days — so
  // unticking a day removes it, which is what "regenerate" has to mean.
  const rangeEnd = addDays(_csStartWeek, (_csWeeksAhead - 1) * 7 + 6)

  try {
    const res = await apiFetch('/shifts/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shifts: jobs,
        replaceRange: { from: toYMD(_csStartWeek), to: toYMD(rangeEnd) },
      }),
    })
    if (res?.ok) {
      const { created, skipped, replaced } = await res.json()
      closeCreateShiftsModal()
      // Navigate to the start week so user sees the created shifts
      state.currentWeek = _csStartWeek
      state.selectedDay = _csStartWeek
      state.shiftsCache = {}
      renderWeekLabel()
      renderDayTabs()
      await loadShifts()
      const parts = [t('shifts.csDone', { count: created })]
      if (replaced > 0) parts.push(t('shifts.csReplaced', { count: replaced }))
      if (skipped > 0)  parts.push(t('shifts.csSkipped', { count: skipped }))
      showToast(parts.join(' · '), 'success')
    } else {
      const d = await res?.json().catch(() => ({}))
      if (d?.code === 'RANGE_HAS_PUBLISHED') {
        const weeks = Array.isArray(d.weeks) ? d.weeks : []
        showToast(t('shifts.csPublishedBlocked', { count: weeks.length, weeks: weeks.join(', ') }))
      } else {
        showToast(d?.error || t('shifts.csFailed'))
      }
      btn.disabled = false; btn.textContent = prev
    }
  } catch {
    showToast(t('common.networkError'))
    btn.disabled = false; btn.textContent = prev
  }
}

// Inline handlers — wired to window.* in shifts.js.
export function csNavWeek(dir) {
  const c = addDays(_csStartWeek, dir * 7)
  if (dir < 0 && c < _csMinWeek) return
  _csStartWeek = c
  renderCreateShiftsGrid()
}

export function csSetWeeks(w) {
  _csWeeksAhead = w
  renderCreateShiftsGrid()
}

export function csToggleCol(d) {
  const allOn = _csTemplates.every((tmpl) => _csGrid[tmpl.id]?.has(d))
  _csTemplates.forEach((tmpl) => {
    const s = new Set(_csGrid[tmpl.id] || [])
    allOn ? s.delete(d) : s.add(d)
    _csGrid[tmpl.id] = s
  })
  renderCreateShiftsGrid()
}

export function csToggleRow(id) {
  const wd = csWorkDays()
  const s = _csGrid[id] || new Set()
  _csGrid[id] = wd.every((d) => s.has(d)) ? new Set() : new Set(wd)
  renderCreateShiftsGrid()
}

export function csCellToggle(id, d) {
  const s = new Set(_csGrid[id] || [])
  s.has(d) ? s.delete(d) : s.add(d)
  _csGrid[id] = s
  renderCreateShiftsGrid()
}

export function onCreateShiftsOverlayClick(e) {
  if (e.target.id === 'create-shifts-modal') closeCreateShiftsModal()
}
