// =============================================
// GESTION DES RÔLES
// =============================================

/** @typedef {'civil'|'undercover'|'tourist'|'indicator'|'double_agent'} RoleType */

export const ROLES = {
  CIVIL:        'civil',
  UNDERCOVER:   'undercover',
  TOURIST:      'tourist',
  INDICATOR:    'indicator',
  DOUBLE_AGENT: 'double_agent',
}

export const ROLE_CONFIG = {
  civil: {
    label: 'Civil',
    emoji: '👤',
    colorClass: 'role-civil',
    description: 'Tu connais le mot principal. Fais deviner sans te trahir.',
  },
  undercover: {
    label: 'Undercover',
    emoji: '🕵️',
    colorClass: 'role-undercover',
    description: 'Tu as un mot proche du vrai. Infiltre les civils et évite d\'être démasqué.',
  },
  tourist: {
    label: 'Le Touriste',
    emoji: '🗺️',
    colorClass: 'role-tourist',
    description: 'Tu n\'as aucun mot. Bluff et déduis pour passer inaperçu.',
  },
  indicator: {
    label: 'La Balance',
    emoji: '⚖️',
    colorClass: 'role-indicator',
    description: 'Tu connais le mot ET l\'identité de l\'Undercover. Aide les civils, mais si l\'Undercover te démasque, tu perds !',
  },
  double_agent: {
    label: 'Agent Double',
    emoji: '🎭',
    colorClass: 'role-double-agent',
    description: 'Tu as le même mot que l\'Undercover, mais ton but est de te faire éliminer à sa place.',
  },
}

/**
 * Configuration des rôles selon le nombre de joueurs
 * Règles : toujours au moins 2 civils, 1 undercover
 * Les rôles spéciaux (tourist, indicator, double_agent) sont optionnels
 *
 * @param {number} playerCount
 * @param {object} options
 * @returns {RoleType[]}
 */
export function buildRolePool(playerCount, options = {}) {
  const {
    includeTourist      = playerCount >= 5,
    includeIndicator    = playerCount >= 6,
    includeDoubleAgent  = playerCount >= 7,
  } = options

  const pool = []

  // 1 Undercover obligatoire
  pool.push(ROLES.UNDERCOVER)

  // Rôles spéciaux optionnels
  if (includeTourist)     pool.push(ROLES.TOURIST)
  if (includeIndicator)   pool.push(ROLES.INDICATOR)
  if (includeDoubleAgent) pool.push(ROLES.DOUBLE_AGENT)

  // Le reste sont des civils
  const civils = playerCount - pool.length
  for (let i = 0; i < civils; i++) {
    pool.push(ROLES.CIVIL)
  }

  return pool
}

/**
 * Assigne aléatoirement les rôles aux joueurs
 * Retourne un tableau de { uid, role, secretWord }
 *
 * @param {string[]} playerIds - UIDs des joueurs
 * @param {{ civil: string, undercover: string }} wordPair
 * @param {object} roleOptions
 * @returns {Array<{ uid: string, role: RoleType, secretWord: string|null }>}
 */
export function assignRoles(playerIds, wordPair, roleOptions = {}) {
  const pool = buildRolePool(playerIds.length, roleOptions)

  // Mélange Fisher-Yates (non biaisé, contrairement à .sort(() => Math.random()))
  function shuffle(arr) {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }
  const shuffledPool = shuffle(pool)
  const shuffledIds  = shuffle(playerIds)

  return shuffledIds.map((uid, index) => {
    const role = shuffledPool[index]
    let secretWord = null

    switch (role) {
      case ROLES.CIVIL:
        secretWord = wordPair.civil
        break
      case ROLES.UNDERCOVER:
        secretWord = wordPair.undercover
        break
      case ROLES.TOURIST:
        secretWord = null
        break
      case ROLES.INDICATOR:
        secretWord = wordPair.civil // La Balance connaît le mot civil
        break
      case ROLES.DOUBLE_AGENT:
        secretWord = wordPair.undercover // L'Agent Double a le mot undercover
        break
    }

    return { uid, role, secretWord }
  })
}

/**
 * Retourne l'objet de config d'un rôle
 * @param {RoleType} role
 */
export function getRoleConfig(role) {
  return ROLE_CONFIG[role] || ROLE_CONFIG.civil
}

/**
 * Détermine si la partie est terminée et qui a gagné
 * @param {Object} players - Map des joueurs { uid: { role, isEliminated } }
 * @returns {{ gameOver: boolean, winners?: RoleType[], reason?: string }}
 */
export function checkWinCondition(players) {
  const all = Object.values(players)
  const alive = all.filter(p => !p.isEliminated)

  const aliveUndercover   = alive.filter(p => p.role === ROLES.UNDERCOVER)
  const aliveDoubleAgent  = alive.filter(p => p.role === ROLES.DOUBLE_AGENT)
  const alivedCivils      = alive.filter(p => [ROLES.CIVIL, ROLES.INDICATOR].includes(p.role))
  const aliveTourists     = alive.filter(p => p.role === ROLES.TOURIST)

  // L'Undercover a été éliminé → Civils gagnent (sauf si l'Agent Double prend sa place)
  if (aliveUndercover.length === 0) {
    // Si l'Agent Double est encore vivant, les Civils n'ont pas encore vraiment gagné
    // (dans la vraie règle, si l'Undercover est éliminé avant l'Agent Double, l'Agent Double gagne)
    if (aliveDoubleAgent.length > 0) {
      return {
        gameOver: true,
        winners: [ROLES.DOUBLE_AGENT],
        reason: 'L\'Undercover a été éliminé et l\'Agent Double est encore en vie. L\'Agent Double gagne !',
      }
    }
    return {
      gameOver: true,
      winners: [ROLES.CIVIL, ROLES.INDICATOR],
      reason: 'L\'Undercover a été démasqué ! Les Civils gagnent !',
    }
  }

  // Les Civils sont en minorité ou Undercover = 50% des survivants → Undercover gagne
  if (aliveUndercover.length >= alivedCivils.length + aliveTourists.length) {
    return {
      gameOver: true,
      winners: [ROLES.UNDERCOVER, ROLES.DOUBLE_AGENT],
      reason: 'L\'Undercover prend le contrôle ! Les Civils ont perdu.',
    }
  }

  // Le Touriste est le dernier → Touriste gagne
  if (aliveTourists.length > 0 && alive.length <= 3) {
    const isLastNonCivil = aliveTourists.length === alive.filter(p => p.role !== ROLES.CIVIL).length
    if (isLastNonCivil && alive.length === 2) {
      return {
        gameOver: true,
        winners: [ROLES.TOURIST],
        reason: 'Le Touriste a réussi à bluffer jusqu\'au bout ! Il gagne !',
      }
    }
  }

  return { gameOver: false }
}