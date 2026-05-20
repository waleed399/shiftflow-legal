export function esc(s) {
  if (s == null) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function getInitials(name) {
  return (name || '?').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
}

import { t } from './i18n.js'

const DAY_CODES = ['SUN','MON','TUE','WED','THU','FRI','SAT']
export const DAY_FULL = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY']
// Index-based proxy so legacy `DAYS[i]` callers transparently get the current locale.
export const DAYS = new Proxy([], { get(_, k) { const i = Number(k); return Number.isInteger(i) ? t(`days.short.${DAY_CODES[i]}`) : undefined } })

export const AVAIL_ICONS = {
  morning:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
  afternoon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="9" x2="12" y2="2"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/><line x1="23" y1="22" x2="1" y2="22"/><polyline points="16 5 12 9 8 5"/></svg>`,
  night:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
  any:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  custom:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  off:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
}
// Index-based proxy so legacy `MONTHS[i]` callers transparently get the current locale.
export const MONTHS = new Proxy([], { get(_, k) { const i = Number(k); if (!Number.isInteger(i)) return undefined; const arr = t('months.short'); return Array.isArray(arr) ? arr[i] : undefined } })
export const DEPT_COLORS = ['#1a2d4f', '#f59e0b', '#0ea5e9', '#22c55e', '#ec4899', '#f97316', '#8b5cf6', '#14b8a6']

export function getWeekStartOf(date, weekStartsOn = 'MONDAY') {
  const d = new Date(date)
  const day = d.getDay() // 0=Sun, 1=Mon … 6=Sat
  const diff = weekStartsOn === 'SUNDAY' ? -day : (day === 0 ? -6 : 1 - day)
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

export function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

export function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function toYMD(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function fmtDate(date) {
  return `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`
}

export function showToast(message, type = 'error') {
  const existing = document.getElementById('app-toast')
  if (existing) existing.remove()

  const toast = document.createElement('div')
  toast.id = 'app-toast'
  toast.className = `app-toast app-toast-${type}`
  toast.textContent = message
  document.body.appendChild(toast)

  requestAnimationFrame(() => toast.classList.add('app-toast-visible'))
  setTimeout(() => {
    toast.classList.remove('app-toast-visible')
    toast.addEventListener('transitionend', () => toast.remove(), { once: true })
  }, 4000)
}

export function applyAvatars(container) {
  container.querySelectorAll('[data-avatar]').forEach(el => {
    const url = el.getAttribute('data-avatar')
    if (!url) return
    const img = document.createElement('img')
    img.alt = ''
    img.onload = () => { el.textContent = ''; el.appendChild(img) }
    img.src = url
  })
}
