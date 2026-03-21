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
    description: "Tu connais le mot principal. Fais deviner sans te trahir.",
  },
  undercover: {
    label: 'Undercover',
    emoji: '🕵️',
    colorClass: 'role-undercover',
    description: "Tu as un mot proche du vrai. Infiltre les civils et évite d'être démasqué.",
  },
  tourist: {
    label: 'Le Touriste',
    emoji: '🗺️',
    colorClass: 'role-tourist',
    description: "Tu n'as aucun mot. Bluff et déduis pour passer inaperçu.",
  },
  indicator: {
    label: 'La Balance',
    emoji: '⚖️',
    colorClass: 'role-indicator',
    description: "Tu connais le mot ET l'identité de l'Undercover. Aide les civils, mais si l'Undercover te démasque, tu perds !",
  },
  double_agent: {
    label: 'Agent Double',
    emoji: '🎭',
    colorClass: 'role-double-agent',
    description: "Tu as le même mot que l'Undercover, mais ton but est de te faire éliminer à sa place.",
  },
}

/**
 * Construit le pool de rôles selon le nombre de joueurs et les settings.
 * undercoversCount : 1–3 undercovers
 * includeTourist   : activer le Touriste / Mr. White
 * includeIndicator : activer La Balance
 * includeDoubleAgent : activer l'Agent Double
 *
 * Règle de sécurité : toujours au moins 2 civils.
 */
export function buildRolePool(playerCount, options = {}) {
  // Max undercovers: au moins 1, jamais plus que joueurs - 2 civils min - autres rôles spéciaux
  // Désactivation forcée si pas assez de joueurs (sécurité absolue)
  const includeTourist    = playerCount >= 4 && !!(options.useMrWhite ?? options.includeTourist)
  const includeIndicator  = playerCount >= 6 && !!options.includeIndicator
  const includeDoubleAgent = playerCount >= 7 && !!options.includeDoubleAgent

  const specialCount = (includeTourist ? 1 : 0) + (includeIndicator ? 1 : 0) + (includeDoubleAgent ? 1 : 0)
  // Règle hôte : floor((N-1)/2) → 3→1, 4→1, 5→2, 6→2, 7→3...
  // Contrainte civils : toujours au moins 2 civils
  const maxByRule      = Math.floor((playerCount - 1) / 2)
  const maxByCivils    = Math.max(1, playerCount - 2 - specialCount)
  const maxUndercovers = Math.min(maxByRule, maxByCivils)
  const undercoversCount = Math.min(options.undercoversCount || 1, maxUndercovers)

  const pool = []
  for (let i = 0; i < undercoversCount; i++) pool.push(ROLES.UNDERCOVER)
  if (includeTourist)      pool.push(ROLES.TOURIST)
  if (includeIndicator)    pool.push(ROLES.INDICATOR)
  if (includeDoubleAgent)  pool.push(ROLES.DOUBLE_AGENT)

  // Compléter avec des civils jusqu'à playerCount
  while (pool.length < playerCount) pool.push(ROLES.CIVIL)

  return pool
}

/**
 * Assigne aléatoirement les rôles aux joueurs.
 * roleOptions est l'objet settings de Firebase.
 */
export function assignRoles(playerIds, wordPair, roleOptions = {}) {
  const pool = buildRolePool(playerIds.length, roleOptions)

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
      case ROLES.CIVIL:        secretWord = wordPair.civil;       break
      case ROLES.UNDERCOVER:   secretWord = wordPair.undercover;  break
      case ROLES.TOURIST:      secretWord = null;                 break
      case ROLES.INDICATOR:    secretWord = wordPair.civil;       break
      case ROLES.DOUBLE_AGENT: secretWord = wordPair.undercover;  break
    }
    return { uid, role, secretWord }
  })
}

export function getRoleConfig(role) {
  return ROLE_CONFIG[role] || ROLE_CONFIG.civil
}

/**
 * Vérifie les conditions de victoire.
 *
 * Civils gagnent  : tous les Undercovers ET le Touriste sont éliminés.
 * Undercover gagne : les Undercovers vivants >= Civils+Touristes vivants
 *                    (majorité absolue impossible pour les civils).
 * Touriste gagne  : il est le dernier non-civil en vie face à 1 seul Civil
 *                   (les Civils ne peuvent plus gagner sans l'éliminer).
 * Agent Double    : gagne si l'Undercover est éliminé alors qu'il est encore
 *                   en vie.
 */
export function checkWinCondition(players) {
  const all   = Object.values(players)
  const alive = all.filter(p => !p.isEliminated)

  const aliveUC    = alive.filter(p => p.role === ROLES.UNDERCOVER)
  const aliveDA    = alive.filter(p => p.role === ROLES.DOUBLE_AGENT)
  const aliveCivil = alive.filter(p => [ROLES.CIVIL, ROLES.INDICATOR].includes(p.role))
  const aliveTour  = alive.filter(p => p.role === ROLES.TOURIST)

  // ── Agent Double ──────────────────────────────────────────
  // Si l'Undercover est éliminé et l'Agent Double est encore en vie → AD gagne
  if (aliveUC.length === 0 && aliveDA.length > 0) {
    return {
      gameOver: true,
      winners: [ROLES.DOUBLE_AGENT],
      reason: "L'Undercover a été éliminé et l'Agent Double est encore en vie. L'Agent Double gagne !",
    }
  }

  // ── Victoire Civils ───────────────────────────────────────
  // Les Civils gagnent UNIQUEMENT si tous les Undercovers ET le(s) Touriste(s) sont éliminés
  if (aliveUC.length === 0 && aliveTour.length === 0) {
    return {
      gameOver: true,
      winners: [ROLES.CIVIL, ROLES.INDICATOR],
      reason: "L'Undercover (et le Touriste) ont été démasqués ! Les Civils gagnent !",
    }
  }

  // ── Victoire Undercover ───────────────────────────────────
  // L'Undercover gagne si civils vivants <= undercovers + touristes vivants
  // (les civils ne peuvent plus avoir de majorité)
  const civilCount = aliveCivil.length
  const threatCount = aliveUC.length + aliveTour.length
  if (civilCount <= threatCount) {
    return {
      gameOver: true,
      winners: [ROLES.UNDERCOVER],
      reason: "L'Undercover prend le contrôle ! Les Civils ne sont plus en majorité.",
    }
  }

  // ── Victoire Touriste ─────────────────────────────────────
  // Le Touriste gagne si : il est le seul non-civil restant ET il ne reste qu'1 Civil
  // (les Civils ne peuvent pas l'éliminer sans voter entre eux)
  if (aliveTour.length > 0 && aliveUC.length === 0 && aliveCivil.length === 1) {
    return {
      gameOver: true,
      winners: [ROLES.TOURIST],
      reason: "Le Touriste a réussi à bluffer jusqu'au bout ! Il gagne !",
    }
  }

  return { gameOver: false }
}