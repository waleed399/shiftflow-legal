import { state, ensureOrgWorkers } from './state.js'
import { apiFetch } from './api.js'
import { DAYS, MONTHS, DEPT_COLORS, DAY_FULL, AVAIL_ICONS, addDays, isSameDay, toYMD, fmtDate, getWeekStartOf, esc, getInitials, applyAvatars, showToast } from './utils.js'
import { t } from './i18n.js'
import { requireWebManage } from './profile.js'
import { exitTableFocus } from './shiftsFocus.js'
import {
  exportDay,
  exportWeek,
  toggleExportMenu,
  downloadDayCSV,
  downloadWeekCSV,
  downloadDayPDF,
  downloadWeekPDF,
} from './shiftsExport.js'
import {
  openGenerateModal,
  closeGenerateModal,
  confirmGenerate,
  selectGenOption,
  onGenerateOverlayClick,
} from './shiftsGenerate.js'
import {
  openCreateShiftsModal,
  closeCreateShiftsModal,
  submitCreateShifts,
  csNavWeek,
  csSetWeeks,
  csToggleCol,
  csToggleRow,
  csCellToggle,
  onCreateShiftsOverlayClick,
} from './shiftsCreate.js'
import {
  updateActionBar,
  publishDay,
  unpublishDay,
  publishWeek,
  unpublishWeek,
} from './shiftsActions.js'
// Re-export so external files (modals.js, etc.) can keep importing from
// shifts.js — their public surface doesn't change when we split internals.
export { updateActionBar }
import { syncFilterRow } from './shiftsFilterBar.js'
import { renderTableView, assignInTable } from './shiftsTableView.js'
import { renderWeekView } from './shiftsWeekView.js'

let shiftsView = 'table'   // 'table' (day roster) | 'week' (week roster)
let _activeFilters = new Set()

// Exposed for feature modules (shiftsActions, the views) so they can read the
// current view without poking at this module's let directly.
export function getShiftsView() { return shiftsView }
export function getActiveFilters() { return _activeFilters }

const DAY_CODE = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

