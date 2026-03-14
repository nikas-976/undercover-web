// =============================================
// ÉCRAN DE JEU
// Gère les phases : revealing → playing → voting → results → ended
// =============================================

import {
  subscribeToRoom, markWordRevealed, startPlayingPhase,
  castVote, processVotes, nextRound, endGame, deleteRoom,
} from '../game/roomManager.js'
import { getRoleConfig, checkWinCondition, ROLES } from '../game/roles.js'
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
    if (isHost && allRevealed) {
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
        // Double passe uniquement au tour 1
        const order = room.currentRound === 1 ? [...pass1, ...shuffle(ids)] : pass1
        await startPlayingPhase(roomCode, order)
      })
    }
  }

  // =============================================
  // PHASE 2 : INDICES (PLAYING)
  // =============================================

  function renderPlayingPhase(room, me) {
    const players            = Object.values(room.players || {}).filter(p => !p.isEliminated)
    const isHost             = room.creatorId === playerId
    const speakingOrder      = room.speakingOrder || players.map(p => p.id)
    const currentIndex       = room.currentSpeakerIndex ?? 0
    const currentSpeakerId   = speakingOrder[currentIndex]
    const isLastSpeaker      = currentIndex >= speakingOrder.length - 1
    const isMyTurn           = currentSpeakerId === playerId
    const currentSpeaker     = players.find(p => p.id === currentSpeakerId)
    const isDoublePasse      = room.currentRound === 1
    const halfLen            = isDoublePasse ? Math.floor(speakingOrder.length / 2) : speakingOrder.length
    const currentPass        = (isDoublePasse && currentIndex >= halfLen) ? 2 : 1
    const indexInPass        = currentPass === 2 ? currentIndex - halfLen : currentIndex
    const passLength         = halfLen

    document.getElementById('game-container').innerHTML = `
      <div class="flex flex-col min-h-screen gap-4">

        ${renderHeader('Tour ' + room.currentRound + ' — Indices' + (isDoublePasse ? ' · Passe ' + currentPass + '/2' : ''), room.currentRound, room)}
        ${room.currentTwist ? renderTwistBanner(room.currentTwist) : ''}

        <!-- Rappel mot secret -->
        ${renderWordCardRevealed(me)}

        <!-- Joueur actuel qui parle -->
        <div class="card p-4 text-center" style="${isMyTurn
          ? 'border-color: rgba(0,245,212,0.5); background: rgba(0,245,212,0.06); box-shadow: 0 0 16px rgba(0,245,212,0.1);'
          : 'border-color: rgba(245,158,11,0.3); background: rgba(245,158,11,0.04);'}">
          <p class="text-xs font-mono uppercase tracking-widest mb-2"
            style="color: ${isMyTurn ? 'var(--cyan-glow)' : 'var(--amber-glow)'};">
            ${isMyTurn ? "🎤 C'est ton tour !" : "🎤 C'est son tour"}
          </p>
          <div class="flex items-center justify-center gap-3">
            <div class="player-avatar" style="background: ${getAvatarColor(currentSpeakerId)}; width:44px; height:44px; min-width:44px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-family:'Syne',sans-serif; font-weight:700; font-size:1rem;">
              ${currentSpeaker ? currentSpeaker.pseudo.slice(0, 2).toUpperCase() : '??'}
            </div>
            <div class="text-left">
              <p class="font-display font-bold text-white text-lg">${currentSpeaker ? currentSpeaker.pseudo : '???'}</p>
              <p class="text-xs font-mono" style="color: var(--text-muted);">
                ${isDoublePasse ? 'Passe ' + currentPass + '/2 · ' : ''}Joueur ${indexInPass + 1}/${passLength}
              </p>
            </div>
          </div>
          ${isMyTurn ? `
            <p class="text-xs mt-3" style="color: rgba(0,245,212,0.7);">
              Donne un indice sur ton mot sans le dire directement !
            </p>
          ` : ''}
        </div>

        <!-- Ordre de passage complet -->
        <div>
          <p class="text-xs font-mono uppercase tracking-widest mb-2" style="color: var(--text-muted);">
            Ordre de passage
          </p>
          <div class="flex flex-col gap-1.5">
            ${speakingOrder.map((id, idx) => {
              const p          = players.find(pl => pl.id === id)
              const isCurrent  = idx === currentIndex
              const isDone     = idx < currentIndex
              const isMe       = id === playerId
              const isPassBreak = idx === halfLen // séparateur entre passe 1 et passe 2
              if (!p) return ''
              return `
                ${isDoublePasse && isPassBreak ? `
                  <div class="flex items-center gap-2 my-1">
                    <div class="flex-1 h-px" style="background: rgba(245,158,11,0.2);"></div>
                    <span class="text-xs font-mono px-2" style="color: var(--amber-glow);">Passe 2</span>
                    <div class="flex-1 h-px" style="background: rgba(245,158,11,0.2);"></div>
                  </div>
                ` : isDoublePasse && idx === 0 ? `
                  <div class="flex items-center gap-2 mb-1">
                    <div class="flex-1 h-px" style="background: rgba(0,245,212,0.2);"></div>
                    <span class="text-xs font-mono px-2" style="color: var(--cyan-glow);">Passe 1</span>
                    <div class="flex-1 h-px" style="background: rgba(0,245,212,0.2);"></div>
                  </div>
                ` : ''}
                <div class="flex items-center gap-3 px-3 py-2 rounded-lg transition-all"
                  style="
                    background: ${isCurrent ? 'rgba(0,245,212,0.06)' : isDone ? 'rgba(255,255,255,0.02)' : 'transparent'};
                    border: 1px solid ${isCurrent ? 'rgba(0,245,212,0.3)' : 'rgba(22,41,82,0.4)'};
                    opacity: ${isDone ? '0.45' : '1'};
                  ">
                  <span class="text-xs font-mono w-5 text-center flex-shrink-0"
                    style="color: ${isCurrent ? 'var(--cyan-glow)' : 'var(--text-muted)'};">
                    ${isDone ? '✓' : (idx < halfLen ? idx + 1 : idx - halfLen + 1)}
                  </span>
                  <div class="player-avatar" style="background: ${getAvatarColor(id)}; width:28px; height:28px; min-width:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-family:'Syne',sans-serif; font-weight:700; font-size:0.65rem;">
                    ${p.pseudo.slice(0, 2).toUpperCase()}
                  </div>
                  <span class="text-sm flex-1 ${isCurrent ? 'text-white font-medium' : ''}"
                    style="${isCurrent ? '' : 'color: rgba(226,232,240,0.6)'}">
                    ${p.pseudo}${isMe ? ' <span style="font-size:0.65rem; color: var(--text-muted)">(toi)</span>' : ''}
                  </span>
                  ${isCurrent ? '<span style="color: var(--cyan-glow); font-size: 0.75rem;">🎤</span>' : ''}
                </div>
              `
            }).join('')}
          </div>
        </div>

        <!-- Contrôles hôte -->
        ${isHost ? `
          <div class="mt-auto flex flex-col gap-2">
            ${!isLastSpeaker ? `
              <button id="btn-next-speaker" class="btn-primary w-full text-base">
                ➡️ Joueur suivant
              </button>
            ` : ''}
            <button id="btn-go-vote" class="${isLastSpeaker ? 'btn-danger' : 'btn-ghost'} w-full text-base">
              🗳️ ${isLastSpeaker ? 'Passer au vote' : 'Forcer le vote'}
            </button>
          </div>
        ` : `
          <div class="mt-auto text-center py-3">
            <p class="text-xs font-mono" style="color: var(--text-muted);">
              ${isLastSpeaker ? 'En attente du vote...' : 'En attente du joueur suivant...'}
            </p>
          </div>
        `}
      </div>
    `

    if (isHost) {
      // Passer au joueur suivant
      document.getElementById('btn-next-speaker')?.addEventListener('click', async () => {
        const { db: database } = await import('../firebase.js')
        const { ref: dbRef, set: dbSet } = await import('firebase/database')
        await dbSet(dbRef(database, `rooms/${roomCode}/currentSpeakerIndex`), currentIndex + 1)
      })

      // Passer au vote
      document.getElementById('btn-go-vote')?.addEventListener('click', async () => {
        const { db: database } = await import('../firebase.js')
        const { ref: dbRef, update: dbUpdate } = await import('firebase/database')
        await dbUpdate(dbRef(database, `rooms/${roomCode}`), { state: 'voting' })
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

    document.getElementById('game-container').innerHTML = `
      <div class="flex flex-col min-h-screen gap-5">

        ${renderHeader('Tour ' + room.currentRound + ' — Vote', room.currentRound, room)}

        <!-- Rappel -->
        ${renderWordCardRevealed(me)}

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
        if (result?.tie) showToast("Égalité ! Personne n'est éliminé.", 'info')
      }, 800)
    }

    // Hôte finalise manuellement
    document.getElementById('btn-finalize-vote')?.addEventListener('click', async () => {
      if (Object.keys(votes).length === 0) return
      const btn = document.getElementById('btn-finalize-vote')
      if (btn) { btn.disabled = true; btn.textContent = 'Calcul...' }
      const result = await processVotes(roomCode)
      if (result?.tie) showToast("Égalité ! Personne n'est éliminé.", 'info')
    })
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

    // Check win condition — si limite atteinte et partie pas finie, l'Undercover gagne
    let winResult = checkWinCondition(room.players || {})
    if (!winResult.gameOver && roundLimitHit) {
      winResult = {
        gameOver: true,
        winners: [ROLES.UNDERCOVER],
        reason: "Limite de tours atteinte ! L'Undercover n'a pas été démasqué. Il gagne !",
        roundLimit: true,
      }
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
              <button id="btn-end-game" class="btn-danger w-full text-base">
                🏁 Voir les résultats finaux
              </button>
            ` : `
              <button id="btn-next-round" class="btn-primary w-full text-base">
                ▶ Tour ${room.currentRound + 1}/${maxRounds}
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

    // Next round
    document.getElementById('btn-next-round')?.addEventListener('click', async () => {
      const alivePlayers = Object.values(room.players || {})
        .filter(p => !p.isEliminated)
        .map(p => ({ id: p.id, pseudo: p.pseudo }))
      const twist = generateTwist(alivePlayers)
      await nextRound(roomCode, twist)
      voteSubmitted = false
    })

    // End game (win condition)
    document.getElementById('btn-end-game')?.addEventListener('click', async () => {
      await endGame(roomCode, winResult)
    })

    // Force end
    document.getElementById('btn-end-game-early')?.addEventListener('click', async () => {
      await endGame(roomCode, { gameOver: true, winners: [], reason: 'Partie terminée par l\'hôte.' })
    })
  }

  // =============================================
  // PHASE 5 : FIN DE PARTIE
  // =============================================

  function renderEndedPhase(room, me) {
    const result  = room.gameResult
    const players = Object.values(room.players || {})
    const isHost  = room.creatorId === playerId

    document.getElementById('game-container').innerHTML = `
      <div class="flex flex-col min-h-screen gap-5">

        ${renderHeader('Fin de partie', room.currentRound, room)}

        <!-- Result banner -->
        <div class="card p-6 text-center" style="border-color: rgba(0,245,212,0.3);">
          <p class="text-4xl mb-4">🏆</p>
          <p class="font-display font-bold text-xl mb-2" style="color: var(--cyan-glow);">
            ${result?.reason || 'La partie est terminée !'}
          </p>
        </div>

        <!-- All players reveal -->
        <div>
          <p class="text-xs font-mono uppercase tracking-widest mb-3" style="color: var(--text-muted);">
            Tableau final
          </p>
          <div class="flex flex-col gap-2">
            ${players.map(p => {
              const rc = getRoleConfig(p.role)
              const isWinner = result?.winners?.includes(p.role)
              return `
                <div class="player-item ${isWinner ? 'glow-cyan' : ''}"
                  style="${isWinner ? 'border-color: rgba(0,245,212,0.3); background: rgba(0,245,212,0.04)' : ''}">
                  <div class="player-avatar" style="background: ${getAvatarColor(p.id)}; width:36px; height:36px; min-width:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-family:'Syne',sans-serif; font-weight:700;">
                    ${p.pseudo.slice(0, 2).toUpperCase()}
                  </div>
                  <div class="flex flex-col flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-medium truncate">${p.pseudo}</span>
                      ${isWinner ? '<span class="text-xs" style="color: var(--cyan-glow);">🏆</span>' : ''}
                      ${p.isEliminated ? '<span class="text-xs" style="color: rgba(239,68,68,0.6);">☠️</span>' : ''}
                    </div>
                    <div class="flex items-center gap-2 mt-0.5">
                      <span class="role-badge ${rc.colorClass}" style="font-size:0.6rem; padding: 2px 6px;">
                        ${rc.emoji} ${rc.label}
                      </span>
                      ${p.secretWord ? `<span class="text-xs" style="color: var(--text-muted);">"${p.secretWord}"</span>` : ''}
                    </div>
                  </div>
                </div>
              `
            }).join('')}
          </div>
        </div>

        <!-- New game -->
        <div class="mt-auto flex flex-col gap-3">
          ${isHost ? `
            <button id="btn-new-game" class="btn-primary w-full">
              🔄 Nouvelle partie
            </button>
          ` : ''}
          <button id="btn-home" class="btn-ghost w-full text-sm">
            ← Retour à l'accueil
          </button>
        </div>
      </div>
    `

    document.getElementById('btn-home')?.addEventListener('click', () => {
      cleanup()
      onGameEnd()
    })

    document.getElementById('btn-new-game')?.addEventListener('click', async () => {
      // Reset room to waiting state
      const { db: database } = await import('../firebase.js')
      const { ref: dbRef, update: dbUpdate } = await import('firebase/database')

      const resetPlayers = {}
      players.forEach(p => {
        resetPlayers[p.id] = {
          ...p,
          role: null,
          secretWord: null,
          isEliminated: false,
          hasRevealedWord: false,
        }
      })

      await dbUpdate(dbRef(database, `rooms/${roomCode}`), {
        state: 'waiting',
        currentRound: 0,
        wordPair: null,
        currentTwist: null,
        eliminatedThisRound: null,
        gameResult: null,
        votes: {},
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