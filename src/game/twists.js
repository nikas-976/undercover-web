// =============================================
// SYSTÈME DE TWISTS
// Chaque début de tour a 20% de chances de déclencher un Twist
// =============================================

const TWIST_PROBABILITY = 0.20

/** @typedef {{ id: string, label: string, description: string, targetPlayer?: string, targetPlayer2?: string }} Twist */

const TWIST_TEMPLATES = [
  {
    id: 'no_adjectives',
    label: '🚫 Mot interdit',
    description: 'Pas d\'adjectifs ce tour-ci ! Toute description qualificative est interdite.',
  },
  {
    id: 'yes_no_interrogation',
    label: '🎙️ Interrogatoire',
    description: '{player1} doit poser une question fermée (réponse oui/non uniquement) à {player2}.',
    needsTwoPlayers: true,
  },
  {
    id: 'whisper',
    label: '🤫 Chuchotement',
    description: '{player1} doit donner son indice en chuchotant à l\'oreille de son voisin. Les autres ne l\'entendent pas !',
    needsOnePlayer: true,
    isPhysicalAction: true,
  },
  {
    id: 'double_or_nothing',
    label: '⚡ Double mise',
    description: 'Le joueur éliminé ce tour perd 2 vies au lieu d\'une, mais s\'il survit, il est immunisé au prochain vote.',
  },
  {
    id: 'reverse_order',
    label: '🔄 Ordre inversé',
    description: 'Ce tour, les indices sont donnés dans l\'ordre inverse (le dernier joueur commence).',
  },
  {
    id: 'one_word',
    label: '🔇 Mot unique',
    description: 'Ce tour, chaque joueur ne peut donner qu\'UN SEUL MOT comme indice. Pas de phrase !',
  },
  {
    id: 'mime',
    label: '🤸 Mime',
    description: '{player1} doit mimer son indice au lieu de le dire. Les autres ne peuvent pas deviner à voix haute.',
    needsOnePlayer: true,
    isPhysicalAction: true,
  },
  {
    id: 'no_repetition',
    label: '🚷 Pas de répétition',
    description: 'Aucun joueur ne peut utiliser un mot déjà dit par un autre joueur ce tour.',
  },
  {
    id: 'hot_seat',
    label: '🔥 Siège brûlant',
    description: '{player1} doit donner deux indices au lieu d\'un seul ce tour.',
    needsOnePlayer: true,
  },
  {
    id: 'spy_reveal',
    label: '👁️ Regard espion',
    description: '{player1} peut regarder discrètement dans les yeux {player2} pendant 5 secondes avant que {player2} donne son indice.',
    needsTwoPlayers: true,
  },
]

/**
 * Détermine si un Twist se déclenche ce tour
 * @returns {boolean}
 */
export function shouldTriggerTwist() {
  return Math.random() < TWIST_PROBABILITY
}

/**
 * Génère un Twist aléatoire en assignant des joueurs si nécessaire
 * @param {Array<{ id: string, pseudo: string }>} activePlayers - Joueurs non éliminés
 * @returns {Twist | null}
 */
export function generateTwist(activePlayers) {
  if (!shouldTriggerTwist()) return null
  if (activePlayers.length < 2) return null

  const template = TWIST_TEMPLATES[Math.floor(Math.random() * TWIST_TEMPLATES.length)]
  const twist = { ...template }

  if (template.needsTwoPlayers && activePlayers.length >= 2) {
    const shuffled = [...activePlayers].sort(() => Math.random() - 0.5)
    const [p1, p2] = shuffled
    twist.description = template.description
      .replace('{player1}', `**${p1.pseudo}**`)
      .replace('{player2}', `**${p2.pseudo}**`)
    twist.targetPlayer  = p1.id
    twist.targetPlayer2 = p2.id

  } else if (template.needsOnePlayer) {
    const p1 = activePlayers[Math.floor(Math.random() * activePlayers.length)]
    twist.description = template.description
      .replace('{player1}', `**${p1.pseudo}**`)
    twist.targetPlayer = p1.id

  }
  // Clean up template flags (keep isPhysicalAction for GameScreen)
  delete twist.needsTwoPlayers
  delete twist.needsOnePlayer

  return twist
}

/** Formate la description du twist pour l'affichage HTML (gras sur les pseudo) */
export function formatTwistDescription(description) {
  return description.replace(/\*\*(.+?)\*\*/g, '<strong class="text-amber-400">$1</strong>')
}