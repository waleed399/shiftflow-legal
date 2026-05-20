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