// Exported so feature modules (shiftsExport, etc.) can pull these without
// having to duplicate the week-day filtering or the dept-color hash.
export function getWeekViewDays() {
  const workDays = state.currentOrg?.workDays
  const result = []
  for (let i = 0; i < 7; i++) {
    const d = addDays(state.currentWeek, i)
    const code = DAY_CODE[d.getDay()]
    const include = workDays?.length ? workDays.includes(code) : (code !== 'SAT' && code !== 'SUN')
    if (include) result.push({ date: d, ymd: toYMD(d) })
  }
  return result
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getDeptColor(deptId) {
  if (!deptId) return DEPT_COLORS[0]
  let hash = 0
  for (let i = 0; i < deptId.length; i++) hash = (hash * 31 + deptId.charCodeAt(i)) | 0
  return DEPT_COLORS[Math.abs(hash) % DEPT_COLORS.length]
}

export function toMins(t) {
  if (!t) return 0
  const [h, m] = t.substring(0, 5).split(':').map(Number)
  return h * 60 + m
}

export function normEnd(startMins, endMins) {
  return endMins <= startMins ? endMins + 1440 : endMins
}

export function shiftDuration(start, end) {
  const s = toMins(start)
  const e = normEnd(s, toMins(end))
  const mins = e - s
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

export const STATUS_COLORS = {
  DRAFT: '#94a3b8', PUBLISHED: '#1a2d4f', ACTIVE: '#f59e0b',
  COMPLETED: '#22c55e', CANCELLED: '#ef4444',
}

const AVAIL_PREF_COLORS = {
  morning: '#f59e0b', afternoon: '#f97316', night: '#60a5fa',
  any: '#22c55e', custom: '#3b82f6', off: '#ef4444',
}
export function availPref(key) {
  return { color: AVAIL_PREF_COLORS[key], label: t(`availability.pref.${key}`) }
}

// Mutated in place — feature modules access via getAvailRosterCache().
const _availRosterCache = {}
export function getAvailRosterCache() { return _availRosterCache }
function clearAvailRosterCache() {
  for (const k of Object.keys(_availRosterCache)) delete _availRosterCache[k]
}

// ── Week label & day tabs ─────────────────────────────────────────────────────

export function renderWeekLabel() {
  const end = addDays(state.currentWeek, 6)
  document.getElementById('week-label').textContent =
    `${state.currentWeek.getDate()} ${MONTHS[state.currentWeek.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`
}

export function renderDayTabs() {
  const today = new Date()
  const container = document.getElementById('day-tabs')
  container.innerHTML = ''
  for (let i = 0; i < 7; i++) {
    const day = addDays(state.currentWeek, i)
    const isToday  = isSameDay(day, today)
    const isActive = isSameDay(day, state.selectedDay)
    const tab = document.createElement('div')
    tab.className = `day-tab${isActive ? ' active' : ''}${isToday ? ' today' : ''}`
    tab.innerHTML = `<span>${DAYS[day.getDay()]}</span><span class="day-num">${day.getDate()}</span>`
    tab.onclick = () => {
      state.selectedDay = day
      renderDayTabs()
      if (shiftsView === 'week') renderWeekView()
      else renderTableView()
    }
    container.appendChild(tab)
  }
}

// ── View toggle ───────────────────────────────────────────────────────────────

// Everything around the roster that depends on which view is active: the
// toggle's pressed state, the day tabs, and the Expand button.
//
// Split out of setShiftsView because the shifts view is reachable WITHOUT
// going through it — on first load nothing calls setShiftsView, so the Expand
// button kept the display:none it carries in the markup and only appeared
// after a round-trip through the week roster. Runs on entry too now.
export function syncViewChrome() {
  document.getElementById('view-table-btn')?.classList.toggle('active', shiftsView === 'table')
  document.getElementById('view-week-btn')?.classList.toggle('active',  shiftsView === 'week')

  const dayTabs = document.getElementById('day-tabs')
  if (dayTabs) dayTabs.style.display = shiftsView === 'week' ? 'none' : ''

  // Focus mode belongs to the day roster matrix only.
  const expandBtn = document.getElementById('view-expand-btn')
  if (expandBtn) expandBtn.style.display = shiftsView === 'table' ? '' : 'none'

  syncFilterRow()
}

export function setShiftsView(view) {
  shiftsView = view
  _activeFilters = new Set()
  syncViewChrome()

  // Leaving the day roster has to drop out of focus mode too, or the page
  // chrome would stay hidden on a view that needs it.
  if (view !== 'table') exitTableFocus()

  // Both remaining views are full-bleed matrices, so the content area is
  // always flush now.
  const contentArea = document.getElementById('shifts-content').parentElement
  contentArea.classList.add('content-area-flush')
  if (view === 'week') renderWeekView()
  else renderTableView()
  updateActionBar()
}

// ── Week navigation ───────────────────────────────────────────────────────────

export function changeWeek(dir) {
  _activeFilters = new Set()
  const candidate = addDays(state.currentWeek, dir * 7)
  state.currentWeek = getWeekStartOf(candidate, state.currentOrg?.weekStartsOn)
  clearAvailRosterCache()
  const today = new Date()
  const weekEnd = addDays(state.currentWeek, 6)
  state.selectedDay = (today >= state.currentWeek && today <= weekEnd) ? today : new Date(state.currentWeek)
  renderWeekLabel()
  renderDayTabs()
  loadShifts()
}

// ── Data loading ──────────────────────────────────────────────────────────────

export async function loadShifts() {
  const key = toYMD(state.currentWeek)
  document.getElementById('shifts-content').innerHTML = '<div class="loader-inline"><div class="spinner"></div></div>'
  try {
    if (!state.shiftsCache[key]) {
      const res = await apiFetch(`/shifts?weekOf=${key}`)
      if (!res) return
      state.shiftsCache[key] = await res.json()
    }
    if (shiftsView === 'week') renderWeekView()
    else renderTableView()
  } catch {
    document.getElementById('shifts-content').innerHTML = `<div class="empty-state"><p>${t('shifts.failedLoad')}</p></div>`
  }
}

// ── Filters & view dispatch ────────────────────────────────────────────────

export function applyShiftFilters(shifts) {
  if (_activeFilters.size === 0) return shifts
  return shifts.filter(s => {
    if (_activeFilters.has('needs_workers') && (s.assignments?.length || 0) >= (s.requiredWorkers || 0)) return false
    if (_activeFilters.has('understaffed') && (s.assignments?.length || 0) >= (s.requiredWorkers || 0)) return false
    const timeFilters = ['morning', 'afternoon', 'evening'].filter(k => _activeFilters.has(k))
    if (timeFilters.length > 0) {
      const hour = parseInt(s.startTime?.substring(0, 2) || '0', 10)
      const block = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
      if (!timeFilters.includes(block)) return false
    }
    const deptFilters = [..._activeFilters].filter(k => k.startsWith('dept:'))
    if (deptFilters.length > 0 && !deptFilters.includes(`dept:${s.department?.id}`)) return false
    return true
  })
}


export function toggleShiftFilter(key) {
  _activeFilters.has(key) ? _activeFilters.delete(key) : _activeFilters.add(key)
  _rerenderCurrentView()
}

export function clearShiftFilters() {
  _activeFilters = new Set()
  _rerenderCurrentView()
}

function _rerenderCurrentView() {
  if (shiftsView === 'week') renderWeekView()
  else renderTableView()
}

// ── Window bindings (single source of truth for inline onclick handlers) ──────


window.changeWeek       = changeWeek
window.publishDay       = publishDay
window.unpublishDay     = unpublishDay
window.publishWeek      = publishWeek
window.unpublishWeek    = unpublishWeek
window.setShiftsView    = setShiftsView
window.assignInTable    = assignInTable
window.openCreateShiftsModal     = openCreateShiftsModal
window.closeCreateShiftsModal    = closeCreateShiftsModal
window.submitCreateShifts        = submitCreateShifts
window.csNavWeek                 = csNavWeek
window.csSetWeeks                = csSetWeeks
window.csToggleCol               = csToggleCol
window.csToggleRow               = csToggleRow
window.csCellToggle              = csCellToggle
window.onCreateShiftsOverlayClick = onCreateShiftsOverlayClick
window.openGenerateModal         = openGenerateModal
window.closeGenerateModal        = closeGenerateModal
window.confirmGenerate           = confirmGenerate
window.selectGenOption           = selectGenOption
window.onGenerateOverlayClick    = onGenerateOverlayClick
window.toggleShiftFilter  = toggleShiftFilter
window.clearShiftFilters  = clearShiftFilters
window.exportDay          = exportDay
window.exportWeek         = exportWeek
window.toggleExportMenu   = toggleExportMenu
window.downloadDayCSV     = downloadDayCSV
window.downloadWeekCSV    = downloadWeekCSV
window.downloadDayPDF     = downloadDayPDF
window.downloadWeekPDF    = downloadWeekPDF
