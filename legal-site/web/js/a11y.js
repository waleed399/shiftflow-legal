// Accessibility helpers, registered once for the main app.
//
// Many clickable elements in this app are <div role="button"> (cards, rows,
// nav items) rather than native <button>s. Native buttons fire their click
// handler on Enter/Space and are keyboard-focusable; bare divs do neither.
// This single delegated handler gives every element marked role="button" the
// same keyboard behaviour, so we don't repeat an inline onkeydown on each one.
//
// Pair it with `tabindex="0"` on the element so it can receive focus.

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return

  // Don't hijack typing in form controls.
  const srcTag = e.target.tagName
  if (srcTag === 'INPUT' || srcTag === 'TEXTAREA' || srcTag === 'SELECT') return

  const el = e.target.closest('[role="button"]')
  if (!el) return

  // Native interactive elements already handle these keys themselves.
  const tag = el.tagName
  if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT') return
  if (el.getAttribute('aria-disabled') === 'true') return

  // Space would otherwise scroll the page; Enter is harmless but consistent.
  e.preventDefault()
  el.click()
})
