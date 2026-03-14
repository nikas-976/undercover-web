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

export async function startGame(code, wordPair, assignedRoles, twist, selectedTheme = 'all') {
  const updates = {}

  updates[`rooms/${code}/state`]          = 'revealing'
  updates[`rooms/${code}/currentRound`]   = 1
  updates[`rooms/${code}/wordPair`]       = wordPair
  updates[`rooms/${code}/currentTwist`]   = twist
  updates[`rooms/${code}/selectedTheme`]  = selectedTheme
  updates[`rooms/${code}/votes`]          = {}
  updates[`rooms/${code}/isTiebreak`]     = false
  updates[`rooms/${code}/isBonusRound`]   = false
  updates[`rooms/${code}/tiedPlayers`]    = null
  updates[`rooms/${code}/eliminatedThisRound`] = null
  updates[`rooms/${code}/gameResult`]     = null
  updates[`rooms/${code}/speakingOrder`]  = []
  updates[`rooms/${code}/currentSpeakerIndex`] = 0

  // Assigne les rôles et mots aux joueurs
  for (const { uid, role, secretWord } of assignedRoles) {
    updates[`rooms/${code}/players/${uid}/role`]           = role
    updates[`rooms/${code}/players/${uid}/secretWord`]     = secretWord
    updates[`rooms/${code}/players/${uid}/hasRevealedWord`] = false
    updates[`rooms/${code}/players/${uid}/isEliminated`]   = false
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
    const isTiebreak  = room.isTiebreak  === true
    const isBonusRound = room.isBonusRound === true

    if (isBonusRound) {
      // Égalité dans le tour bonus → Undercover gagne
      const players = room.players || {}
      const undercover = Object.values(players).find(p => p.role === 'undercover')
      await update(ref(db, `rooms/${code}`), {
        state: 'ended',
        isBonusRound: false,
        isTiebreak: false,
        tiedPlayers: null,
        votes: {},
        gameResult: {
          gameOver: true,
          winners: ['undercover'],
          reason: "Égalité au tour bonus ! L'Undercover reste introuvable. Il gagne !",
          bonusTieWin: true,
        }
      })
      return { eliminated: null, tie: true, bonusTieWin: true }
    }

    if (isTiebreak) {
      // Double égalité → tour bonus complet
      const currentRound = room.currentRound || 1
      await update(ref(db, `rooms/${code}`), {
        state: 'playing',
        currentRound: currentRound + 1,
        isTiebreak: false,
        isBonusRound: true,
        tiedPlayers: null,
        votes: {},
        eliminatedThisRound: null,
        speakingOrder: [],
        currentSpeakerIndex: 0,
      })
      return { eliminated: null, tie: true, bonusRound: true }
    }

    // Première égalité → re-vote entre les joueurs à égalité
    await update(ref(db, `rooms/${code}`), {
      state: 'tiebreak',
      tiedPlayers: tied,
      isTiebreak: true,
      votes: {},
    })
    return { eliminated: null, tie: true, tiebreak: true }
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

export async function endGame(code, gameResult) {
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