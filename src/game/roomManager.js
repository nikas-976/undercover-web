// =============================================
// GESTION DES ROOMS FIREBASE
// Structure de la DB :
//
// rooms/
//   {ROOM_CODE}/
//     code: "ABCD"
//     state: "waiting"|"revealing"|"playing"|"voting"|"results"|"ended"
//     creatorId: "uid"
//     currentRound: 0
//     wordPair: { civil: "mot", undercover: "mot proche" }
//     currentTwist: null | { id, label, description }
//     eliminatedThisRound: null | "uid"
//     gameResult: null | { gameOver, winners, reason }
//     players/
//       {uid}/
//         id, pseudo, role, secretWord, isEliminated, hasRevealedWord, joinedAt
//     votes/
//       {uid}: "targetUid"
// =============================================

import { db } from '../firebase.js'
import {
  ref, set, get, update, push, onValue, off,
  runTransaction, serverTimestamp, remove,
} from 'firebase/database'

// =============================================
// GÉNÉRATION DU CODE DE ROOM
// =============================================

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // Sans I, O pour éviter confusion

export function generateRoomCode() {
  return Array.from({ length: 4 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('')
}

// =============================================
// CRÉER UNE ROOM
// =============================================

export async function createRoom(creatorId, creatorPseudo) {
  let code = generateRoomCode()
  let attempts = 0

  // S'assure que le code n'existe pas déjà
  while (attempts < 10) {
    const snap = await get(ref(db, `rooms/${code}`))
    if (!snap.exists()) break
    code = generateRoomCode()
    attempts++
  }

  const roomData = {
    code,
    state: 'waiting',
    creatorId,
    currentRound: 0,
    wordPair: null,
    currentTwist: null,
    eliminatedThisRound: null,
    gameResult: null,
    createdAt: serverTimestamp(),
    players: {
      [creatorId]: {
        id: creatorId,
        pseudo: creatorPseudo,
        role: null,
        secretWord: null,
        isEliminated: false,
        hasRevealedWord: false,
        joinedAt: serverTimestamp(),
      }
    },
    votes: {},
  }

  await set(ref(db, `rooms/${code}`), roomData)
  return code
}

// =============================================
// REJOINDRE UNE ROOM
// =============================================

export async function joinRoom(code, playerId, playerPseudo) {
  const roomRef = ref(db, `rooms/${code.toUpperCase()}`)
  const snap = await get(roomRef)

  if (!snap.exists()) {
    throw new Error('Room introuvable. Vérifie le code.')
  }

  const room = snap.val()

  if (room.state !== 'waiting') {
    throw new Error('La partie a déjà commencé !')
  }

  const players = room.players || {}
  const playerCount = Object.keys(players).length

  if (playerCount >= 10) {
    throw new Error('La room est pleine (max 10 joueurs).')
  }

  // Vérifie si le pseudo est déjà pris
  const pseudoTaken = Object.values(players).some(
    p => p.pseudo.toLowerCase() === playerPseudo.toLowerCase() && p.id !== playerId
  )
  if (pseudoTaken) {
    throw new Error('Ce pseudo est déjà utilisé dans cette room.')
  }

  // Si le joueur est déjà dans la room (reconnexion), on ne réécrit pas
  if (!players[playerId]) {
    await set(ref(db, `rooms/${code.toUpperCase()}/players/${playerId}`), {
      id: playerId,
      pseudo: playerPseudo,
      role: null,
      secretWord: null,
      isEliminated: false,
      hasRevealedWord: false,
      joinedAt: serverTimestamp(),
    })
  }

  return code.toUpperCase()
}

// =============================================
// LANCER LA PARTIE
// =============================================

export async function startGame(code, wordPair, assignedRoles, twist, selectedThemes, settings = {}) {
  const updates = {}

  updates[`rooms/${code}/state`]               = 'revealing'
  updates[`rooms/${code}/currentRound`]        = 1
  updates[`rooms/${code}/wordPair`]            = wordPair
  updates[`rooms/${code}/currentTwist`]        = twist
  updates[`rooms/${code}/selectedThemes`]      = selectedThemes || []
  updates[`rooms/${code}/settings`]            = { maxScore: 20, undercoversCount: 1, useMrWhite: false, useNotes: false, ...settings }
  updates[`rooms/${code}/votes`]               = {}
  updates[`rooms/${code}/wordHistory`]         = {}
  updates[`rooms/${code}/isTiebreak`]          = false
  updates[`rooms/${code}/isBonusRound`]        = false
  updates[`rooms/${code}/tiedPlayers`]         = null
  updates[`rooms/${code}/eliminatedThisRound`] = null
  updates[`rooms/${code}/gameResult`]          = null
  updates[`rooms/${code}/speakingOrder`]       = []
  updates[`rooms/${code}/currentSpeakerIndex`] = 0
  updates[`rooms/${code}/deltaScores`]         = null
  updates[`rooms/${code}/winningSide`]         = null
  updates[`rooms/${code}/maxScoreReached`]     = false

  // Assigne les rôles et mots aux joueurs
  for (const { uid, role, secretWord } of assignedRoles) {
    updates[`rooms/${code}/players/${uid}/role`]           = role
    updates[`rooms/${code}/players/${uid}/secretWord`]     = secretWord
    updates[`rooms/${code}/players/${uid}/hasRevealedWord`] = false
    updates[`rooms/${code}/players/${uid}/isEliminated`]   = false
  }

  // Init scores to 0
  for (const { uid } of assignedRoles) {
    updates[`rooms/${code}/scores/${uid}`] = 0
  }
  await update(ref(db), updates)
}

// =============================================
// MARQUER LE MOT COMME RÉVÉLÉ (joueur a lu son mot)
// =============================================

export async function markWordRevealed(code, playerId) {
  await set(ref(db, `rooms/${code}/players/${playerId}/hasRevealedWord`), true)
}

// =============================================
// PASSER EN PHASE DE JEU (après que tous aient vu leur mot)
// =============================================

export async function startPlayingPhase(code, speakingOrder = []) {
  await update(ref(db, `rooms/${code}`), {
    state: 'playing',
    speakingOrder,
    currentSpeakerIndex: 0,
  })
}

// =============================================
// VOTER POUR UN JOUEUR
// =============================================

export async function castVote(code, voterId, targetId) {
  await set(ref(db, `rooms/${code}/votes/${voterId}`), targetId)
}

// =============================================
// TRAITER LES VOTES (host seulement)
// Retourne le joueur le plus voté
// =============================================

export async function processVotes(code) {
  const snap = await get(ref(db, `rooms/${code}`))
  const room = snap.val()
  const votes = room.votes || {}
  const players = room.players || {}

  // Comptage
  const tally = {}
  for (const targetId of Object.values(votes)) {
    tally[targetId] = (tally[targetId] || 0) + 1
  }

  // Joueur avec le plus de votes
  const sortedPlayers = Object.keys(tally).sort((a, b) => tally[b] - tally[a])

  if (sortedPlayers.length === 0) return null

  // Vérifier égalité
  const maxVotes = tally[sortedPlayers[0]]
  const tied = sortedPlayers.filter(id => tally[id] === maxVotes)

  // En cas d'égalité
  if (tied.length > 1) {
    const isBonusRound = room.isBonusRound === true

    if (isBonusRound) {
      // Égalité au tour bonus → Undercover gagne cette manche
      // On passe par round_end pour conserver les scores correctement
      const allPlayers  = Object.values(room.players || {})
      const settings    = room.settings || {}
      const maxScore    = settings.maxScore || 20
      const current     = room.scores || {}
      const newScores   = { ...current }
      const deltaScores = {}
      allPlayers.forEach(p => { deltaScores[p.id] = 0 })

      // Undercovers vivants uniquement
      allPlayers.filter(p => !p.isEliminated && p.role === 'undercover')
        .forEach(p => { newScores[p.id] = (newScores[p.id] || 0) + 5; deltaScores[p.id] = 5 })

      const maxReached = Object.values(newScores).some(s => Number(s) >= maxScore)

      await update(ref(db, `rooms/${code}`), {
        state:            'round_end',
        scores:           newScores,
        deltaScores,
        winningSide:      'undercover',
        maxScoreReached:  maxReached,
        isBonusRound:     false,
        isTiebreak:       false,
        tiedPlayers:      null,
        votes:            {},
        bonusTieWin:      true,
        eliminatedThisRound: null,
      })
      return { eliminated: null, tie: true, bonusTieWin: true }
    }

    // Première égalité → tour bonus direct (1 seul indice par joueur)
    const currentRound = room.currentRound || 1
    await update(ref(db, `rooms/${code}`), {
      state:             'playing',
      currentRound:      currentRound + 1,
      isTiebreak:        false,
      isBonusRound:      true,
      tiedPlayers:       null,
      votes:             {},
      wordHistory:       {},
      eliminatedThisRound: null,
      speakingOrder:     [],
      currentSpeakerIndex: 0,
    })
    return { eliminated: null, tie: true, bonusRound: true }
  }

  const eliminatedId = sortedPlayers[0]

  await update(ref(db, `rooms/${code}`), {
    [`players/${eliminatedId}/isEliminated`]: true,
    state: 'results',
    eliminatedThisRound: eliminatedId,
  })

  return { eliminated: eliminatedId, tie: false }
}

// =============================================
// PASSER AU TOUR SUIVANT
// =============================================

export async function nextRound(code, newTwist) {
  const snap = await get(ref(db, `rooms/${code}/currentRound`))
  const currentRound = snap.val() || 1

  await update(ref(db, `rooms/${code}`), {
    state: 'playing',
    currentRound: currentRound + 1,
    currentTwist: newTwist,
    votes: {},
    eliminatedThisRound: null,
  })
}

// =============================================
// TERMINER LA PARTIE
// =============================================

/**
 * Termine la partie.
 * Si appelé sans gameResult explicite (arrêt forcé), construit un classement
 * à partir des scores actuels de la room.
 */
export async function endGame(code, gameResult) {
  // Si arrêt forcé (pas de vrai gagnant de partie), on crée un classement
  if (!gameResult || gameResult.forced) {
    const snap    = await get(ref(db, `rooms/${code}`))
    const room    = snap.val()
    const players = Object.values(room?.players || {})
    const scores  = room?.scores || {}

    const ranked = [...players].sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0))
    const topScore = ranked.length > 0 ? (scores[ranked[0].id] || 0) : 0
    const winners = ranked.filter(p => (scores[p.id] || 0) >= topScore && topScore > 0)

    gameResult = {
      gameOver:    true,
      forced:      true,
      winners:     winners.map(p => p.role),
      winnerIds:   winners.map(p => p.id),
      finalScores: scores,
      reason:      winners.length === 0
        ? "Partie interrompue par l'hôte. Aucun point marqué."
        : winners.length > 1
          ? `Partie interrompue — Égalité entre ${winners.map(p => p.pseudo).join(' & ')} (${topScore} pts).`
          : `Partie interrompue — ${winners[0].pseudo} mène avec ${topScore} pts.`,
    }
  }

  await update(ref(db, `rooms/${code}`), {
    state: 'ended',
    gameResult,
  })
}

