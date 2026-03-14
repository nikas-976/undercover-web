// =============================================
// UTILITAIRES PARTAGÉS
// =============================================

// ---- Toast Notifications ----

/** @param {'info'|'success'|'error'} type */
export function showToast(message, type = 'info', duration = 2500) {
  const container = document.getElementById('toast-container')
  if (!container) return

  // Evite les doublons identiques deja visibles
  const existing = [...container.querySelectorAll('.toast')]
  if (existing.some(t => t.textContent === message)) return

  const toast = document.createElement('div')
  toast.className = `toast toast-${type}`
  toast.textContent = message
  container.appendChild(toast)

  // Fade out via opacity, puis suppression — sans dependre de animationend
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease-out'
    toast.style.opacity = '0'
    setTimeout(() => toast.remove(), 350)
  }, duration)
}

// ---- Button Loading States ----

export function showLoading(btn, text = 'Chargement...') {
  btn.disabled = true
  btn.dataset.originalHtml = btn.innerHTML
  btn.innerHTML = `
    <span class="flex items-center justify-center gap-2">
      <div class="spinner" style="width:18px; height:18px; border-width:2px;"></div>
      ${text}
    </span>
  `
}

export function hideLoading(btn, html) {
  btn.disabled = false
  btn.innerHTML = html || btn.dataset.originalHtml || btn.textContent
}

// ---- Avatar Colors ----

const AVATAR_COLORS = [
  'linear-gradient(135deg, #00b4d8, #0077b6)',
  'linear-gradient(135deg, #7b2d8b, #5a189a)',
  'linear-gradient(135deg, #2d6a4f, #1b4332)',
  'linear-gradient(135deg, #e63946, #c1121f)',
  'linear-gradient(135deg, #f77f00, #d62828)',
  'linear-gradient(135deg, #023e8a, #0077b6)',
  'linear-gradient(135deg, #6d6875, #b5838d)',
  'linear-gradient(135deg, #2a9d8f, #264653)',
  'linear-gradient(135deg, #e9c46a, #f4a261)',
  'linear-gradient(135deg, #606c38, #283618)',
]

/** Retourne une couleur d'avatar déterministe basée sur l'uid */
export function getAvatarColor(uid) {
  if (!uid) return AVATAR_COLORS[0]
  let hash = 0
  for (let i = 0; i < uid.length; i++) {
    hash = uid.charCodeAt(i) + ((hash << 5) - hash)
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

// ---- Formatage ----

/** Retourne "il y a X secondes/minutes" */
export function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'à l\'instant'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `il y a ${minutes} min`
  return `il y a ${Math.floor(minutes / 60)}h`
}

// ---- Validation ----

export function isValidRoomCode(code) {
  return /^[A-Z]{4}$/.test(code)
}

export function isValidPseudo(pseudo) {
  return typeof pseudo === 'string' && pseudo.trim().length >= 2 && pseudo.trim().length <= 16
}