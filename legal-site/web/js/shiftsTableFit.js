// Sizes the day-roster columns to the space actually available.
//
// The roster's worker columns are a fixed 88px, which is right when the table
// shares a page with other content. In focus mode it has the whole viewport,
// and on a wide screen a handful of workers leaves most of that width empty —
// the table stops short and the page ground shows through beside it. So when
// the columns under-fill the measured width, the surplus is shared between
// them.
//
// Capped, because the opposite failure is worse: three workers on a 1920px
// screen would otherwise become three 600px columns.
//
// Deliberately no imports. shiftsTableView imports shifts.js, which imports
// shiftsFocus.js, so a shared helper that either of those can import has to
// stay dependency-free or it closes an import cycle.

const BASE_COL_W = 88   // .dt-worker-th / .dt-worker-cell default
const INFO_COL_W = 108  // .dt-corner / .dt-info-cell, the sticky first column
const MAX_COL_W  = 150

export function applyColumnStretch() {
  const outer = document.querySelector('.dt-outer')
  if (!outer) return

  const clear = () => outer.style.removeProperty('--dt-col-w')

  // Runs in both views. This used to be focus-mode only, on the reasoning that
  // the inline table sat in a scrolling page where resizing columns read as
  // jitter — but the table is a card filling the workspace now, so fixed
  // columns just left bare card to the right of the last worker.

  const wrap = outer.querySelector('.dt-scroll-wrap')
  const cols = outer.querySelectorAll('.dt-worker-th').length
  if (!wrap || cols === 0) { clear(); return }

  const available = wrap.clientWidth          // excludes the scrollbar
  const natural   = INFO_COL_W + BASE_COL_W * cols
  if (available <= natural) { clear(); return }   // already overflowing: scroll

  // -2 keeps a rounding remainder from pushing out a horizontal scrollbar.
  const width = Math.min(Math.floor((available - INFO_COL_W - 2) / cols), MAX_COL_W)
  outer.style.setProperty('--dt-col-w', `${width}px`)
}

// Entering or leaving fullscreen changes the viewport, and so does an ordinary
// window resize. Both land here.
window.addEventListener('resize', applyColumnStretch)
