// =============================================
// ÉCRAN LOBBY — avec sélection de thème
// =============================================

import { subscribeToRoom, startGame, leaveRoom, deleteRoom } from '../game/roomManager.js'
import { assignRoles } from '../game/roles.js'
import { getRandomWordPair, PLAYABLE_THEMES, THEMES } from '../data/words.js'
import { generateTwist } from '../game/twists.js'
import { showToast, getAvatarColor } from '../utils.js'

const MIN_PLAYERS = 3
const MAX_PLAYERS = 10

export function renderLobbyScreen(container, { playerId, roomCode, pseudo, onGameStart, onLeave }) {
  let unsubscribe = null
  let selectedThemes = [] // [] = tout mélangé
  let settings = { maxScore: 20, undercoversCount: 1, useMrWhite: false, useNotes: false }

  container.innerHTML = `
    <div class="screen flex flex-col min-h-screen px-5 py-6">

      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <button id="btn-leave" class="btn-ghost text-sm py-2 px-4">← Quitter</button>
        <span class="text-xs font-mono uppercase tracking-widest" style="color: var(--text-muted);">Salle d'attente</span>
        <div class="w-20"></div>
      </div>

      <!-- Room Code -->
      <div class="card p-5 text-center mb-5">
        <p class="text-xs font-mono uppercase tracking-widest mb-3" style="color: var(--text-muted);">Code de la partie</p>
        <div class="room-code">${roomCode}</div>
        <button id="btn-copy" class="mt-3 text-xs font-mono py-2 px-4 rounded-lg transition-all"
          style="background: rgba(0,245,212,0.08); border: 1px solid rgba(0,245,212,0.2); color: var(--cyan-glow);">
          📋 Copier le code
        </button>
        <p class="text-xs mt-3" style="color: var(--text-muted);">Partage ce code avec tes amis</p>
      </div>

      <!-- Player Count -->
      <div class="flex items-center justify-between mb-3">
        <span class="text-sm font-mono" style="color: var(--text-muted);">Joueurs connectés</span>
        <span id="player-count" class="text-sm font-mono" style="color: var(--cyan-glow);">0 / ${MAX_PLAYERS}</span>
      </div>

      <!-- Players List -->
      <div id="players-list" class="flex flex-col gap-2 mb-5">
        <div class="flex items-center justify-center py-6"><div class="spinner"></div></div>
      </div>

      <!-- Roles Preview -->
      <div class="card-glass p-4 mb-4">
        <p class="text-xs font-mono uppercase tracking-widest mb-3" style="color: var(--text-muted);">Rôles actifs</p>
        <div id="roles-preview" class="flex flex-wrap gap-2"></div>
      </div>

      <!-- HOST SETTINGS (host only) -->
      <div id="host-settings" class="hidden mb-5">
        <p class="text-xs font-mono uppercase tracking-widest mb-3" style="color: var(--amber-glow);">
          ⚙️ Paramètres de la partie
        </p>
        <div class="card p-4 flex flex-col gap-4">
          <!-- Score max -->
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-body text-white">Score à atteindre</p>
              <p class="text-xs" style="color: var(--text-muted);">Première manche gagnante</p>
            </div>
            <select id="setting-maxscore" class="font-mono text-sm px-3 py-1.5 rounded-lg" style="background: rgba(10,20,40,0.8); border: 1px solid rgba(0,245,212,0.3); color: var(--cyan-glow);">
              <option value="10">10 pts</option>
              <option value="20" selected>20 pts</option>
              <option value="30">30 pts</option>
              <option value="50">50 pts</option>
              <option value="70">70 pts</option>
              <option value="100">100 pts</option>
              <option value="150">150 pts</option>
              <option value="200">200 pts</option>
              <option value="70">70 pts</option>
              <option value="100">100 pts</option>
              <option value="150">150 pts</option>
              <option value="200">200 pts</option>
            </select>
          </div>
          <!-- Notes -->
          <label class="flex items-center justify-between cursor-pointer">
            <div>
              <p class="text-sm font-body text-white">📝 Carnet de notes</p>
              <p class="text-xs" style="color: var(--text-muted);">Affiche les mots déjà dits</p>
            </div>
            <div class="relative">
              <input type="checkbox" id="setting-notes" class="sr-only">
              <div id="toggle-notes" class="toggle-track w-11 h-6 rounded-full transition-colors" style="background: rgba(22,41,82,0.8); border: 1px solid rgba(22,41,82,0.9);"></div>
            </div>
          </label>
        </div>
      </div>

      <!-- Settings display (non-host) -->
      <div id="settings-display" class="hidden card-glass p-4 mb-4 flex gap-3 flex-wrap">
      </div>

      <!-- THEME SELECTOR (host only) -->
      <div id="theme-selector" class="hidden mb-5">
        <p class="text-xs font-mono uppercase tracking-widest mb-3" style="color: var(--amber-glow);">
          🎲 Thème de la partie
        </p>
        <div id="theme-grid" class="grid grid-cols-2 gap-2">
          ${renderThemeButtons(selectedThemes)}
        </div>
      </div>

      <!-- Theme display (non-host) -->
      <div id="theme-display" class="hidden card-glass p-4 mb-4">
        <p class="text-xs font-mono uppercase tracking-widest mb-2" style="color: var(--text-muted);">Thème</p>
        <div id="theme-display-value" class="text-sm font-body" style="color: rgba(226,232,240,0.8);">
          🎲 Tout mélangé
        </div>
      </div>

      <!-- Host Controls -->
      <div id="host-controls" class="hidden">
        <button id="btn-start" class="btn-primary w-full text-base" disabled>
          <span id="start-label">En attente de joueurs... (min. ${MIN_PLAYERS})</span>
        </button>
      </div>

      <!-- Guest waiting -->
      <div id="guest-waiting" class="hidden text-center py-4">
        <p class="text-sm" style="color: var(--text-muted);">En attente que l'hôte lance la partie…</p>
        <div class="flex justify-center mt-3 gap-1">
          <div class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style="animation-delay: 0ms"></div>
          <div class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style="animation-delay: 150ms"></div>
          <div class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style="animation-delay: 300ms"></div>
        </div>
      </div>
    </div>
  `

  let isHost = false
  let lastState = 'waiting'

  // ---- Abonnement temps réel ----
  unsubscribe = subscribeToRoom(roomCode, (room) => {
    if (!room) { showToast('La room a été supprimée.', 'error'); cleanup(); onLeave(); return }

    if (room.state !== 'waiting' && lastState === 'waiting') { cleanup(); onGameStart(room); return }
    lastState = room.state

    const players = Object.values(room.players || {}).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))
    const count   = players.length
    isHost        = room.creatorId === playerId

    // Sync thèmes depuis Firebase
    if (room.selectedThemes !== undefined) {
      selectedThemes = Array.isArray(room.selectedThemes) ? room.selectedThemes : []
    }
    // Sync settings
    if (room.settings) {
      settings = { ...settings, ...room.settings }
    }

    // Player count
    document.getElementById('player-count').textContent = `${count} / ${MAX_PLAYERS}`

    // Players list
    const listEl = document.getElementById('players-list')
    listEl.innerHTML = players.length === 0
      ? '<p class="text-center text-sm py-4" style="color: var(--text-muted);">Aucun joueur...</p>'
      : players.map(p => {
          const isMe      = p.id === playerId
          const isCreator = p.id === room.creatorId
          return `
            <div class="player-item ${isCreator ? 'is-host' : ''}">
              <div class="player-avatar" style="background: ${getAvatarColor(p.id)};">
                ${p.pseudo.slice(0, 2).toUpperCase()}
              </div>
              <span class="text-sm font-body ${isMe ? 'text-white' : ''}" style="${isMe ? '' : 'color: rgba(226,232,240,0.7)'}">
                ${p.pseudo}${isMe ? ' <span style="color: var(--text-muted); font-size: 0.7rem;">(toi)</span>' : ''}
              </span>
            </div>
          `
        }).join('')

    // Roles preview
    updateRolesPreview(count)

    // Theme selector (host) / display (guest)
    const themeSelector = document.getElementById('theme-selector')
    const themeDisplay  = document.getElementById('theme-display')
    const themeDValue   = document.getElementById('theme-display-value')

    const settingsPanel  = document.getElementById('host-settings')
    const settingsDisplay = document.getElementById('settings-display')

    if (isHost) {
      if (settingsPanel) settingsPanel.classList.remove('hidden')
      if (settingsDisplay) settingsDisplay.classList.add('hidden')
      // Sync select value
      const sel = document.getElementById('setting-maxscore')
      if (sel) sel.value = String(settings.maxScore || 20)
      const notesChk = document.getElementById('setting-notes')
      if (notesChk) notesChk.checked = !!settings.useNotes
      updateToggleUI()
      attachSettingsListeners()
      themeSelector.classList.remove('hidden')
      themeDisplay.classList.add('hidden')
      // Re-render buttons to reflect current selection
      document.getElementById('theme-grid').innerHTML = renderThemeButtons(selectedThemes)
      attachThemeListeners(room)
    } else {
      themeSelector.classList.add('hidden')
      themeDisplay.classList.remove('hidden')
      if (settingsPanel) settingsPanel.classList.add('hidden')
      if (settingsDisplay) {
        settingsDisplay.classList.remove('hidden')
        settingsDisplay.innerHTML = `
          <span class="text-xs font-mono px-2 py-1 rounded" style="background: rgba(0,245,212,0.08); border: 1px solid rgba(0,245,212,0.2); color: var(--cyan-glow);">🏆 ${settings.maxScore || 20} pts</span>
          ${settings.useNotes ? '<span class="text-xs font-mono px-2 py-1 rounded" style="background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.2); color: var(--amber-glow);">📝 Notes ON</span>' : ''}
        `
      }
      const st = Array.isArray(room.selectedThemes) ? room.selectedThemes : []
      if (st.length === 0) {
        themeDValue.textContent = '🎲 Tout mélangé'
      } else if (st.length === 1) {
        const t = Object.values(THEMES).find(t => t.id === st[0]) || THEMES.ALL
        themeDValue.textContent = `${t.emoji} ${t.label}`
      } else {
        themeDValue.textContent = st.map(id => {
          const t = Object.values(THEMES).find(t => t.id === id) || THEMES.ALL
          return t.emoji
        }).join(' ') + ` (${st.length} thèmes)`
      }
    }

    // Host controls
    const hostDiv  = document.getElementById('host-controls')
    const guestDiv = document.getElementById('guest-waiting')
    const btnStart = document.getElementById('btn-start')
    const startLbl = document.getElementById('start-label')

    if (isHost) {
      hostDiv.classList.remove('hidden')
      guestDiv.classList.add('hidden')
      if (count >= MIN_PLAYERS) {
        btnStart.disabled = false
        const themeLabel = selectedThemes.length === 0
          ? '🎲 Tout mélangé'
          : selectedThemes.length === 1
            ? (() => { const t = Object.values(THEMES).find(t => t.id === selectedThemes[0]); return t ? `${t.emoji} ${t.label}` : '🎲 Tout' })()
            : `${selectedThemes.map(id => { const t = Object.values(THEMES).find(t => t.id === id); return t ? t.emoji : '' }).join('')} ${selectedThemes.length} thèmes`
        startLbl.textContent = `🚀 Lancer · ${themeLabel} (${count} joueurs)`
      } else {
        btnStart.disabled = true
        startLbl.textContent = `En attente de joueurs... (min. ${MIN_PLAYERS})`
      }
    } else {
      hostDiv.classList.add('hidden')
      guestDiv.classList.remove('hidden')
    }
  })

  // ---- Copier code ----
  document.getElementById('btn-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(roomCode); showToast('Code copié !', 'success') }
    catch { showToast(`Code : ${roomCode}`, 'info') }
  })

  // ---- Quitter ----
  document.getElementById('btn-leave').addEventListener('click', async () => {
    cleanup()
    try { isHost ? await deleteRoom(roomCode) : await leaveRoom(roomCode, playerId) } catch {}
    onLeave()
  })

  // ---- Lancer la partie ----
  document.getElementById('btn-start').addEventListener('click', async () => {
    const btn = document.getElementById('btn-start')
    btn.disabled = true
    btn.innerHTML = '<div class="flex items-center justify-center gap-2"><div class="spinner"></div> Chargement...</div>'

    try {
      const { db: database } = await import('../firebase.js')
      const { ref: dbRef, get: dbGet } = await import('firebase/database')
      const snap = await dbGet(dbRef(database, `rooms/${roomCode}`))
      const room = snap.val()

      const playerIds = Object.keys(room.players || {})
      if (playerIds.length < MIN_PLAYERS) {
        showToast('Pas assez de joueurs.', 'error')
        btn.disabled = false
        btn.textContent = '🚀 Lancer la partie'
        return
      }

      // Combiner les paires de tous les thèmes sélectionnés
      const { getPairsForTheme } = await import('../data/words.js')
      const pool = selectedThemes.length === 0
        ? getPairsForTheme('all')
        : selectedThemes.flatMap(id => getPairsForTheme(id))
      const raw = pool[Math.floor(Math.random() * pool.length)]
      // 50% de chance d'inverser civil ↔ undercover
      const wordPair = Math.random() < 0.5
        ? raw
        : { civil: raw.undercover, undercover: raw.civil }
      const assignedRoles = assignRoles(playerIds, wordPair)
      const activePlayers = playerIds.map(id => ({ id, pseudo: room.players[id].pseudo }))
      const twist         = generateTwist(activePlayers)

      await startGame(roomCode, wordPair, assignedRoles, twist, selectedThemes, settings)
    } catch (err) {
      console.error('Erreur démarrage:', err)
      showToast('Erreur lors du lancement.', 'error')
      const b = document.getElementById('btn-start')
      if (b) { b.disabled = false; b.textContent = '🚀 Lancer la partie' }
    }
  })

  function attachThemeListeners(room) {
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const themeId = btn.getAttribute('data-theme')

        if (themeId === 'all') {
          // "Tout mélangé" = réinitialiser la sélection
          selectedThemes = []
        } else {
          // Toggle le thème cliqué
          const idx = selectedThemes.indexOf(themeId)
          if (idx === -1) {
            selectedThemes.push(themeId)
          } else {
            selectedThemes.splice(idx, 1)
          }
        }

        // Persist to Firebase
        const { db: database } = await import('../firebase.js')
        const { ref: dbRef, set: dbSet } = await import('firebase/database')
        await dbSet(dbRef(database, `rooms/${roomCode}/selectedThemes`), selectedThemes)

        // Update UI
        document.getElementById('theme-grid').innerHTML = renderThemeButtons(selectedThemes)
        attachThemeListeners(room)

        const count = Object.keys(room.players || {}).length
        const startLbl = document.getElementById('start-label')
        if (startLbl && count >= MIN_PLAYERS) {
          const themeLabel2 = selectedThemes.length === 0
            ? '🎲 Tout mélangé'
            : selectedThemes.length === 1
              ? (() => { const t = Object.values(THEMES).find(t => t.id === selectedThemes[0]); return t ? `${t.emoji} ${t.label}` : '🎲 Tout' })()
              : `${selectedThemes.map(id => { const t = Object.values(THEMES).find(t => t.id === id); return t ? t.emoji : '' }).join('')} ${selectedThemes.length} thèmes`
          startLbl.textContent = `🚀 Lancer · ${themeLabel2} (${count} joueurs)`
        }
      })
    })
  }

  function updateToggleUI() {
    const notesChk = document.getElementById('setting-notes')
    const toggleNotes = document.getElementById('toggle-notes')
    if (toggleNotes) {
      toggleNotes.style.background = notesChk?.checked ? 'rgba(0,245,212,0.6)' : 'rgba(22,41,82,0.8)'
      toggleNotes.style.borderColor = notesChk?.checked ? 'rgba(0,245,212,0.8)' : 'rgba(22,41,82,0.9)'
    }
  }

  function attachSettingsListeners() {
    document.getElementById('setting-maxscore')?.addEventListener('change', async (e) => {
      settings.maxScore = parseInt(e.target.value)
      await syncSettings()
    })
    document.getElementById('toggle-notes')?.addEventListener('click', async () => {
      const chk = document.getElementById('setting-notes')
      if (chk) { chk.checked = !chk.checked; settings.useNotes = chk.checked }
      updateToggleUI()
      await syncSettings()
    })
  }

  async function syncSettings() {
    try {
      const { db: database } = await import('../firebase.js')
      const { ref: dbRef, set: dbSet } = await import('firebase/database')
      await dbSet(dbRef(database, `rooms/${roomCode}/settings`), settings)
    } catch(e) { console.error('settings sync error', e) }
  }

  function cleanup() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null }
  }
}

