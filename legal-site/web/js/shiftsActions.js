// Action bar (above the day tabs in list view) and publish/unpublish actions.
//
// Public surface (wired to window.* in shifts.js):
//   updateActionBar — refresh button states based on current day/week
//   publishDay, unpublishDay, publishWeek, unpublishWeek

import { state } from './state.js'
import { apiFetch } from './api.js'
import { toYMD, showToast } from './utils.js'
import { t } from './i18n.js'
import { requireWebManage } from './profile.js'
import { loadShifts, getShiftsView } from './shifts.js'

export function updateActionBar() {
  const key = toYMD(state.currentWeek)
  const all = state.shiftsCache[key] || []
  const weekActive = all.filter(s => s.status !== 'CANCELLED')
  const bar = document.getElementById('action-bar')
  if (weekActive.length === 0) { bar.style.display = 'none'; return }
  bar.style.display = 'flex'

  const showDay = getShiftsView() === 'list'
  ;['action-label-day', 'btn-publish-day', 'btn-unpublish-day', 'action-bar-sep'].forEach(id => {
    document.getElementById(id).style.display = showDay ? '' : 'none'
  })

  if (showDay) {
    const selectedYMD = toYMD(state.selectedDay)
    const dayShifts = weekActive.filter(s => s.date.substring(0, 10) === selectedYMD)
    document.getElementById('btn-publish-day').disabled   = !dayShifts.some(s => s.status === 'DRAFT')
    document.getElementById('btn-unpublish-day').disabled = !dayShifts.some(s => s.status === 'PUBLISHED')
  }

  const weekDraftCount = weekActive.filter(s => s.status === 'DRAFT').length
  document.getElementById('publish-week-label').textContent = t('shifts.publishWeekCount', { count: weekDraftCount })
  document.getElementById('btn-publish-week').disabled  = weekDraftCount === 0
  document.getElementById('btn-unpublish-week').disabled = !weekActive.some(s => s.status === 'PUBLISHED')
}

export async function publishDay() {
  if (!requireWebManage()) return
  document.getElementById('btn-publish-day').disabled = true
  try {
    const res = await apiFetch('/shifts/publish-day', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: toYMD(state.selectedDay) }) })
    if (res?.ok) { delete state.shiftsCache[toYMD(state.currentWeek)]; await loadShifts() }
  } finally { updateActionBar() }
}

export async function unpublishDay() {
  if (!requireWebManage()) return
  document.getElementById('btn-unpublish-day').disabled = true
  try {
    const res = await apiFetch('/shifts/unpublish-day', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: toYMD(state.selectedDay) }) })
    if (res?.ok) { delete state.shiftsCache[toYMD(state.currentWeek)]; await loadShifts() }
  } finally { updateActionBar() }
}

export async function publishWeek() {
  if (!requireWebManage()) return
  const key = toYMD(state.currentWeek)
  const draftCount = (state.shiftsCache[key] || []).filter(s => s.status === 'DRAFT').length
  const msg = draftCount === 1
    ? t('shifts.confirmPublishWeekOne', { count: draftCount })
    : t('shifts.confirmPublishWeek', { count: draftCount })
  if (!confirm(msg)) return

  const btn = document.getElementById('btn-publish-week')
  btn.disabled = true
  const label = document.getElementById('publish-week-label')
  const prevText = label.textContent
  label.textContent = t('shifts.publishing')

  try {
    const res = await apiFetch('/shifts/publish-week', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weekOf: key }) })
    if (res?.ok) { delete state.shiftsCache[key]; await loadShifts() }
  } finally {
    label.textContent = prevText
    updateActionBar()
  }
}

export async function unpublishWeek() {
  if (!requireWebManage()) return
  if (!confirm(t('shifts.confirmUnpublishWeek'))) return

  const key = toYMD(state.currentWeek)
  document.getElementById('btn-unpublish-week').disabled = true

  try {
    const res = await apiFetch('/shifts/unpublish-week', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weekOf: key }) })
    if (res?.ok) { delete state.shiftsCache[key]; await loadShifts() }
  } finally { updateActionBar() }
}
