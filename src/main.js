// =============================================
// POINT D'ENTRÉE PRINCIPAL
// Gère la navigation entre les écrans
// =============================================

import './css/styles.css'
import { initAuth } from './firebase.js'
import { renderHomeScreen } from './screens/HomeScreen.js'
import { renderLobbyScreen } from './screens/LobbyScreen.js'
import { renderGameScreen } from './screens/GameScreen.js'
import { showToast } from './utils.js'

// =============================================
// ÉTAT GLOBAL DE L'APP
// =============================================
const state = {
  playerId: null,
  pseudo:   null,
  roomCode: null,
}

const app = document.getElementById('app')

// =============================================
// INITIALISATION
// =============================================
async function init() {
  // Écran de chargement initial
  app.innerHTML = `
    <div class="flex flex-col items-center justify-center min-h-screen gap-4">
      <div class="game-logo text-4xl">UNDERCOVER</div>
      <div class="spinner mt-4"></div>
      <p class="text-xs font-mono mt-2" style="color: rgba(226,232,240,0.3); letter-spacing: 0.15em;">
        CONNEXION EN COURS...
      </p>
    </div>
  `

  try {
    // Authentification anonyme Firebase
    state.playerId = await initAuth()
    console.log('✅ Connecté avec uid:', state.playerId)

    // Navigue vers l'accueil
    navigateTo('home')
  } catch (err) {
    console.error('❌ Erreur d\'init Firebase:', err)
    app.innerHTML = `
      <div class="flex flex-col items-center justify-center min-h-screen gap-4 px-6 text-center">
        <div class="text-4xl">⚠️</div>
        <h2 class="font-display text-xl text-white">Connexion impossible</h2>
        <p class="text-sm" style="color: var(--text-muted);">
          Vérifie ta configuration Firebase dans le fichier <code class="text-cyan-300">.env.local</code>
        </p>
        <p class="text-xs font-mono mt-2 px-4 py-2 rounded" style="background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #fca5a5;">
          ${err.message || 'Erreur inconnue'}
        </p>
        <button onclick="window.location.reload()" class="btn-primary mt-4">
          Réessayer
        </button>
      </div>
    `
  }
}

// =============================================
// ROUTEUR
// =============================================

function navigateTo(screen, params = {}) {
  app.innerHTML = ''

  switch (screen) {
    case 'home':
      renderHomeScreen(app, {
        playerId: state.playerId,
        onRoomJoined: (code, pseudo) => {
          state.roomCode = code
          state.pseudo   = pseudo
          navigateTo('lobby')
        },
      })
      break

    case 'lobby':
      renderLobbyScreen(app, {
        playerId: state.playerId,
        roomCode: state.roomCode,
        pseudo:   state.pseudo,
        onGameStart: (room) => {
          navigateTo('game')
        },
        onLeave: () => {
          state.roomCode = null
          navigateTo('home')
        },
      })
      break

    case 'game':
      renderGameScreen(app, {
        playerId: state.playerId,
        roomCode: state.roomCode,
        onBackToLobby: () => {
          // L'hôte a lancé "Nouvelle partie" → retour au lobby sans effacer le code
          navigateTo('lobby')
        },
        onGameEnd: () => {
          state.roomCode = null
          navigateTo('home')
        },
      })
      break

    default:
      navigateTo('home')
  }
}

// =============================================
// GESTION DE LA TOUCHE RETOUR (mobile)
// =============================================
window.addEventListener('popstate', () => {
  navigateTo('home')
})

// =============================================
// DÉMARRAGE
// =============================================
init()