function renderThemeButtons(selectedThemes) {
  const sel = Array.isArray(selectedThemes) ? selectedThemes : []
  const allThemes = [THEMES.ALL, ...Object.values(THEMES).filter(t => t.id !== 'all')]
  return allThemes.map(theme => {
    const isAll      = theme.id === 'all'
    const isSelected = isAll ? sel.length === 0 : sel.includes(theme.id)
    return `
      <button class="theme-btn text-left px-3 py-2.5 rounded-lg transition-all text-sm"
        data-theme="${theme.id}"
        style="
          background: ${isSelected ? 'rgba(0,245,212,0.1)' : 'rgba(10,20,40,0.6)'};
          border: 1px solid ${isSelected ? 'rgba(0,245,212,0.5)' : 'rgba(22,41,82,0.6)'};
          color: ${isSelected ? 'var(--cyan-glow)' : 'rgba(226,232,240,0.7)'};
          ${isSelected ? 'box-shadow: 0 0 8px rgba(0,245,212,0.15);' : ''}
        ">
        <span class="mr-1.5">${theme.emoji}</span>
        <span class="font-body text-xs">${theme.label}</span>
        ${isSelected && !isAll ? '<span class="float-right text-xs" style="color: var(--cyan-glow);">✓</span>' : ''}
        ${isAll && sel.length === 0 ? '<span class="float-right text-xs" style="color: var(--cyan-glow);">✓</span>' : ''}
      </button>
    `
  }).join('')
}

function updateRolesPreview(playerCount) {
  const el = document.getElementById('roles-preview')
  if (!el) return
  const civils = playerCount - 1 - (playerCount >= 5 ? 1 : 0) - (playerCount >= 6 ? 1 : 0) - (playerCount >= 7 ? 1 : 0)
  const roles = [
    { count: Math.max(civils, 0), role: 'Civil',       css: 'role-civil',         emoji: '👤' },
    { count: 1,                   role: 'Undercover',  css: 'role-undercover',    emoji: '🕵️' },
  ]
  if (playerCount >= 5) roles.push({ count: 1, role: 'Touriste',     css: 'role-tourist',      emoji: '🗺️' })
  if (playerCount >= 6) roles.push({ count: 1, role: 'La Balance',   css: 'role-indicator',    emoji: '⚖️' })
  if (playerCount >= 7) roles.push({ count: 1, role: 'Agent Double', css: 'role-double-agent', emoji: '🎭' })
  el.innerHTML = roles.filter(r => r.count > 0).map(r => `
    <span class="role-badge ${r.css}">
      ${r.emoji} ${r.count > 1 ? `${r.count}× ` : ''}${r.role}
    </span>
  `).join('')
}