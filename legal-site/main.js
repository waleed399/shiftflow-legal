const nav = document.getElementById('main-nav')
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 40)
}, { passive: true })

const observer = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible') })
}, { threshold: 0.12 })
document.querySelectorAll('.reveal').forEach(el => observer.observe(el))

function setPricing(period) {
  const isAnnual = period === 'annual'
  document.getElementById('btn-monthly').classList.toggle('active', !isAnnual)
  document.getElementById('btn-annual').classList.toggle('active', isAnnual)
  const proPrice  = document.getElementById('pro-price')
  const proNote   = document.getElementById('pro-note')
  const bizPrice  = document.getElementById('biz-price')
  const bizNote   = document.getElementById('biz-note')
  if (isAnnual) {
    proPrice.innerHTML = '<sup>$</sup>39.99 <span>/ mo</span>'
    proNote.textContent = 'Billed $479.88/yr — save $120'
    bizPrice.innerHTML = '<sup>$</sup>79.99 <span>/ mo</span>'
    bizNote.textContent = 'Billed $959.88/yr — save $240'
  } else {
    proPrice.innerHTML = '<sup>$</sup>49.99 <span>/ mo</span>'
    proNote.innerHTML = '&nbsp;'
    bizPrice.innerHTML = '<sup>$</sup>99.99 <span>/ mo</span>'
    bizNote.innerHTML = '&nbsp;'
  }
}
