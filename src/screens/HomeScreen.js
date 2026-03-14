// =============================================
// ÉCRAN D'ACCUEIL
// =============================================

import { createRoom, joinRoom } from '../game/roomManager.js'
import { showToast, showLoading, hideLoading } from '../utils.js'

export function renderHomeScreen(container, { playerId, onRoomJoined }) {
  const savedPseudo = localStorage.getItem('undercover_pseudo') || ''

  container.innerHTML = `
    <div class="screen flex flex-col min-h-screen px-5 py-8">

      <!-- Logo & Header -->
      <div class="flex flex-col items-center text-center pt-8 pb-10">
        <div class="mb-3 relative">
          <div class="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
               style="background: rgba(0,245,212,0.08); border: 1px solid rgba(0,245,212,0.2);">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <path d="M16 4C16 4 8 8 8 14C8 20 12 24 16 28C20 24 24 20 24 14C24 8 16 4 16 4Z"
                    fill="none" stroke="#00f5d4" stroke-width="1.5" stroke-linejoin="round"/>
              <circle cx="16" cy="15" r="3" fill="#00f5d4" opacity="0.8"/>
              <path d="M16 12L18 10" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </div>
          <h1 class="game-logo text-5xl">Undercover</h1>
          <p class="text-xs font-mono mt-2" style="color: var(--text-muted); letter-spacing: 0.2em;">
            JEU DE DÉDUCTION SOCIAL
          </p>
        </div>
      </div>

      <!-- Formulaire principal -->
      <div class="flex-1 flex flex-col gap-5 max-w-sm mx-auto w-full">

        <!-- Pseudo -->
        <div class="flex flex-col gap-2">
          <label class="text-xs font-mono uppercase tracking-widest" style="color: var(--text-muted);">
            Ton pseudo
          </label>
          <input
            id="input-pseudo"
            type="text"
            class="input-field"
            placeholder="Ex: Dupont007"
            maxlength="16"
            autocomplete="nickname"
            value="${savedPseudo}"
          />
        </div>

        <!-- Divider -->
        <div class="divider"></div>

        <!-- Créer une partie -->
        <button id="btn-create" class="btn-primary w-full text-base">
          <span class="flex items-center justify-center gap-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/>
            </svg>
            Créer une partie
          </span>
        </button>

        <!-- Séparateur OU -->
        <div class="flex items-center gap-3">
          <div class="flex-1 h-px" style="background: rgba(22,41,82,0.8)"></div>
          <span class="text-xs font-mono" style="color: var(--text-muted);">ou</span>
          <div class="flex-1 h-px" style="background: rgba(22,41,82,0.8)"></div>
        </div>

        <!-- Rejoindre avec un code -->
        <div class="flex flex-col gap-3">
          <label class="text-xs font-mono uppercase tracking-widest" style="color: var(--text-muted);">
            Rejoindre avec un code
          </label>
          <input
            id="input-code"
            type="text"
            class="input-field text-center text-2xl tracking-widest uppercase"
            placeholder="ABCD"
            maxlength="4"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
            style="letter-spacing: 0.4em;"
          />
          <button id="btn-join" class="btn-secondary w-full text-base">
            <span class="flex items-center justify-center gap-3">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
              </svg>
              Rejoindre la partie
            </span>
          </button>
        </div>
      </div>

      <!-- Footer -->
      <div class="text-center mt-8">
        <p class="text-xs font-mono" style="color: rgba(226,232,240,0.2); letter-spacing: 0.1em;">
          3 à 10 joueurs • Navigateur web
        </p>
      </div>
    </div>
  `

  // ---- Handlers ----
  const pseudoInput = document.getElementById('input-pseudo')
  const codeInput   = document.getElementById('input-code')
  const btnCreate   = document.getElementById('btn-create')
  const btnJoin     = document.getElementById('btn-join')

  // Forcer majuscules sur le code
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '')
  })

  // Créer une partie
  btnCreate.addEventListener('click', async () => {
    const pseudo = pseudoInput.value.trim()
    if (!validatePseudo(pseudo)) return

    localStorage.setItem('undercover_pseudo', pseudo)
    showLoading(btnCreate, 'Création...')

    try {
      const code = await createRoom(playerId, pseudo)
      onRoomJoined(code, pseudo)
    } catch (err) {
      showToast(err.message || 'Erreur lors de la création.', 'error')
    } finally {
      hideLoading(btnCreate, `
        <span class="flex items-center justify-center gap-3">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/>
          </svg>
          Créer une partie
        </span>
      `)
    }
  })

  // Rejoindre une partie
  btnJoin.addEventListener('click', async () => {
    const pseudo = pseudoInput.value.trim()
    const code   = codeInput.value.trim().toUpperCase()

    if (!validatePseudo(pseudo)) return
    if (code.length !== 4) {
      showToast('Entre un code de 4 lettres.', 'error')
      codeInput.focus()
      return
    }

    localStorage.setItem('undercover_pseudo', pseudo)
    showLoading(btnJoin, 'Connexion...')

    try {
      const confirmedCode = await joinRoom(code, playerId, pseudo)
      onRoomJoined(confirmedCode, pseudo)
    } catch (err) {
      showToast(err.message || 'Impossible de rejoindre.', 'error')
    } finally {
      hideLoading(btnJoin, `
        <span class="flex items-center justify-center gap-3">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
          </svg>
          Rejoindre la partie
        </span>
      `)
    }
  })
}

function validatePseudo(pseudo) {
  if (!pseudo || pseudo.length < 2) {
    showToast('Choisis un pseudo d\'au moins 2 caractères.', 'error')
    document.getElementById('input-pseudo')?.focus()
    return false
  }
  if (pseudo.length > 16) {
    showToast('Pseudo trop long (max 16 caractères).', 'error')
    return false
  }
  return true
}
