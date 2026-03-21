// =============================================
// ÉCRAN DE JEU
// Gère les phases : revealing → playing → voting → results → ended
// =============================================

import {
  subscribeToRoom, markWordRevealed, startPlayingPhase,
  castVote, processVotes, nextRound, endGame, deleteRoom,
  submitWord, endRound, startNextRound, submitTouristGuess,
} from '../game/roomManager.js'
import { getRoleConfig, checkWinCondition, assignRoles, ROLES } from '../game/roles.js'
import { generateTwist } from '../game/twists.js'
import { formatTwistDescription } from '../game/twists.js'
import { showToast, getAvatarColor } from '../utils.js'

export function renderGameScreen(container, { playerId, roomCode, onGameEnd, onBackToLobby }) {
  let unsubscribe    = null
  let myVote         = null
  let voteSubmitted  = false

  container.innerHTML = `
    <div id="game-container" class="screen flex flex-col min-h-screen px-5 py-6">
      <div class="flex items-center justify-center py-16">
        <div class="spinner"></div>
      </div>
    </div>
  `

  unsubscribe = subscribeToRoom(roomCode, (room) => {
    if (!room) { cleanup(); onGameEnd(); return }

    const me      = room.players?.[playerId]
    if (!me) { cleanup(); onGameEnd(); return }

    switch (room.state) {
      case 'waiting':   cleanup(); onBackToLobby(); break
      case 'revealing': renderRevealPhase(room, me); break
      case 'playing':   renderPlayingPhase(room, me); break
      case 'voting':    renderVotingPhase(room, me); break
      case 'tourist_guess':  renderTouristGuessPhase(room, me); break
      case 'round_end':  renderRoundEndPhase(room, me); break
      case 'results':   renderResultsPhase(room, me); break
      case 'ended':     renderEndedPhase(room, me); break
    }
  })

  // =============================================
  // PHASE 1 : RÉVÉLATION DU MOT
  // =============================================

  function renderRevealPhase(room, me) {
    const players       = Object.values(room.players || {})
    const allRevealed   = players.filter(p => !p.isEliminated).every(p => p.hasRevealedWord)
    const isHost        = room.creatorId === playerId
    const roleConf      = getRoleConfig(me.role)

    document.getElementById('game-container').innerHTML = `
      <div class="flex flex-col min-h-screen">

        <!-- Header -->
        ${renderHeader('Tour ' + room.currentRound, room.currentRound, room)}

        <!-- Twist Banner (if any) -->
        ${room.currentTwist ? renderTwistBanner(room.currentTwist) : ''}

        <div class="flex-1 flex flex-col items-center justify-center gap-8 px-0">

          <!-- Role badge -->
          <div class="text-center">
            <p class="text-xs font-mono uppercase tracking-widest mb-3" style="color: var(--text-muted);">
              Ton rôle
            </p>
            <span class="role-badge ${roleConf.colorClass} text-sm px-4 py-2">
              ${roleConf.emoji} ${roleConf.label}
            </span>
            <p class="text-xs mt-2 max-w-xs text-center" style="color: var(--text-muted);">
              ${roleConf.description}
            </p>
          </div>

          <!-- Word card -->
          ${me.hasRevealedWord
            ? renderWordCardRevealed(me)
            : renderWordCardHidden()
          }

          <!-- Special info for Indicator (knows undercover identity) -->
          ${me.role === ROLES.INDICATOR && me.hasRevealedWord
            ? renderIndicatorInfo(room)
            : ''
          }

        </div>

        <!-- Progress: who has revealed -->
        <div class="mt-auto pt-4">
          <div class="card p-4">
            <div class="flex justify-between items-center mb-3">
              <span class="text-xs font-mono" style="color: var(--text-muted);">
                Mots révélés
              </span>
              <span class="text-xs font-mono" style="color: var(--cyan-glow);">
                ${players.filter(p => !p.isEliminated && p.hasRevealedWord).length} / ${players.filter(p => !p.isEliminated).length}
              </span>
            </div>
            <div class="vote-progress">
              <div class="vote-progress-fill" style="width: ${(players.filter(p => !p.isEliminated && p.hasRevealedWord).length / Math.max(1, players.filter(p => !p.isEliminated).length)) * 100}%"></div>
            </div>
            ${isHost && allRevealed ? `
              <button id="btn-start-playing" class="btn-primary w-full mt-4 text-sm">
                ▶ Commencer les indices
              </button>
            ` : allRevealed ? `
              <p class="text-xs text-center mt-3 font-mono" style="color: var(--cyan-glow);">
                Tous prêts ! En attente de l'hôte...
              </p>
            ` : ''}
          </div>
        </div>
      </div>
    `

    // Clic sur la carte cachée
    if (!me.hasRevealedWord) {
      document.getElementById('word-card-hidden')?.addEventListener('click', async () => {
        await markWordRevealed(roomCode, playerId)
      })
    }

    // Host lance les indices — génère un ordre de parole aléatoire
    if (isHost && (allRevealed || room.isBonusRound)) {
      document.getElementById('btn-start-playing')?.addEventListener('click', async () => {
        const alivePlayers = Object.values(room.players || {}).filter(p => !p.isEliminated)
        const shuffle = arr => {
          const a = [...arr]
          for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]]
          }
          return a
        }
        const ids = alivePlayers.map(p => p.id)
        // Deux passes : ordre 1 puis ordre 2 différent
        const pass1 = shuffle(ids)
        const pass2 = shuffle(ids)
        // Double passe à chaque round : chaque joueur donne 2 indices
        const order = [...pass1, ...pass2]
        await startPlayingPhase(roomCode, order)
      })
    }
  }

  // =============================================
  // PHASE 2 : INDICES (PLAYING)
  // =============================================

  function renderPlayingPhase(room, me) {
    const players        = Object.values(room.players || {}).filter(p => !p.isEliminated)
    const isHost         = room.creatorId === playerId
    const isBonusRound   = room.isBonusRound === true
    const settings       = room.settings || {}
    const useNotes       = !!settings.useNotes
    const useTextInput   = settings.useTextInput !== false  // true by default
    // Convert Firebase wordHistory to arrays (handles null, string, array, or numeric-key object)
    const rawHistory  = room.wordHistory || {}
    const wordHistory = {}
    Object.keys(rawHistory).forEach(uid => {
      const raw = rawHistory[uid]
      if (!raw) { wordHistory[uid] = []; return }
      if (typeof raw === 'string') { wordHistory[uid] = [raw]; return }
      if (Array.isArray(raw)) { wordHistory[uid] = raw.filter(Boolean); return }
      // Firebase object {0: "word1", 1: "word2"} → sorted array
      wordHistory[uid] = Object.keys(raw)
        .sort((a, b) => Number(a) - Number(b))
        .map(k => raw[k])
        .filter(Boolean)
    })

    const speakingOrder = (room.speakingOrder && room.speakingOrder.length > 0) ? room.speakingOrder : players.map(p => p.id)
    const currentIndex  = room.currentSpeakerIndex ?? 0
    const currentSpeakerId = speakingOrder[currentIndex]
    const isMyTurn      = currentSpeakerId === playerId
    const isLastSpeaker = currentIndex >= speakingOrder.length - 1
    const currentSpeaker = players.find(p => p.id === currentSpeakerId)
    const needsOrderGen = isBonusRound && (!room.speakingOrder || room.speakingOrder.length === 0)

    const isDoublePasse = !isBonusRound // tour bonus = 1 seul indice
    const halfLen       = isDoublePasse ? Math.floor(speakingOrder.length / 2) : speakingOrder.length
    const currentPass   = (isDoublePasse && currentIndex >= halfLen) ? 2 : 1
    const indexInPass   = currentPass === 2 ? currentIndex - halfLen : currentIndex

    document.getElementById('game-container').innerHTML = `
      <div class="flex flex-col min-h-screen gap-4">

        ${renderHeader((isBonusRound ? '⚡ Tour BONUS' : 'Tour ' + room.currentRound) + ' — Indices' + (isDoublePasse ? ' · Passe ' + currentPass + '/2' : ''), room.currentRound, room)}
        ${room.currentTwist ? renderTwistBanner(room.currentTwist) : ''}
        ${renderFlippableWordCard(me)}

        <!-- C'est mon tour : texte ou oral selon settings -->
        ${needsOrderGen ? '' : isMyTurn ? `
          <div class="card p-5" style="border-color: rgba(0,245,212,0.5); background: rgba(0,245,212,0.05); box-shadow: 0 0 20px rgba(0,245,212,0.08);">
            <p class="text-xs font-mono uppercase tracking-widest mb-3" style="color: var(--cyan-glow);">🎤 À toi de jouer !</p>
            ${useTextInput ? (() => {
              const twist = room.currentTwist
              const isPhysical = twist?.isPhysicalAction && twist?.targetPlayer === playerId
              if (isPhysical) {
                const actionLabel = twist.id === 'mime' ? '(A mimé)' : twist.id === 'whisper' ? '(A chuchoté)' : '(Action réalisée)'
                return `
                  <p class="text-xs mb-3" style="color: rgba(226,232,240,0.6);">Réalise l'action demandée par le twist, puis valide.</p>
                  <button id="btn-submit-word" class="btn-primary w-full py-3 text-sm" data-physical="${actionLabel}">
                    ✅ Action réalisée
                  </button>
                  <p class="text-xs mt-2 text-center" style="color: var(--text-muted);">
                    ${indexInPass + 1}/${halfLen} · ${isDoublePasse ? 'Passe ' + currentPass + '/2' : 'Tour ' + room.currentRound}
                  </p>
                `
              }
              return `
              <p class="text-xs mb-3" style="color: rgba(226,232,240,0.6);">Donne un mot en rapport avec ton mot secret, sans le dire directement.</p>
              <div class="flex gap-2">
                <input id="word-input" type="text" maxlength="30"
                  placeholder="Ton indice..."
                  class="flex-1 px-4 py-3 rounded-lg text-sm font-body"
                  style="background: rgba(2,8,23,0.8); border: 1px solid rgba(0,245,212,0.3); color: #f8fafc; outline: none;"
                  autocomplete="off" autocorrect="off" />
                <button id="btn-submit-word" class="btn-primary px-5 py-3 text-sm">
                  Envoyer ↵
                </button>
              </div>
              <p class="text-xs mt-2 text-center" style="color: var(--text-muted);">
                ${indexInPass + 1}/${halfLen} · ${isDoublePasse ? 'Passe ' + currentPass + '/2' : 'Tour ' + room.currentRound}
              </p>
            `})() : `
              <p class="text-sm" style="color: rgba(226,232,240,0.8);">Donne ton indice à voix haute, puis l'hôte passera au joueur suivant.</p>
              <p class="text-xs mt-2 text-center font-mono" style="color: var(--text-muted);">
                ${indexInPass + 1}/${halfLen} · Mode oral 🎤
              </p>
            `}
          </div>
        ` : `
          <div class="card p-4 text-center" style="border-color: rgba(245,158,11,0.3); background: rgba(245,158,11,0.04);">
            <p class="text-xs font-mono uppercase tracking-widest mb-2" style="color: var(--amber-glow);">${useTextInput ? "⏳ C'est son tour…" : '🎤 ' + (currentSpeaker ? currentSpeaker.pseudo : '???') + ' parle…'}</p>
            <div class="flex items-center justify-center gap-3">
              <div style="width:36px; height:36px; border-radius:50%; background:${getAvatarColor(currentSpeakerId)}; display:flex; align-items:center; justify-content:center; font-family:'Syne',sans-serif; font-weight:700; font-size:0.8rem;">
                ${currentSpeaker ? currentSpeaker.pseudo.slice(0,2).toUpperCase() : '??'}
              </div>
              <p class="font-display font-bold text-white">${currentSpeaker ? currentSpeaker.pseudo : '???'}</p>
            </div>
            ${useTextInput ? '<div class="flex justify-center mt-3"><div class="spinner"></div></div>' : ''}
          </div>
        `}

        <!-- Ordre de passage + historique mots -->
        <div>
          <p class="text-xs font-mono uppercase tracking-widest mb-2" style="color: var(--text-muted);">
            Ordre de passage
          </p>
          <div class="flex flex-col gap-1.5">
            ${speakingOrder.map((id, idx) => {
              const p         = players.find(pl => pl.id === id)
              const isCurrent = idx === currentIndex
              const isDone    = idx < currentIndex
              const isMe      = id === playerId
              const words    = wordHistory[id] || []
              if (!p) return ''
              const isPassBreak = isDoublePasse && idx === halfLen
              return (isPassBreak ? `
                <div class="flex items-center gap-2 my-1">
                  <div class="flex-1 h-px" style="background: rgba(245,158,11,0.2);"></div>
                  <span class="text-xs font-mono px-2" style="color: var(--amber-glow);">Passe 2</span>
                  <div class="flex-1 h-px" style="background: rgba(245,158,11,0.2);"></div>
                </div>
              ` : idx === 0 && isDoublePasse ? `
                <div class="flex items-center gap-2 mb-1">
                  <div class="flex-1 h-px" style="background: rgba(0,245,212,0.2);"></div>
                  <span class="text-xs font-mono px-2" style="color: var(--cyan-glow);">Passe 1</span>
                  <div class="flex-1 h-px" style="background: rgba(0,245,212,0.2);"></div>
                </div>
              ` : '') + `
              <div class="flex items-start gap-3 px-3 py-2 rounded-lg transition-all"
                style="background:${isCurrent ? 'rgba(0,245,212,0.06)' : isDone ? 'rgba(255,255,255,0.02)' : 'transparent'};
                border:1px solid ${isCurrent ? 'rgba(0,245,212,0.3)' : 'rgba(22,41,82,0.4)'};
                opacity:${isDone ? '0.6' : '1'};">
                <span class="text-xs font-mono w-5 text-center flex-shrink-0 mt-1"
                  style="color:${isCurrent ? 'var(--cyan-glow)' : 'var(--text-muted)'};">
                  ${isDone ? '✓' : isCurrent ? '🎤' : (idx < halfLen ? idx + 1 : idx - halfLen + 1)}
                </span>
                <div style="width:26px; height:26px; min-width:26px; border-radius:50%; background:${getAvatarColor(id)}; display:flex; align-items:center; justify-content:center; font-family:'Syne',sans-serif; font-weight:700; font-size:0.6rem; flex-shrink:0;">
                  ${p.pseudo.slice(0,2).toUpperCase()}
                </div>
                <div class="flex-1 min-w-0">
                  <span class="text-sm ${isCurrent ? 'text-white font-medium' : ''}"
                    style="${isCurrent ? '' : 'color:rgba(226,232,240,0.7)'}">
                    ${p.pseudo}${isMe ? ' <span style="font-size:0.6rem; color:var(--text-muted)">(toi)</span>' : ''}
                  </span>
                  ${useNotes && words.length > 0 ? `
                    <div class="flex flex-wrap gap-1 mt-1">
                      ${(() => {
                        // En passe 1 : afficher seulement le 1er mot
                        // En passe 2 : afficher les 2 mots
                        const visibleWords = isDoublePasse && currentPass === 1
                          ? words.slice(0, 1)
                          : words
                        return visibleWords.map((w, wi) => `<span class="text-xs px-1.5 py-0.5 rounded font-mono" style="background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.2); color:var(--amber-glow);">${wi+1}. ${w}</span>`).join('')
                      })()}
                    </div>
                  ` : ''}
                </div>
              </div>
              `
            }).join('')}
          </div>
        </div>

        ${isHost ? `
          <div class="mt-auto flex flex-col gap-2">
            ${needsOrderGen ? `
              <div class="card p-4 text-center" style="border-color:rgba(245,158,11,0.4);">
                <p class="text-xs font-mono mb-2" style="color:var(--amber-glow);">⚡ Tour bonus — génère l'ordre de passage</p>
                <button id="btn-gen-order" class="btn-warning w-full text-sm">🎲 Générer l'ordre</button>
              </div>
            ` : !useTextInput ? `
              ${!isLastSpeaker ? `
                <button id="btn-next-speaker" class="btn-primary w-full text-base">
                  ➡️ Joueur suivant
                </button>
              ` : ''}
              <button id="btn-go-vote" class="${isLastSpeaker ? 'btn-danger' : 'btn-ghost'} w-full text-base">
                🗳️ ${isLastSpeaker ? 'Passer au vote' : 'Forcer le vote'}
              </button>
            ` : isLastSpeaker && !isMyTurn ? `
              <button id="btn-force-next" class="btn-ghost w-full text-sm">
                ⏭ Passer si quelqu'un est AFK (mode texte)
              </button>
            ` : ''}
          </div>
        ` : ''}

      </div>
    `

    // ── Flip card toggle ──
    attachFlipCardHandler()

    // ── Mode TEXTE : saisie de mot ──
    if (useTextInput && isMyTurn && !needsOrderGen) {
      const input = document.getElementById('word-input')
      const btn   = document.getElementById('btn-submit-word')

      async function doSubmit() {
        // Twist physique : le bouton a un data-physical avec la valeur générique
        const physicalVal = btn?.dataset?.physical
        const word = physicalVal || input?.value?.trim()
        if (!word) { showToast('Écris un mot !', 'info'); return }
        if (btn) btn.disabled = true
        if (input) input.disabled = true
        await submitWord(roomCode, playerId, word)
      }

      btn?.addEventListener('click', doSubmit)
      input?.addEventListener('keydown', e => { if (e.key === 'Enter') doSubmit() })
      if (!btn?.dataset?.physical) setTimeout(() => input?.focus(), 100)
    }

    // ── Mode ORAL : boutons hôte ──
    if (!useTextInput && isHost && !needsOrderGen) {
      // Passer au joueur suivant
      document.getElementById('btn-next-speaker')?.addEventListener('click', async () => {
        const { db: database } = await import('../firebase.js')
        const { ref: dbRef, set: dbSet } = await import('firebase/database')
        await dbSet(dbRef(database, `rooms/${roomCode}/currentSpeakerIndex`), currentIndex + 1)
      })

      // Passer au vote quand tout le monde a parlé
      document.getElementById('btn-go-vote')?.addEventListener('click', async () => {
        const { db: database } = await import('../firebase.js')
        const { ref: dbRef, update: dbUpdate } = await import('firebase/database')
        await dbUpdate(dbRef(database, `rooms/${roomCode}`), { state: 'voting', votes: {} })
      })
    }

    // ── Bonus round order generation : seulement les joueurs à égalité ──
    if (isHost && needsOrderGen) {
      document.getElementById('btn-gen-order')?.addEventListener('click', async () => {
        // En tour bonus : tirer au sort seulement les tiedPlayers (ou tous si absent)
        const tiedIds = room.tiedPlayers && room.tiedPlayers.length > 0
          ? room.tiedPlayers
          : players.map(p => p.id)
        const eligibles = players.filter(p => tiedIds.includes(p.id)).map(p => p.id)
        const ids = eligibles.length > 0 ? eligibles : players.map(p => p.id)
        const shuffle = arr => {
          const a = [...arr]
          for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]]
          }
          return a
        }
        const order = shuffle(ids)
        await startPlayingPhase(roomCode, order)
      })
    }

    // ── AFK skip (mode texte uniquement) ──
    if (useTextInput && isHost && !needsOrderGen) {
      document.getElementById('btn-force-next')?.addEventListener('click', async () => {
        await submitWord(roomCode, currentSpeakerId, '(passé)')
      })
    }
  }

  // =============================================
  // PHASE 3 : VOTE
  // =============================================

  function renderVotingPhase(room, me) {
    if (me.isEliminated) {
      renderEliminatedWaiting()
      return
    }

    const alivePlayers  = Object.values(room.players || {}).filter(p => !p.isEliminated)
    const votes         = room.votes || {}
    const myCurrentVote = votes[playerId] || null
    voteSubmitted       = !!myCurrentVote
    const allVoted      = Object.keys(votes).length >= alivePlayers.length
    const isTiebreak    = false

    document.getElementById('game-container').innerHTML = `
      <div class="flex flex-col min-h-screen gap-5">

        ${renderHeader('Tour ' + room.currentRound + ' — Vote', room.currentRound, room)}

        <!-- Rappel -->
        ${renderFlippableWordCard(me)}

        <!-- Instruction vote -->
        <div class="twist-banner p-4">
          <p class="text-xs font-mono uppercase tracking-widest mb-1" style="color: var(--amber-glow);">
            🗳️ Qui est l'Undercover ?
          </p>
          <p class="text-sm" style="color: rgba(226,232,240,0.7);">
            Vote pour le joueur que tu suspectes.
          </p>
        </div>

        <!-- Vote buttons -->
        <div class="flex flex-col gap-2">
          ${alivePlayers
            .filter(p => p.id !== playerId)
            .map(p => {
              const voteCount = Object.values(votes).filter(v => v === p.id).length
              const isSelected = myCurrentVote === p.id
              return `
                <button
                  class="vote-btn ${isSelected ? 'selected' : ''}"
                  data-player-id="${p.id}"
                  ${allVoted && !isSelected ? 'disabled' : ''}
                >
                  <div class="flex items-center gap-3">
                    <div class="player-avatar w-8 h-8 text-xs" style="background: ${getAvatarColor(p.id)}; width:32px; height:32px; min-width:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-family:'Syne',sans-serif; font-weight:700;">
                      ${p.pseudo.slice(0, 2).toUpperCase()}
                    </div>
                    <span class="font-body text-sm">${p.pseudo}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    ${voteCount > 0 ? `<span class="text-xs font-mono px-2 py-0.5 rounded" style="background: rgba(239,68,68,0.1); color: #ef4444;">${voteCount} vote${voteCount > 1 ? 's' : ''}</span>` : ''}
                    ${isSelected ? `<span style="color: #ef4444; font-size: 0.7rem;">${allVoted ? '✓' : '✓ changer ?'}</span>` : ''}
                  </div>
                </button>
              `
            }).join('')}
        </div>

        <!-- Compteur votes -->
        <div class="card p-4">
          <div class="flex justify-between items-center mb-2">
            <span class="text-xs font-mono" style="color: var(--text-muted);">Votes reçus</span>
            <span class="text-xs font-mono" style="color: var(--cyan-glow);">
              ${Object.keys(votes).length} / ${alivePlayers.length}
            </span>
          </div>
          <div class="vote-progress">
            <div class="vote-progress-fill" style="width: ${(Object.keys(votes).length / Math.max(1, alivePlayers.length)) * 100}%"></div>
          </div>
        </div>

        <!-- Host: finaliser le vote -->
        ${room.creatorId === playerId ? (() => {
          const voteCount  = Object.keys(votes).length
          const totalAlive = alivePlayers.length
          const allVoted   = voteCount >= totalAlive
          const noVote     = voteCount === 0
          const missing    = totalAlive - voteCount
          return `
            <div class="mt-auto flex flex-col gap-2">
              ${!allVoted && !noVote ? `
                <p class="text-xs text-center font-mono" style="color: var(--amber-glow);">
                  ⚠️ ${missing} joueur${missing > 1 ? 's n\'ont' : ' n\'a'} pas encore voté
                </p>
              ` : ''}
              <button id="btn-finalize-vote" class="w-full text-base ${allVoted ? 'btn-danger' : noVote ? 'btn-ghost' : 'btn-warning'}"
                ${noVote ? 'disabled' : ''}>
                ⚖️ ${allVoted ? 'Finaliser les votes' : noVote ? 'En attente de votes...' : 'Forcer la finalisation'}
              </button>
            </div>
          `
        })() : ''}
      </div>
    `

    // ── Flip card toggle ──
    attachFlipCardHandler()

    // Voter (et changer de vote si tout le monde n'a pas encore voté)
    document.querySelectorAll('.vote-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (allVoted) return  // plus de changement une fois tout le monde a voté
        const targetId = btn.getAttribute('data-player-id')
        const isChanging = voteSubmitted && myVote !== targetId
        myVote = targetId
        voteSubmitted = true
        await castVote(roomCode, playerId, targetId)
        showToast(isChanging ? 'Vote modifié !' : 'Vote enregistré !', 'success')
      })
    })

    // Auto-finalisation si tout le monde a voté
    const autoVoteCount  = Object.keys(votes).length
    const autoTotalAlive = alivePlayers.length
    const autoIsHost     = room.creatorId === playerId
    if (autoVoteCount >= autoTotalAlive && autoTotalAlive > 0 && autoIsHost) {
      setTimeout(async () => {
        const result = await processVotes(roomCode)
        if (result?.bonusRound)    showToast("Égalité ! Tour bonus lancé (1 indice chacun).", 'info')
        else if (result?.bonusTieWin) showToast("Égalité au tour bonus ! L'Undercover gagne la manche.", 'info')
      }, 800)
    }

    // Hôte finalise manuellement
    document.getElementById('btn-finalize-vote')?.addEventListener('click', async () => {
      if (Object.keys(votes).length === 0) return
      const btn = document.getElementById('btn-finalize-vote')
      if (btn) { btn.disabled = true; btn.textContent = 'Calcul...' }
      const result = await processVotes(roomCode)
      if (result?.bonusRound)    showToast("Égalité ! Tour bonus lancé (1 indice chacun).", 'info')
      else if (result?.bonusTieWin) showToast("Égalité au tour bonus ! L'Undercover gagne la manche.", 'info')
    })
  }

  // =============================================
  // PHASE 3b : RE-VOTE (TIEBREAK)
  // =============================================


  // =============================================
  // PHASE 3c : DEVINETTE DU TOURISTE
  // =============================================

  function renderTouristGuessPhase(room, me) {
    const touristId = room.touristGuessPlayerId
    const isTourist = me.id === touristId
    const tourist   = room.players?.[touristId]
    const isHost    = room.creatorId === playerId
    const settings  = room.settings || {}
    const useText   = settings.useTextInput !== false

    document.getElementById('game-container').innerHTML = `
      <div class="flex flex-col min-h-screen gap-5">
        ${renderHeader('Chance du Touriste', room.currentRound, room)}

        <!-- Bannière -->
        <div class="card p-5 text-center" style="border-color: rgba(245,158,11,0.5); background: rgba(245,158,11,0.05);">
          <p class="text-3xl mb-2">🗺️</p>
          <p class="font-display font-bold text-xl" style="color: var(--amber-glow);">
            ${tourist ? tourist.pseudo : 'Le Touriste'} a été éliminé !
          </p>
          <p class="text-sm mt-2" style="color: rgba(226,232,240,0.7);">
            ${isTourist
              ? "C'est ta dernière chance ! Tu peux deviner le mot civil pour remporter la manche."
              : "Le Touriste a une dernière chance de deviner le mot civil pour gagner !"}
          </p>
        </div>

        ${isTourist ? `
          <!-- Zone de devinette — Touriste uniquement -->
          <div class="card p-5" style="border-color: rgba(245,158,11,0.4); background: rgba(245,158,11,0.04);">
            <p class="text-xs font-mono uppercase tracking-widest mb-3" style="color: var(--amber-glow);">
              🔍 Quel est le mot des Civils ?
            </p>
            ${useText ? `
              <div class="flex gap-2">
                <input id="tourist-guess-input" type="text" maxlength="30"
                  placeholder="Tape le mot civil..."
                  class="flex-1 px-4 py-3 rounded-lg text-sm font-body"
                  style="background: rgba(2,8,23,0.8); border: 1px solid rgba(245,158,11,0.4); color: #f8fafc; outline: none;"
                  autocomplete="off" autocorrect="off" />
                <button id="btn-tourist-guess" class="btn-warning px-5 py-3 text-sm">
                  Valider ↵
                </button>
              </div>
              <p class="text-xs mt-2 text-center" style="color: var(--text-muted);">
                Une seule tentative — bonne chance !
              </p>
            ` : `
              <p class="text-sm mb-3" style="color: rgba(226,232,240,0.7);">
                Dis ton mot à voix haute. L'hôte validera ta réponse.
              </p>
              <div class="flex gap-2">
                <button id="btn-tourist-correct" class="btn-primary flex-1">✅ Correct !</button>
                <button id="btn-tourist-wrong" class="btn-danger flex-1">❌ Faux</button>
              </div>
            `}
          </div>
        ` : isHost && !useText ? `
          <!-- Hôte valide en mode oral -->
          <div class="card p-5 text-center" style="border-color: rgba(245,158,11,0.3);">
            <p class="text-sm mb-4" style="color: rgba(226,232,240,0.8);">
              Écoute la réponse de <strong>${tourist ? tourist.pseudo : 'Le Touriste'}</strong> et valide :
            </p>
            <div class="flex gap-3">
              <button id="btn-tourist-correct" class="btn-primary flex-1">✅ Correct !</button>
              <button id="btn-tourist-wrong" class="btn-danger flex-1">❌ Faux</button>
            </div>
          </div>
        ` : `
          <!-- Autres joueurs en attente -->
          <div class="card p-4 text-center">
            <p class="text-sm" style="color: var(--text-muted);">
              ${useText
                ? `En attente que ${tourist ? tourist.pseudo : 'le Touriste'} tape sa réponse…`
                : `${tourist ? tourist.pseudo : 'Le Touriste'} donne sa réponse à voix haute…`}
            </p>
            <div class="flex justify-center mt-3"><div class="spinner"></div></div>
          </div>
        `}

        <!-- Le mot est visible seulement pour ceux qui le connaissent -->
        ${!isTourist ? renderFlippableWordCard(me) : ''}
      </div>
    `

    // Mode texte — le touriste soumet sa réponse
    if (isTourist && useText) {
      const input = document.getElementById('tourist-guess-input')
      const btn   = document.getElementById('btn-tourist-guess')

      async function doGuess() {
        const guess = input?.value?.trim()
        if (!guess) { showToast('Écris un mot !', 'info'); return }
        if (btn) btn.disabled = true
        if (input) input.disabled = true
        const result = await submitTouristGuess(roomCode, guess)
        if (!result.correct) {
          showToast('Raté ! Le jeu continue…', 'error')
        }
      }

      btn?.addEventListener('click', doGuess)
      input?.addEventListener('keydown', e => { if (e.key === 'Enter') doGuess() })
      setTimeout(() => input?.focus(), 100)
    }

    // Mode oral — l'hôte valide (ou mode texte inaccessible pour hôte)
    if (isHost || (!useText && isHost)) {
      document.getElementById('btn-tourist-correct')?.addEventListener('click', async () => {
        await submitTouristGuess(roomCode, room.wordPair?.civil || '')
      })
      document.getElementById('btn-tourist-wrong')?.addEventListener('click', async () => {
        await submitTouristGuess(roomCode, '__wrong__')
      })
    }

    // Flip card pour les non-touristes
    if (!isTourist) attachFlipCardHandler()
  }

  // =============================================
  // PHASE 4 : RÉSULTATS D'ÉLIMINATION
  // =============================================

  function renderResultsPhase(room, me) {
    const eliminated    = room.eliminatedThisRound
    const elPlayer      = eliminated ? room.players?.[eliminated] : null
    const isHost        = room.creatorId === playerId
    const players       = Object.values(room.players || {})
    const alive         = players.filter(p => !p.isEliminated)

    // Limite de tours dynamique selon nombre total de joueurs au départ
    const totalPlayers  = players.length
    const maxRounds     = totalPlayers <= 3 ? 1 : totalPlayers === 4 ? 2 : 3
    const roundLimitHit = room.currentRound >= maxRounds

    // roundWinner is set by processVotes — use it to determine win condition
    let winResult
    const roundWinner = room.roundWinner
    if (roundWinner === 'civil') {
      winResult = { gameOver: true, winners: [ROLES.CIVIL, ROLES.INDICATOR], reason: "L'Undercover a été démasqué ! Les Civils gagnent !" }
    } else if (roundWinner === 'undercover') {
      winResult = { gameOver: true, winners: [ROLES.UNDERCOVER], reason: "L'Undercover prend le contrôle !" }
    } else if (roundWinner === 'agent_double') {
      winResult = { gameOver: true, winners: [ROLES.DOUBLE_AGENT], reason: "L'Agent Double s'est fait éliminer en premier ! Il gagne !" }
    } else if (roundWinner === 'tourist') {
      winResult = { gameOver: true, winners: [ROLES.TOURIST], reason: "Le Touriste a deviné le mot ! Il gagne !" }
    } else if (roundLimitHit) {
      winResult = { gameOver: true, winners: [ROLES.UNDERCOVER], reason: "Limite de tours atteinte ! L'Undercover n'a pas été démasqué.", roundLimit: true }
    } else {
      winResult = checkWinCondition(room.players || {})
    }

    document.getElementById('game-container').innerHTML = `
      <div class="flex flex-col min-h-screen gap-5">

        ${renderHeader('Résultats', room.currentRound, room)}

        <!-- Eliminated player card -->
        ${elPlayer ? `
          <div class="card p-6 text-center" style="border-color: rgba(239,68,68,0.3);">
            <p class="text-xs font-mono uppercase tracking-widest mb-4" style="color: #ef4444;">
              ☠️ Éliminé
            </p>
            <div class="player-avatar mx-auto mb-3" style="background: ${getAvatarColor(elPlayer.id)}; width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-family: 'Syne', sans-serif; font-weight: 700; font-size: 1.2rem;">
              ${elPlayer.pseudo.slice(0, 2).toUpperCase()}
            </div>
            <p class="text-xl font-display font-bold mb-1">${elPlayer.pseudo}</p>
            <span class="role-badge ${getRoleConfig(elPlayer.role).colorClass}">
              ${getRoleConfig(elPlayer.role).emoji} ${getRoleConfig(elPlayer.role).label}
            </span>
            ${elPlayer.secretWord ? `
              <p class="text-sm mt-3" style="color: var(--text-muted);">
                Son mot était : <strong class="text-white">${elPlayer.secretWord}</strong>
              </p>
            ` : `
              <p class="text-sm mt-3" style="color: var(--text-muted);">Il n'avait aucun mot.</p>
            `}
          </div>
        ` : `
          <div class="card p-6 text-center" style="border-color: rgba(245,158,11,0.3);">
            <p class="text-2xl mb-2">🤝</p>
            <p class="font-display font-bold text-lg" style="color: var(--amber-glow);">Égalité !</p>
            <p class="text-sm mt-2" style="color: var(--text-muted);">Personne n'est éliminé ce tour.</p>
          </div>
        `}

        <!-- Joueurs restants -->
        <div>
          <p class="text-xs font-mono uppercase tracking-widest mb-3" style="color: var(--text-muted);">
            Survivants (${alive.length})
          </p>
          <div class="flex flex-wrap gap-2">
            ${alive.map(p => `
              <div class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
                style="background: rgba(10,20,40,0.6); border: 1px solid rgba(22,41,82,0.6);">
                <div style="width:20px; height:20px; border-radius:50%; background:${getAvatarColor(p.id)}; display:flex; align-items:center; justify-content:center; font-size:0.6rem; font-weight:700;">
                  ${p.pseudo.slice(0, 1).toUpperCase()}
                </div>
                ${p.pseudo}
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Compteur de tours -->
        <div class="card p-3 flex justify-between items-center">
          <span class="text-xs font-mono" style="color: var(--text-muted);">Tours joués</span>
          <div class="flex gap-1.5">
            ${Array.from({length: maxRounds}, (_, i) => `
              <div style="width:10px; height:10px; border-radius:50%;
                background: ${i < room.currentRound ? 'var(--cyan-glow)' : 'rgba(226,232,240,0.1)'};
                border: 1px solid ${i < room.currentRound ? 'var(--cyan-glow)' : 'rgba(226,232,240,0.2)'};
              "></div>
            `).join('')}
          </div>
          <span class="text-xs font-mono" style="color: ${roundLimitHit ? '#ef4444' : 'var(--cyan-glow)'};">
            ${room.currentRound}/${maxRounds} ${roundLimitHit ? '⚠️' : ''}
          </span>
        </div>

        <!-- Suite -->
        ${isHost ? `
          <div class="mt-auto flex flex-col gap-3">
            ${winResult.gameOver ? `
              ${winResult.roundLimit ? `
                <div class="card p-3 text-center" style="border-color: rgba(239,68,68,0.3);">
                  <p class="text-xs font-mono" style="color: #ef4444;">⏱️ Limite de tours atteinte</p>
                </div>
              ` : ''}
              <button id="btn-see-scores" class="btn-primary w-full text-base">
                🏆 Voir les scores
              </button>
            ` : `
              <button id="btn-next-tour" class="btn-primary w-full text-base">
                ▶ Tour suivant
              </button>
              <button id="btn-end-game-early" class="btn-ghost w-full text-sm">
                Terminer la partie
              </button>
            `}
          </div>
        ` : `
          <div class="mt-auto text-center">
            <p class="text-sm" style="color: var(--text-muted);">En attente de l'hôte...</p>
          </div>
        `}
      </div>
    `

    // Fin de round → calcul des scores (uniquement si quelqu'un a gagné)
    document.getElementById('btn-see-scores')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-see-scores')
      if (btn) { btn.disabled = true; btn.textContent = 'Calcul des scores...' }
      await endRound(roomCode, winResult)
    })

    // Tour suivant dans la même manche (roundWinner=null, jeu continue)
    document.getElementById('btn-next-tour')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-next-tour')
      if (btn) { btn.disabled = true; btn.textContent = 'Chargement...' }
      const { generateTwist } = await import('../game/twists.js')
      const alivePlayers = Object.values(room.players || {})
        .filter(p => !p.isEliminated)
        .map(p => ({ id: p.id, pseudo: p.pseudo }))
      const twist = generateTwist(alivePlayers)
      await nextRound(roomCode, twist)
      voteSubmitted = false
    })

    // Arrêt forcé → classe les joueurs par score actuel
    document.getElementById('btn-end-game-early')?.addEventListener('click', async () => {
      await endGame(roomCode, { forced: true })
    })
  }

  // =============================================
  // PHASE 4b : FIN DE MANCHE + SCORES
  // =============================================

  function renderRoundEndPhase(room, me) {
    const isHost      = room.creatorId === playerId
    const players     = Object.values(room.players || {})
    const scores      = room.scores || {}
    const delta       = room.deltaScores || {}
    const settings    = room.settings || {}
    const maxScore    = settings.maxScore || 20
    const maxReached  = room.maxScoreReached
    const winningSide = room.winningSide
    // En V2, la fin de PARTIE est uniquement basée sur le score max atteint
    // (roundLimitHit ne force pas la fin du jeu — il détermine juste qui gagne la manche)
    const forceEnd    = !!maxReached

    // Sort by score desc
    const ranked = [...players].sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0))

    document.getElementById('game-container').innerHTML = `
      <div class="flex flex-col min-h-screen gap-4">
        ${renderHeader('Fin de manche ' + room.currentRound, room.currentRound, room)}

        <!-- Résultat manche -->
        <div class="card p-5 text-center" style="border-color: ${winningSide === 'civil' ? 'rgba(0,245,212,0.4)' : 'rgba(239,68,68,0.4)'}; background: ${winningSide === 'civil' ? 'rgba(0,245,212,0.05)' : 'rgba(239,68,68,0.05)'};">
          <p class="text-3xl mb-2">${room.bonusTieWin ? '⚖️' : winningSide === 'civil' ? '🎉' : '🕵️'}</p>
          <p class="font-display font-bold text-xl" style="color: ${winningSide === 'civil' ? 'var(--cyan-glow)' : '#ef4444'};">
            ${room.bonusTieWin
              ? "Égalité au tour bonus ! L'Undercover gagne la manche."
              : winningSide === 'civil' ? 'Les Civils gagnent cette manche !' : "L'Undercover gagne cette manche !"}
          </p>
          <p class="text-xs font-mono mt-2" style="color: var(--text-muted);">
            ${winningSide === 'civil' ? '+2 pts par Civil en vie' : '+5 pts Undercover (vivant)'}
          </p>
        </div>

        <!-- Scores -->
        <div>
          <p class="text-xs font-mono uppercase tracking-widest mb-3" style="color: var(--text-muted);">
            🏆 Classement · Objectif : ${maxScore} pts
          </p>
          <!-- Progress bar global -->
          <div class="card p-3 mb-3">
            <div class="flex justify-between text-xs font-mono mb-2" style="color: var(--text-muted);">
              <span>Progression</span><span>${maxScore} pts pour gagner</span>
            </div>
            <div style="background: rgba(22,41,82,0.6); border-radius: 4px; height: 4px; overflow: hidden;">
              <div style="height: 100%; background: linear-gradient(90deg, var(--cyan-glow), var(--amber-glow)); border-radius:4px; width: ${Math.min(100, (Math.max(...Object.values(scores).map(Number)) / maxScore) * 100)}%;"></div>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            ${ranked.map((p, rank) => {
              const sc   = scores[p.id] || 0
              const d    = delta[p.id] || 0
              const pct  = Math.min(100, (sc / maxScore) * 100)
              const rc   = getRoleConfig(p.role)
              return `
                <div class="card p-4" style="${rank === 0 ? 'border-color: rgba(245,158,11,0.4); background: rgba(245,158,11,0.04);' : ''}">
                  <div class="flex items-center gap-3 mb-2">
                    <span class="text-base font-display font-bold flex-shrink-0" style="color: ${rank === 0 ? 'var(--amber-glow)' : 'var(--text-muted)'}; width: 20px;">
                      ${rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : rank + 1}
                    </span>
                    <div class="player-avatar flex-shrink-0" style="background: ${getAvatarColor(p.id)}; width:32px; height:32px; min-width:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-family:'Syne',sans-serif; font-weight:700; font-size:0.7rem;">
                      ${p.pseudo.slice(0,2).toUpperCase()}
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="text-sm font-medium text-white truncate">${p.pseudo}</span>
                        <span class="role-badge ${rc.colorClass}" style="font-size:0.55rem; padding:1px 5px;">${rc.emoji} ${rc.label}</span>
                      </div>
                    </div>
                    <div class="flex items-baseline gap-1 flex-shrink-0">
                      <span class="text-lg font-display font-bold" style="color: var(--cyan-glow);">${sc}</span>
                      <span class="text-xs font-mono" style="color: var(--text-muted);">/ ${maxScore}</span>
                      ${d > 0 ? `<span class="text-xs font-mono font-bold ml-1" style="color: #4ade80;">+${d}</span>` : ''}
                    </div>
                  </div>
                  <!-- Score bar -->
                  <div style="background: rgba(22,41,82,0.6); border-radius: 3px; height: 3px; overflow: hidden;">
                    <div style="height: 100%; width: ${pct}%; background: ${sc >= maxScore ? '#f59e0b' : 'var(--cyan-glow)'}; border-radius:3px; transition: width 0.6s ease;"></div>
                  </div>
                </div>
              `
            }).join('')}
          </div>
        </div>

        ${forceEnd ? `
          <div class="card p-4 text-center" style="border-color: rgba(245,158,11,0.5); background: rgba(245,158,11,0.06);">
            <p class="text-2xl mb-1">${maxReached ? '🏆' : '⏱️'}</p>
            <p class="font-display font-bold text-lg" style="color: var(--amber-glow);">
              ${maxReached ? 'Score maximum atteint !' : 'Limite de manches atteinte !'}
            </p>
            <p class="text-xs mt-1" style="color: var(--text-muted);">La victoire finale va être révélée…</p>
          </div>
        ` : ''}

        <!-- CTA hôte -->
        ${isHost ? `
          <div class="mt-auto flex flex-col gap-2">
            ${forceEnd ? `
              <button id="btn-final-victory" class="btn-danger w-full text-base">
                🏆 Voir le classement final
              </button>
            ` : `
              <button id="btn-next-round" class="btn-primary w-full text-base">
                ▶ Manche suivante
              </button>
              <button id="btn-end-early" class="btn-ghost w-full text-sm">Terminer la partie</button>
            `}
          </div>
        ` : `
          <div class="mt-auto text-center py-4">
            <p class="text-sm" style="color: var(--text-muted);">En attente de l'hôte…</p>
            <div class="flex justify-center mt-3 gap-1">
              <div class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style="animation-delay:0ms"></div>
              <div class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style="animation-delay:150ms"></div>
              <div class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style="animation-delay:300ms"></div>
            </div>
          </div>
        `}
      </div>
    `

    // Manche suivante
    document.getElementById('btn-next-round')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-next-round')
      if (btn) { btn.disabled = true; btn.textContent = 'Préparation…' }
      try {
        const { getPairsForTheme } = await import('../data/words.js')
        const { assignRoles } = await import('../game/roles.js')
        const { generateTwist } = await import('../game/twists.js')
        const { db: database } = await import('../firebase.js')
        const { ref: dbRef, get: dbGet } = await import('firebase/database')

        const snap = await dbGet(dbRef(database, `rooms/${roomCode}`))
        const freshRoom = snap.val()
        const playerIds = Object.keys(freshRoom.players || {})
        const st = Array.isArray(freshRoom.selectedThemes) ? freshRoom.selectedThemes : []
        const pool = st.length === 0 ? getPairsForTheme('all') : st.flatMap(id => getPairsForTheme(id))
        const raw = pool[Math.floor(Math.random() * pool.length)]
        const wordPair = Math.random() < 0.5 ? raw : { civil: raw.undercover, undercover: raw.civil }
        const freshSettings = freshRoom.settings || {}
        const assignedRoles = assignRoles(playerIds, wordPair, freshSettings)
        const alivePseudos  = playerIds.map(id => ({ id, pseudo: freshRoom.players[id].pseudo }))
        const twist = generateTwist(alivePseudos)

        await startNextRound(roomCode, wordPair, assignedRoles, twist, st)
        voteSubmitted = false
      } catch(e) {
        console.error('next round error', e)
        showToast('Erreur lors du lancement de la manche.', 'error')
        const b = document.getElementById('btn-next-round')
        if (b) { b.disabled = false; b.textContent = '▶ Manche suivante' }
      }
    })

    // Victoire finale — gère l'égalité parfaite
    document.getElementById('btn-final-victory')?.addEventListener('click', async () => {
      const topScore = Math.max(...Object.values(scores).map(Number))
      const winners  = players.filter(p => (scores[p.id] || 0) >= topScore)
      await endGame(roomCode, {
        gameOver:    true,
        winners:     winners.map(p => p.role),
        winnerIds:   winners.map(p => p.id),
        finalScores: scores,
        equality:    winners.length > 1,
        reason:      winners.length === 1
          ? `🏆 ${winners[0].pseudo} remporte la partie avec ${topScore} pts !`
          : `🤝 Égalité parfaite ! ${winners.map(p => p.pseudo).join(' & ')} gagnent ex-æquo avec ${topScore} pts !`,
      })
    })

    // Arrêt forcé depuis fin de manche
    document.getElementById('btn-end-early')?.addEventListener('click', async () => {
      await endGame(roomCode, { forced: true })
    })
  }

  // =============================================
  // PHASE 5 : FIN DE PARTIE
  // =============================================

  function renderEndedPhase(room, me) {
    const result   = room.gameResult
    const players  = Object.values(room.players || {})
    const isHost   = room.creatorId === playerId
    const scores   = result?.finalScores || room.scores || {}
    const winnerIds = result?.winnerIds || []
    const settings = room.settings || {}
    const maxScore = settings.maxScore || 20

    const ranked = [...players].sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0))

    document.getElementById('game-container').innerHTML = `
      <div class="flex flex-col min-h-screen gap-5">

        ${renderHeader('Victoire Finale 🏆', room.currentRound, room)}

        <!-- Winner banner -->
        <div class="card p-6 text-center" style="border-color: ${result?.forced ? 'rgba(148,163,184,0.3)' : result?.equality ? 'rgba(99,102,241,0.5)' : 'rgba(245,158,11,0.5)'}; background: ${result?.forced ? 'rgba(148,163,184,0.04)' : result?.equality ? 'rgba(99,102,241,0.05)' : 'rgba(245,158,11,0.06)'};">
          <p class="text-4xl mb-3">${result?.forced ? '🛑' : result?.equality ? '🤝' : '🏆'}</p>
          <p class="font-display font-bold text-xl" style="color: ${result?.forced ? 'rgba(148,163,184,0.8)' : result?.equality ? '#818cf8' : 'var(--amber-glow)'};">
            ${result?.reason || 'La partie est terminée !'}
          </p>
          ${result?.forced ? '<p class="text-xs mt-2 font-mono" style="color: var(--text-muted);">Classement au moment de l\'arrêt</p>' : ''}
        </div>

        <!-- Classement final avec scores -->
        <div>
          <p class="text-xs font-mono uppercase tracking-widest mb-3" style="color: var(--text-muted);">
            Classement final
          </p>
          <div class="flex flex-col gap-2">
            ${ranked.map((p, rank) => {
              const rc      = getRoleConfig(p.role)
              const sc      = scores[p.id] || 0
              const isWin   = winnerIds.includes(p.id)
              const pct     = Math.min(100, (sc / maxScore) * 100)
              return `
                <div class="card p-4 ${isWin ? 'glow-cyan' : ''}"
                  style="${isWin ? 'border-color: rgba(245,158,11,0.4); background: rgba(245,158,11,0.05);' : ''}">
                  <div class="flex items-center gap-3 mb-2">
                    <span class="text-base font-display font-bold flex-shrink-0" style="color: ${rank === 0 ? 'var(--amber-glow)' : 'var(--text-muted)'}; width:20px;">
                      ${rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : rank+1}
                    </span>
                    <div class="player-avatar flex-shrink-0" style="background: ${getAvatarColor(p.id)}; width:34px; height:34px; min-width:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-family:'Syne',sans-serif; font-weight:700; font-size:0.75rem;">
                      ${p.pseudo.slice(0,2).toUpperCase()}
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-sm font-medium text-white truncate">${p.pseudo}</span>
                        ${isWin ? '<span style="color:var(--amber-glow); font-size:0.75rem;">🏆 Gagnant</span>' : ''}
                        <span class="role-badge ${rc.colorClass}" style="font-size:0.55rem; padding:1px 5px;">${rc.emoji} ${rc.label}</span>
                      </div>
                      ${p.secretWord ? `<p class="text-xs mt-0.5" style="color: var(--text-muted);">Mot : "${p.secretWord}"</p>` : ''}
                    </div>
                    <span class="text-xl font-display font-bold flex-shrink-0" style="color: ${isWin ? 'var(--amber-glow)' : 'var(--cyan-glow)'};">
                      ${sc} <span class="text-xs font-mono" style="color:var(--text-muted);">pts</span>
                    </span>
                  </div>
                  <div style="background: rgba(22,41,82,0.6); border-radius:3px; height:3px; overflow:hidden;">
                    <div style="height:100%; width:${pct}%; background:${isWin ? '#f59e0b' : 'var(--cyan-glow)'}; border-radius:3px;"></div>
                  </div>
                </div>
              `
            }).join('')}
          </div>
        </div>

        <!-- Actions -->
        <div class="mt-auto flex flex-col gap-3">
          ${isHost ? `
            <button id="btn-new-game" class="btn-primary w-full">
              🔄 Nouvelle partie
            </button>
          ` : ''}
          <button id="btn-home" class="btn-ghost w-full text-sm">← Retour à l'accueil</button>
        </div>
      </div>
    `

    document.getElementById('btn-home')?.addEventListener('click', () => { cleanup(); onGameEnd() })

    document.getElementById('btn-new-game')?.addEventListener('click', async () => {
      const { db: database } = await import('../firebase.js')
      const { ref: dbRef, update: dbUpdate } = await import('firebase/database')
      const resetPlayers = {}
      players.forEach(p => {
        resetPlayers[p.id] = { ...p, role: null, secretWord: null, isEliminated: false, hasRevealedWord: false }
      })
      const resetScores = {}
      players.forEach(p => { resetScores[p.id] = 0 })
      await dbUpdate(dbRef(database, `rooms/${roomCode}`), {
        state: 'waiting', currentRound: 0,
        wordPair: null, currentTwist: null, eliminatedThisRound: null,
        gameResult: null, votes: {}, wordHistory: {},
        scores: resetScores, deltaScores: null,
        isTiebreak: false, isBonusRound: false, tiedPlayers: null,
        players: resetPlayers,
      })
    })
  }

  // =============================================
  // HELPERS DE RENDU
  // =============================================

  function renderHeader(title, round, room) {
    const MINI_THEMES = {
      all:'🎲 Tout mélangé', food:'🍽️ Nourriture', sport:'⚽ Sport',
      tech:'📱 Tech', cinema:'🎬 Cinéma', travel:'🌍 Voyage',
      music:'🎵 Musique', home:'🏠 Maison', animals:'🐾 Animaux',
      games:'🎮 Jeux', school:'🎓 École', fashion:'👗 Mode',
      drinks:'🍹 Boissons', body:'💪 Santé', nature:'🌿 Nature', culture:'🤣 Culture',
      foot:'⚽ Football', manga:'🎌 Manga & Animé', islam:'🌙 Islam',
    }
    // Support both old selectedTheme (string) and new selectedThemes (array/JSON)
    let themeLabel = ''
    const rawThemes = room?.selectedThemes
    if (rawThemes !== undefined) {
      let themes = []
      try { themes = typeof rawThemes === 'string' ? JSON.parse(rawThemes) : (Array.isArray(rawThemes) ? rawThemes : []) } catch {}
      if (themes.length === 0) themeLabel = '🎲 Tout mélangé'
      else if (themes.length === 1) themeLabel = MINI_THEMES[themes[0]] || '🎲 Tout'
      else themeLabel = themes.map(id => (MINI_THEMES[id] || '').split(' ')[0]).join('') + ` (${themes.length})`
    } else if (room?.selectedTheme) {
      themeLabel = MINI_THEMES[room.selectedTheme] || '🎲 Tout mélangé'
    }

    return `
      <div class="flex items-center justify-between mb-2 gap-2">
        <div class="text-xs font-mono uppercase tracking-widest" style="color: var(--text-muted); flex-shrink:0;">
          ${title}
        </div>
        <div class="flex items-center gap-2 min-w-0">
          ${themeLabel ? `<span class="text-xs font-mono truncate px-2 py-1 rounded" style="background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.2); color: var(--amber-glow); max-width: 120px;">${themeLabel}</span>` : ''}
          <div class="text-xs font-mono px-2 py-1 rounded flex-shrink-0" style="background: rgba(0,245,212,0.08); border: 1px solid rgba(0,245,212,0.2); color: var(--cyan-glow);">
            # ${roomCode}
          </div>
        </div>
      </div>
    `
  }

  function renderTwistBanner(twist) {
    return `
      <div class="twist-banner p-4 mb-1">
        <div class="flex items-center gap-2 mb-1">
          <span class="text-xs font-mono uppercase tracking-wider" style="color: var(--amber-glow);">
            ⚡ TWIST ACTIF
          </span>
          <span class="text-xs font-mono px-2 py-0.5 rounded"
            style="background: rgba(245,158,11,0.12); color: var(--amber-glow); border: 1px solid rgba(245,158,11,0.25);">
            ${twist.label}
          </span>
        </div>
        <p class="text-sm" style="color: rgba(226,232,240,0.85);">
          ${formatTwistDescription(twist.description)}
        </p>
      </div>
    `
  }

  function attachFlipCardHandler() {
    const card = document.getElementById('flippable-word-card')
    if (!card) return
    card.addEventListener('click', () => {
      const isFlipped = card.dataset.flipped === 'true'
      const hiddenFace   = document.getElementById('flippable-word-card-hidden')
      const revealedFace = document.getElementById('flippable-word-card-revealed')
      if (isFlipped) {
        hiddenFace?.classList.remove('hidden')
        revealedFace?.classList.add('hidden')
        card.style.borderColor = 'rgba(0,245,212,0.2)'
        card.dataset.flipped = 'false'
      } else {
        hiddenFace?.classList.add('hidden')
        revealedFace?.classList.remove('hidden')
        card.style.borderColor = 'rgba(0,245,212,0.5)'
        card.dataset.flipped = 'true'
      }
    })
  }

  // ─────────────────────────────────────────────
  // Carte retournable : cachée par défaut, tap = voir le mot
  // ─────────────────────────────────────────────
  function renderFlippableWordCard(player) {
    const roleConf = getRoleConfig(player.role)
    const cardId = 'flippable-word-card'
    return `
      <div id="${cardId}" class="word-card p-6 text-center w-full mx-auto max-w-xs cursor-pointer select-none"
        style="border-color: rgba(0,245,212,0.2); background: rgba(2,8,23,0.8); transition: all 0.2s;"
        data-flipped="false">
        <!-- Face cachée (défaut) -->
        <div id="${cardId}-hidden" class="flex flex-col items-center gap-3">
          <div class="w-12 h-12 rounded-full flex items-center justify-center"
            style="background: rgba(0,245,212,0.08); border: 1px solid rgba(0,245,212,0.2);">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00f5d4" stroke-width="1.5">
              <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
              <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
              <line x1="1" y1="1" x2="23" y2="23" stroke="#ef4444"/>
            </svg>
          </div>
          <div>
            <p class="text-sm font-display font-bold" style="color: var(--cyan-glow);">Mot caché 👁️</p>
            <p class="text-xs font-mono mt-1" style="color: var(--text-muted);">Appuie pour voir</p>
          </div>
        </div>
        <!-- Face visible (après tap) -->
        <div id="${cardId}-revealed" class="hidden flex flex-col items-center gap-2">
          <p class="text-xs font-mono uppercase tracking-widest" style="color: var(--text-muted);">Ton mot secret</p>
          ${player.secretWord
            ? `<p class="text-3xl font-display font-bold" style="color: var(--cyan-glow);">${player.secretWord}</p>`
            : `<p class="text-xl font-display font-bold" style="color: rgba(168,85,247,0.9);">??? Bluff !</p>`
          }
          <span class="role-badge ${roleConf.colorClass}" style="font-size:0.65rem; margin-top:4px;">
            ${roleConf.emoji} ${roleConf.label}
          </span>
          <p class="text-xs font-mono mt-1" style="color: var(--text-muted);">Appuie pour cacher</p>
        </div>
      </div>
    `
  }

  function renderWordCardHidden() {
    return `
      <div id="word-card-hidden" class="word-card word-card-hidden p-8 text-center w-full mx-auto max-w-xs">
        <div class="flex flex-col items-center gap-4">
          <div class="w-14 h-14 rounded-full flex items-center justify-center"
            style="background: rgba(0,245,212,0.1); border: 1px solid rgba(0,245,212,0.3);">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00f5d4" stroke-width="1.5">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
              <line x1="1" y1="1" x2="23" y2="23" stroke="#ef4444"/>
            </svg>
          </div>
          <div>
            <p class="font-display font-bold text-lg mb-1" style="color: var(--cyan-glow);">
              Appuie pour voir ton mot
            </p>
            <p class="text-xs font-mono" style="color: var(--text-muted);">
              Assure-toi que personne ne regarde !
            </p>
          </div>
        </div>
      </div>
    `
  }

  function renderWordCardRevealed(player) {
    const roleConf = getRoleConfig(player.role)
    return `
      <div class="word-card word-card-revealed p-6 text-center w-full mx-auto max-w-xs">
        <p class="text-xs font-mono uppercase tracking-widest mb-3" style="color: var(--text-muted);">
          Ton mot secret
        </p>
        ${player.secretWord
          ? `<p class="text-3xl font-display font-bold text-glow-cyan" style="color: var(--cyan-glow);">
               ${player.secretWord}
             </p>`
          : `<p class="text-xl font-display font-bold" style="color: rgba(168,85,247,0.9);">
               ??? Bluff au maximum !
             </p>`
        }
        <div class="mt-3">
          <span class="role-badge ${roleConf.colorClass}" style="font-size:0.65rem;">
            ${roleConf.emoji} ${roleConf.label}
          </span>
        </div>
      </div>
    `
  }

  function renderIndicatorInfo(room) {
    const undercover = Object.values(room.players || {}).find(p => p.role === ROLES.UNDERCOVER)
    if (!undercover) return ''
    return `
      <div class="twist-banner p-4 w-full max-w-xs">
        <p class="text-xs font-mono uppercase tracking-widest mb-1" style="color: #3b82f6;">
          ⚖️ Info secrète (La Balance)
        </p>
        <p class="text-sm" style="color: rgba(226,232,240,0.8);">
          L'Undercover est : <strong style="color: #ef4444;">${undercover.pseudo}</strong>
        </p>
        <p class="text-xs mt-1" style="color: var(--text-muted);">
          Protège-toi : s'il te dénonce, tu perds !
        </p>
      </div>
    `
  }

  function renderEliminatedWaiting() {
    document.getElementById('game-container').innerHTML = `
      <div class="screen flex flex-col items-center justify-center min-h-screen gap-6 text-center px-5">
        <div class="text-5xl">☠️</div>
        <div>
          <p class="font-display font-bold text-2xl mb-2" style="color: #ef4444;">Tu as été éliminé</p>
          <p class="text-sm" style="color: var(--text-muted);">Tu peux regarder la suite de la partie</p>
        </div>
        <div class="spinner"></div>
      </div>
    `
  }

  function cleanup() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null }
  }
}