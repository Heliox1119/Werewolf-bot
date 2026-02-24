const PHASES = {
  // Phases principales
  NIGHT: "Nuit",
  DAY: "Jour",
  ENDED: "Terminé",
  // Sous-phases détaillées
  VOLEUR: "Voleur",
  CUPIDON: "Cupidon",
  SALVATEUR: "Salvateur",
  LOUPS: "Loups",
  LOUP_BLANC: "Loup Blanc",
  SORCIERE: "Sorcière",
  VOYANTE: "Voyante",
  REVEIL: "Réveil",
  VOTE_CAPITAINE: "Vote Capitaine",
  DELIBERATION: "Délibération",
  VOTE: "Vote"
};

/**
 * Formal FSM transition table.
 * Maps each subPhase to the set of valid next subPhases.
 * Used to validate transitions and prevent invalid state changes.
 */
PHASES.VALID_TRANSITIONS = {
  // Night sub-phases (order depends on alive roles, but these are ALL valid nexts)
  [PHASES.VOLEUR]:        [PHASES.CUPIDON, PHASES.SALVATEUR, PHASES.LOUPS],
  [PHASES.CUPIDON]:       [PHASES.SALVATEUR, PHASES.LOUPS],
  [PHASES.SALVATEUR]:     [PHASES.LOUPS],
  [PHASES.LOUPS]:         [PHASES.LOUP_BLANC, PHASES.SORCIERE, PHASES.VOYANTE, PHASES.REVEIL],
  [PHASES.LOUP_BLANC]:    [PHASES.SORCIERE, PHASES.VOYANTE, PHASES.REVEIL],
  [PHASES.SORCIERE]:      [PHASES.VOYANTE, PHASES.REVEIL],
  [PHASES.VOYANTE]:       [PHASES.REVEIL],
  // Day sub-phases
  [PHASES.REVEIL]:        [PHASES.VOTE_CAPITAINE, PHASES.DELIBERATION],
  [PHASES.VOTE_CAPITAINE]:[PHASES.DELIBERATION],
  [PHASES.DELIBERATION]:  [PHASES.VOTE],
  [PHASES.VOTE]:          [PHASES.LOUPS, PHASES.CUPIDON, PHASES.SALVATEUR, PHASES.VOLEUR],
};

/**
 * Validate a sub-phase transition.
 * @param {string} fromSubPhase
 * @param {string} toSubPhase
 * @returns {boolean}
 */
PHASES.isValidTransition = function(fromSubPhase, toSubPhase) {
  // ENDED is always valid (victory can happen at any sub-phase)
  if (toSubPhase === PHASES.ENDED) return true;
  // No from = initial state (game start), allow anything
  if (!fromSubPhase) return true;
  const allowed = PHASES.VALID_TRANSITIONS[fromSubPhase];
  if (!allowed) return true; // Unknown from → allow (backwards compat)
  return allowed.includes(toSubPhase);
};

module.exports = PHASES;
