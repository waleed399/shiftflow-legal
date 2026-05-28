import en from './locales/en.js'
import he from './locales/he.js'

export const LANGUAGES = [
  { code: 'en', label: 'English', rtl: false },
  { code: 'he', label: 'עברית', rtl: true },
]

const RESOURCES = { en, he }
const STORAGE_KEY = 'shiftflow_lang'

let currentLang = 'en'

function isRTL(code) {
  return LANGUAGES.find(l => l.code === code)?.rtl ?? false
}

function getNested(obj, key) {
  return key.split('.').reduce((acc, part) => (acc == null ? undefined : acc[part]), obj)
}

function interpolate(str, vars) {
  if (!vars || typeof str !== 'string') return str
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] != null ? vars[k] : ''))
}

export function t(key, vars) {
  const val =
    getNested(RESOURCES[currentLang], key) ??
    getNested(RESOURCES.en, key) ??
    key
  return interpolate(val, vars)
}

export function getLanguage() {
  return currentLang
}

export function setLanguage(code) {
  if (!RESOURCES[code]) code = 'en'
  currentLang = code
  try { localStorage.setItem(STORAGE_KEY, code) } catch {}
  document.documentElement.lang = code
  document.documentElement.dir = isRTL(code) ? 'rtl' : 'ltr'
  applyTranslations()
  document.dispatchEvent(new CustomEvent('languagechange', { detail: { lang: code } }))
}

export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'))
  })
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')))
  })
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')))
  })
  root.querySelectorAll('[data-i18n-aria]').forEach(el => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')))
  })
}

export function initI18n() {
  let stored = 'en'
  try { stored = localStorage.getItem(STORAGE_KEY) || 'en' } catch {}
  if (!RESOURCES[stored]) stored = 'en'
  currentLang = stored
  document.documentElement.lang = currentLang
  document.documentElement.dir = isRTL(currentLang) ? 'rtl' : 'ltr'
  applyTranslations()
}

export function mountLanguageSwitcher(containerEl, { variant = 'sidebar' } = {}) {
  if (!containerEl) return
  containerEl.innerHTML = ''
  containerEl.classList.add('lang-switcher', `lang-switcher-${variant}`)

  if (variant === 'header') {
    _mountGlobeSwitcher(containerEl)
    return
  }

  for (const { code, label } of LANGUAGES) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'lang-btn'
    btn.dataset.lang = code
    btn.textContent = label
    btn.setAttribute('aria-pressed', code === currentLang ? 'true' : 'false')
    if (code === currentLang) btn.classList.add('active')
    btn.addEventListener('click', () => {
      setLanguage(code)
      containerEl.querySelectorAll('.lang-btn').forEach(b => {
        const isActive = b.dataset.lang === code
        b.classList.toggle('active', isActive)
        b.setAttribute('aria-pressed', isActive ? 'true' : 'false')
      })
    })
    containerEl.appendChild(btn)
  }
}

function _mountGlobeSwitcher(containerEl) {
  // Globe trigger button
  const triggerBtn = document.createElement('button')
  triggerBtn.type = 'button'
  triggerBtn.className = 'lang-globe-btn'
  triggerBtn.setAttribute('aria-haspopup', 'listbox')
  triggerBtn.setAttribute('aria-expanded', 'false')
  triggerBtn.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
    <span class="lang-globe-code">${currentLang.toUpperCase()}</span>
  `

  // Dropdown
  const dropdown = document.createElement('div')
  dropdown.className = 'lang-globe-dropdown'
  dropdown.setAttribute('role', 'listbox')

  function renderOptions() {
    dropdown.innerHTML = ''
    for (const { code, label } of LANGUAGES) {
      const opt = document.createElement('button')
      opt.type = 'button'
      opt.className = 'lang-globe-option' + (code === currentLang ? ' active' : '')
      opt.setAttribute('role', 'option')
      opt.setAttribute('aria-selected', code === currentLang ? 'true' : 'false')
      opt.innerHTML = `
        <span>${label}</span>
        ${code === currentLang ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
      `
      opt.addEventListener('click', () => {
        setLanguage(code)
        close()
      })
      dropdown.appendChild(opt)
    }
  }

  let isOpen = false

  function open() {
    isOpen = true
    renderOptions()
    dropdown.classList.add('open')
    triggerBtn.classList.add('open')
    triggerBtn.setAttribute('aria-expanded', 'true')
  }

  function close() {
    isOpen = false
    dropdown.classList.remove('open')
    triggerBtn.classList.remove('open')
    triggerBtn.setAttribute('aria-expanded', 'false')
  }

  triggerBtn.addEventListener('click', e => {
    e.stopPropagation()
    isOpen ? close() : open()
  })

  document.addEventListener('click', e => {
    if (isOpen && !containerEl.contains(e.target)) close()
  })

  // Keep the code label in sync when language changes
  document.addEventListener('languagechange', () => {
    const codeEl = triggerBtn.querySelector('.lang-globe-code')
    if (codeEl) codeEl.textContent = currentLang.toUpperCase()
    if (isOpen) renderOptions()
  })

  containerEl.appendChild(triggerBtn)
  containerEl.appendChild(dropdown)
}