// =============================================
// SUPPRIMER LA ROOM (nettoyage)
// =============================================

export async function deleteRoom(code) {
  await remove(ref(db, `rooms/${code}`))
}

// =============================================
// QUITTER LA ROOM
// =============================================

export async function leaveRoom(code, playerId) {
  await remove(ref(db, `rooms/${code}/players/${playerId}`))
}

// =============================================
// LISTENER TEMPS RÉEL SUR LA ROOM
// Retourne la fonction unsubscribe
// =============================================

export function subscribeToRoom(code, callback) {
  const roomRef = ref(db, `rooms/${code}`)
  onValue(roomRef, (snap) => {
    callback(snap.exists() ? snap.val() : null)
  })
  return () => off(roomRef)
}

// =============================================
// V2 — SAISIE DE MOT (tour par tour)
// =============================================

export async function submitWord(code, uid, word) {
  const roomRef = ref(db, `rooms/${code}`)
  const snap    = await get(roomRef)
  const room    = snap.val()
  if (!room) return

  const order   = room.speakingOrder || []
  const idx     = room.currentSpeakerIndex ?? 0
  const nextIdx = idx + 1
  const allDone = nextIdx >= order.length

  // Count existing words for this player to get the next slot index
  const existing = room.wordHistory?.[uid] || {}
  const wordCount = typeof existing === 'object' && !Array.isArray(existing)
    ? Object.keys(existing).length
    : (Array.isArray(existing) ? existing.length : 0)

  // Write using room-level ref with relative paths
  const updates = {
    [`wordHistory/${uid}/${wordCount}`]: word,
    currentSpeakerIndex: nextIdx,
  }
  if (allDone) {
    updates.state = 'voting'
    updates.votes = {}
  }

  await update(roomRef, updates)
}

