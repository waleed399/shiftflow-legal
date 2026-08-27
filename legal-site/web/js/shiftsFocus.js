// Focus mode for the shift grids — the day roster and the week rota alike.
//
// Both are matrices, so what limits them is room, and on this page the sidebar,
// topbar, action bar and day tabs are all spending it on things a manager does
// not need while reading a schedule. Focus mode hides them and gives the grid
// the whole viewport. The filter bar stays: department filtering is what trims
// the grid, so it is the one control that makes it smaller rather than larger.
//
// Hiding the topbar takes the week/day navigation with it, so the filter row
// carries a replacement — the day bar for the roster, the week bar for the
// rota. Which one appears is decided by what is actually on screen rather than
// by asking shifts.js, because shifts.js imports THIS module and the question
// would close an import cycle.
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
  // The nav bars live inside the filter row. No syncFilterRow call is needed
  // here: focus mode can only be entered when a grid rendered, which means
  // renderFilterBar painted chips, which means the row is already visible.
  syncFocusBars()
  applyColumnStretch()
  requestFullscreen()
}

export function exitTableFocus() {
  if (!active) return
  active = false
  document.body.classList.remove('dt-focus')
  const exit = chrome()
  if (exit) exit.style.display = 'none'
  syncFocusBars()
  applyColumnStretch()
  exitFullscreen()
}

// Which grid focus mode is serving. Told to us by shifts.js, which owns the
// view state, rather than inferred from the DOM.
//
// It WAS inferred, by looking for `.wv-outer` — and that was wrong on exactly
// the case that matters: an empty week renders an empty state and no grid, so
// the sniff concluded "not the week view" and offered the DAY bar. Paging back
// to a week with no shifts left the arrows stepping a day at a time.
let isWeekView = false

/** Called by syncViewChrome on every render, including the empty-state exits. */
export function setFocusContext(week) {
  isWeekView = week
  syncFocusBars()
}

/**
 * Show the nav bar matching the current view, and neither when not focused.
 * The week label is copied from the topbar's rather than recomputed — that
 * element is already correct for the week being viewed, and reading it keeps
 * this module free of imports from shifts.js.
 */
export function syncFocusBars() {
  const dayBar  = document.getElementById('focus-daybar')
  const weekBar = document.getElementById('focus-weekbar')
  if (dayBar)  dayBar.style.display  = (active && !isWeekView) ? '' : 'none'
  if (weekBar) weekBar.style.display = (active && isWeekView)  ? '' : 'none'

  const label = document.getElementById('focus-week-label')
  const src   = document.getElementById('week-label')
  if (label && src) label.textContent = src.textContent
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
