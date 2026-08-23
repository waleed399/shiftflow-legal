// Focus mode for the day roster.
//
// The roster is a shifts × workers matrix, so what limits it is horizontal
// room, and on this page the sidebar, topbar, action bar and day tabs are all
// spending that room on things a manager does not need while assigning. Focus
// mode hides them and gives the matrix the whole viewport. The filter bar
// stays: department filtering is what trims the worker columns, so it is the
// one control that makes the table smaller rather than larger.
//
// Two layers, deliberately:
//   1. body.dt-focus — hides the chrome. Always applied; this is the part that
//      actually matters and it cannot fail.
//   2. the Fullscreen API — also drops the BROWSER's chrome. Best-effort: it
//      needs a user gesture, can be blocked by permissions policy, and does
//      not exist on some older browsers. If it refuses we keep layer 1, so the
//      button always does something.
//
// Because layer 2 can be exited by the browser itself (Esc, F11, the tab
// losing fullscreen), we listen for fullscreenchange and follow it, otherwise
// the page would be left with hidden chrome and no visible way back.

import { t } from './i18n.js'
import { applyColumnStretch } from './shiftsTableFit.js'

let active = false

function chrome() {
  return document.getElementById('shifts-focus-exit')
}

async function requestFullscreen() {
  const el = document.documentElement
  const fn = el.requestFullscreen || el.webkitRequestFullscreen
  if (!fn) return
  try {
    await fn.call(el)
  } catch {
    // Blocked or unsupported — body.dt-focus still applied, nothing to do.
  }
}

async function exitFullscreen() {
  const fn = document.exitFullscreen || document.webkitExitFullscreen
  if (!fn) return
  if (!document.fullscreenElement && !document.webkitFullscreenElement) return
  try {
    await fn.call(document)
  } catch {
    // Already out of fullscreen; the class removal below is what matters.
  }
}

export function enterTableFocus() {
  if (active) return
  active = true
  document.body.classList.add('dt-focus')
  const exit = chrome()
  if (exit) {
    exit.style.display = ''
    exit.setAttribute('aria-label', t('shifts.exitExpand'))
    exit.setAttribute('title', t('shifts.exitExpand'))
  }
  // The day bar lives inside the filter row. No syncFilterRow call is needed
  // here: focus mode can only be entered when a table rendered, which means
  // renderFilterBar painted chips, which means the row is already visible.
  const bar = document.getElementById('focus-daybar')
  if (bar) bar.style.display = ''
  applyColumnStretch()
  requestFullscreen()
}

export function exitTableFocus() {
  if (!active) return
  active = false
  document.body.classList.remove('dt-focus')
  const exit = chrome()
  if (exit) exit.style.display = 'none'
  const bar = document.getElementById('focus-daybar')
  if (bar) bar.style.display = 'none'
  applyColumnStretch()
  exitFullscreen()
}

export function toggleTableFocus() {
  if (active) exitTableFocus()
  else enterTableFocus()
}

// Esc is the expected way out of anything fullscreen on the web. When the
// Fullscreen API is active the browser consumes Esc itself and we hear about
// it via fullscreenchange below; this covers the case where it was refused.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && active) exitTableFocus()
})

// The browser can drop fullscreen without going through our button (Esc, F11,
// switching tabs). Follow it, or the chrome stays hidden with no way back.
for (const evt of ['fullscreenchange', 'webkitfullscreenchange']) {
  document.addEventListener(evt, () => {
    const inFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement)
    if (!inFullscreen && active) exitTableFocus()
  })
}

window.toggleTableFocus = toggleTableFocus
window.exitTableFocus   = exitTableFocus
