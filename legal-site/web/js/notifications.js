import { apiFetch } from './api.js'
import { esc } from './utils.js'
import { t } from './i18n.js'

let _open = false
let _items = []

export async function initNotifications() {
  document.addEventListener('click', onDocClick)
  document.addEventListener('languagechange', () => { if (_open) renderPanelContent() })
  await loadNotifications()
}

async function loadNotifications() {
  try {
    const [sr, tr] = await Promise.all([
      apiFetch('/swaps?limit=50'),
      apiFetch('/time-off?limit=50'),
    ])
    if (!sr?.ok || !tr?.ok) return
    const swapsData   = await sr.json()
    const timeoffData = await tr.json()
    _items = buildItems(swapsData.swaps || [], timeoffData.requests || [])
    updateBell()
  } catch {}
}

function buildItems(swaps, timeoff) {
  const items = []
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

  for (const s of swaps) {
    if (s.status === 'PENDING') {
      items.push({ id: s.id, type: 'swap_pending', workerName: s.requester?.name, ts: s.createdAt })
    }
  }
  for (const r of timeoff) {
    if (r.status === 'PENDING') {
      items.push({ id: r.id, type: 'timeoff_pending', workerName: r.worker?.name, ts: r.createdAt })
    }
  }
  for (const s of swaps) {
    if (s.status !== 'PENDING') {
      const ts = s.updatedAt || s.createdAt
      if (ts && new Date(ts).getTime() > sevenDaysAgo) {
        items.push({ id: s.id, type: `swap_${s.status.toLowerCase()}`, workerName: s.requester?.name, ts })
      }
    }
  }
  for (const r of timeoff) {
    if (r.status !== 'PENDING') {
      const ts = r.updatedAt || r.createdAt
      if (ts && new Date(ts).getTime() > sevenDaysAgo) {
        items.push({ id: r.id, type: `timeoff_${r.status.toLowerCase()}`, workerName: r.worker?.name, ts })
      }
    }
  }

  items.sort((a, b) => {
    const ap = a.type.endsWith('_pending'), bp = b.type.endsWith('_pending')
    if (ap !== bp) return ap ? -1 : 1
    return new Date(b.ts || 0) - new Date(a.ts || 0)
  })

  return items.slice(0, 30)
}

function updateBell() {
  const pending = _items.filter(n => n.type.endsWith('_pending')).length
  const badge = document.getElementById('notif-bell-badge')
  if (!badge) return
  badge.classList.toggle('visible', pending > 0)
}

export function dismissNotification(id) {
  _items = _items.filter(n => n.id !== id)
  updateBell()
  if (_open) renderPanelContent()
}

export function toggleNotifPanel() {
  _open ? closeNotifPanel() : openNotifPanel()
}

function openNotifPanel() {
  _open = true
  renderPanelContent()
  document.getElementById('notif-panel')?.classList.add('notif-panel-open')
  document.getElementById('notif-bell')?.classList.add('active')
}

export function closeNotifPanel() {
  _open = false
  document.getElementById('notif-panel')?.classList.remove('notif-panel-open')
  document.getElementById('notif-bell')?.classList.remove('active')
}

function onDocClick(e) {
  if (!_open) return
  const panel = document.getElementById('notif-panel')
  const bell  = document.getElementById('notif-bell')
  if (panel && !panel.contains(e.target) && bell && !bell.contains(e.target)) {
    closeNotifPanel()
  }
}

function renderPanelContent() {
  const titleEl = document.getElementById('notif-panel-title')
  if (titleEl) titleEl.textContent = t('notifications.title')

  const list = document.getElementById('notif-list')
  if (!list) return

  if (!_items.length) {
    list.innerHTML = `<div class="notif-empty">${t('notifications.empty')}</div>`
    return
  }

  const pending  = _items.filter(n => n.type.endsWith('_pending'))
  const resolved = _items.filter(n => !n.type.endsWith('_pending'))

  let html = ''
  if (pending.length) {
    html += `<div class="notif-section-label">${t('notifications.pending')}</div>`
    html += pending.map(renderItem).join('')
  }
  if (resolved.length) {
    html += `<div class="notif-section-label">${t('notifications.recent')}</div>`
    html += resolved.map(renderItem).join('')
  }

  list.innerHTML = html
}

function renderItem(n) {
  const name     = esc(n.workerName || t('common.unknown'))
  const timeStr  = n.ts ? relTime(n.ts) : ''
  const isPending = n.type.endsWith('_pending')

  let iconHtml, label, colorCls

  switch (n.type) {
    case 'swap_pending':
      iconHtml = iconSwap(); label = t('notifications.swapPending', { name }); colorCls = 'notif-type-pending'; break
    case 'timeoff_pending':
      iconHtml = iconCalendar(); label = t('notifications.timeoffPending', { name }); colorCls = 'notif-type-pending'; break
    case 'swap_approved':
    case 'timeoff_approved':
      iconHtml = iconCheck(); label = t('notifications.approved', { name }); colorCls = 'notif-type-approved'; break
    case 'swap_denied':
    case 'timeoff_denied':
      iconHtml = iconX(); label = t('notifications.denied', { name }); colorCls = 'notif-type-denied'; break
    default:
      iconHtml = iconX(); label = t('notifications.cancelled', { name }); colorCls = 'notif-type-cancelled'
  }

  const clickAttr = isPending
    ? `onclick="window.showView('requests'); window.closeNotifPanel()"`
    : `onclick="window.dismissNotification('${esc(n.id)}')"`

  return `<div class="notif-item notif-item-action" ${clickAttr} role="button" tabindex="0">
    <div class="notif-icon-wrap ${colorCls}">${iconHtml}</div>
    <div class="notif-body">
      <div class="notif-text">${label}</div>
      ${timeStr ? `<div class="notif-time">${esc(timeStr)}</div>` : ''}
    </div>
    ${isPending ? `<svg class="notif-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>` : `<svg class="notif-dismiss-x" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`}
  </div>`
}

function relTime(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2)  return t('notifications.justNow')
  if (mins < 60) return t('notifications.minsAgo',  { n: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return t('notifications.hoursAgo', { n: hrs })
  return t('notifications.daysAgo', { n: Math.floor(hrs / 24) })
}

function iconSwap() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`
}
function iconCalendar() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`
}
function iconCheck() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
}
function iconX() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
}

window.toggleNotifPanel   = toggleNotifPanel
window.closeNotifPanel    = closeNotifPanel
window.dismissNotification = dismissNotification
