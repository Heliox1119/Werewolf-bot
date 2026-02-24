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

PHASES.MAIN_PHASES = [PHASES.NIGHT, PHASES.DAY, PHASES.ENDED];
PHASES.SUB_PHASES = [
  PHASES.VOLEUR,
  PHASES.CUPIDON,
  PHASES.SALVATEUR,
  PHASES.LOUPS,
  PHASES.LOUP_BLANC,
  PHASES.SORCIERE,
  PHASES.VOYANTE,
  PHASES.REVEIL,
  PHASES.VOTE_CAPITAINE,
  PHASES.DELIBERATION,
  PHASES.VOTE
];

PHASES.VALID_MAIN_TRANSITIONS = {
  [PHASES.NIGHT]: [PHASES.DAY, PHASES.ENDED],
  [PHASES.DAY]: [PHASES.NIGHT, PHASES.ENDED],
  [PHASES.ENDED]: []
};

PHASES.isKnownMainPhase = function(phase) {
  return PHASES.MAIN_PHASES.includes(phase);
};

PHASES.isKnownSubPhase = function(subPhase) {
  return PHASES.SUB_PHASES.includes(subPhase);
};

PHASES.isValidMainTransition = function(fromPhase, toPhase) {
  if (!PHASES.isKnownMainPhase(fromPhase) || !PHASES.isKnownMainPhase(toPhase)) {
    return false;
  }
  if (fromPhase === PHASES.ENDED) return false;
  if (fromPhase === toPhase) return true;
  return PHASES.VALID_MAIN_TRANSITIONS[fromPhase].includes(toPhase);
};

/**
 * Validate a sub-phase transition.
 * @param {string} fromSubPhase
 * @param {string} toSubPhase
 * @returns {boolean}
 */
PHASES.isValidTransition = function(fromSubPhase, toSubPhase) {
  if (!PHASES.isKnownSubPhase(fromSubPhase) || !PHASES.isKnownSubPhase(toSubPhase)) {
    return false;
  }
  if (fromSubPhase === toSubPhase) return true;
  const allowed = PHASES.VALID_TRANSITIONS[fromSubPhase];
  if (!allowed) return false;
  return allowed.includes(toSubPhase);
};

module.exports = PHASES;