// =============================================
// V2 — FIN DE MANCHE + CALCUL DES SCORES
// =============================================

export async function endRound(code, winResult) {
  const snap    = await get(ref(db, `rooms/${code}`))
  const room    = snap.val()
  const players = Object.values(room.players || {})
  const current = room.scores || {}
  const settings = room.settings || {}
  const maxScore = settings.maxScore || 20

  const newScores   = { ...current }
  const deltaScores = {}
  players.forEach(p => { deltaScores[p.id] = 0 })

  const side = winResult?.winners?.includes('undercover') ? 'undercover' : 'civil'

  if (side === 'civil') {
    players.filter(p => !p.isEliminated && ['civil', 'indicator'].includes(p.role))
      .forEach(p => { newScores[p.id] = (newScores[p.id] || 0) + 2; deltaScores[p.id] = 2 })
  } else {
    // Undercovers vivants uniquement (pas de points si éliminé)
    players.filter(p => !p.isEliminated && p.role === 'undercover')
      .forEach(p => { newScores[p.id] = (newScores[p.id] || 0) + 5; deltaScores[p.id] = 5 })
  }
  // Tourist survives to end: +3
  players.filter(p => !p.isEliminated && p.role === 'tourist')
    .forEach(p => { newScores[p.id] = (newScores[p.id] || 0) + 3; deltaScores[p.id] += 3 })

  const maxReached = Object.values(newScores).some(s => s >= maxScore)

  await update(ref(db, `rooms/${code}`), {
    state:        'round_end',
    scores:       newScores,
    deltaScores,
    winningSide:  side,
    maxScoreReached: maxReached,
  })
}

// =============================================
// V2 — MANCHE SUIVANTE (conserve les scores)
// =============================================

export async function startNextRound(code, wordPair, assignedRoles, twist, selectedThemes) {
  const rSnap = await get(ref(db, `rooms/${code}/currentRound`))
  const round  = rSnap.val() || 1

  const updates = {}
  updates[`rooms/${code}/state`]               = 'revealing'
  updates[`rooms/${code}/currentRound`]        = 1  // Reset to round 1 for each new manche
  updates[`rooms/${code}/wordPair`]            = wordPair
  updates[`rooms/${code}/currentTwist`]        = twist
  updates[`rooms/${code}/selectedThemes`]      = selectedThemes || []
  updates[`rooms/${code}/votes`]               = {}
  updates[`rooms/${code}/wordHistory`]         = {}
  updates[`rooms/${code}/speakingOrder`]       = []
  updates[`rooms/${code}/currentSpeakerIndex`] = 0
  updates[`rooms/${code}/eliminatedThisRound`] = null
  updates[`rooms/${code}/isTiebreak`]          = false
  updates[`rooms/${code}/isBonusRound`]        = false
  updates[`rooms/${code}/tiedPlayers`]         = null
  updates[`rooms/${code}/deltaScores`]         = null
  updates[`rooms/${code}/winningSide`]         = null
  updates[`rooms/${code}/maxScoreReached`]     = false

  for (const { uid, role, secretWord } of assignedRoles) {
    updates[`rooms/${code}/players/${uid}/role`]          = role
    updates[`rooms/${code}/players/${uid}/secretWord`]    = secretWord
    updates[`rooms/${code}/players/${uid}/hasRevealedWord`] = false
    updates[`rooms/${code}/players/${uid}/isEliminated`]  = false
  }
  await update(ref(db), updates)
}