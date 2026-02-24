const PHASES = require('../../game/phases');

describe('PHASES constants', () => {
  test('toutes les phases sont définies', () => {
    expect(PHASES.NIGHT).toBe('Nuit');
    expect(PHASES.DAY).toBe('Jour');
    expect(PHASES.LOUPS).toBe('Loups');
    expect(PHASES.VOYANTE).toBe('Voyante');
    expect(PHASES.SORCIERE).toBe('Sorcière');
    expect(PHASES.ENDED).toBe('Terminé');
    expect(PHASES.REVEIL).toBe('Réveil');
  });

  test('pas de phases dupliquées', () => {
    const phaseValues = Object.entries(PHASES)
      .filter(([k, v]) => typeof v === 'string') // Skip VALID_TRANSITIONS and isValidTransition
      .map(([k, v]) => v);
    const uniqueValues = new Set(phaseValues);
    
    expect(phaseValues.length).toBe(uniqueValues.size);
  });

  test('toutes les phases sont des strings', () => {
    Object.entries(PHASES)
      .filter(([k, v]) => typeof v === 'string')
      .forEach(([k, phase]) => {
        expect(typeof phase).toBe('string');
        expect(phase.length).toBeGreaterThan(0);
      });
  });
});

describe('Séquence des phases', () => {
  test('les phases principales sont NIGHT et DAY', () => {
    const mainPhases = [PHASES.NIGHT, PHASES.DAY];
    
    expect(mainPhases).toContain(PHASES.NIGHT);
    expect(mainPhases).toContain(PHASES.DAY);
  });

  test('les sous-phases nocturnes existent', () => {
    const nightSubPhases = [
      PHASES.LOUPS,
      PHASES.VOYANTE,
      PHASES.SORCIERE
    ];

    nightSubPhases.forEach(phase => {
      expect(Object.values(PHASES)).toContain(phase);
    });
  });

  test('la phase de fin existe', () => {
    expect(PHASES.ENDED).toBe('Terminé');
  });
});

describe('Ordre logique des phases', () => {
  test('séquence typique nuit -> jour', () => {
    const typicalSequence = [
      PHASES.NIGHT,  // Phase principale
      PHASES.LOUPS,  // Sous-phase: loups choisissent victime
      PHASES.VOYANTE, // Sous-phase: voyante voit un rôle
      PHASES.SORCIERE, // Sous-phase: sorcière utilise potions
      PHASES.DAY     // Phase principale: débat et vote
    ];

    typicalSequence.forEach(phase => {
      expect(Object.values(PHASES)).toContain(phase);
    });
  });

  test('phases de vote existent', () => {
    expect(PHASES.VOTE).toBe('Vote');
    expect(PHASES.VOTE_CAPITAINE).toBe('Vote Capitaine');
    expect(PHASES.DELIBERATION).toBe('Délibération');
  });
});

describe('VALID_TRANSITIONS (FSM table)', () => {
  test('transition table is defined', () => {
    expect(PHASES.VALID_TRANSITIONS).toBeDefined();
    expect(Object.keys(PHASES.VALID_TRANSITIONS).length).toBeGreaterThan(0);
  });

  test('night sub-phases have transitions', () => {
    const nightPhases = [PHASES.VOLEUR, PHASES.CUPIDON, PHASES.SALVATEUR, PHASES.LOUPS, PHASES.LOUP_BLANC, PHASES.SORCIERE, PHASES.VOYANTE];
    for (const phase of nightPhases) {
      expect(PHASES.VALID_TRANSITIONS[phase]).toBeDefined();
      expect(Array.isArray(PHASES.VALID_TRANSITIONS[phase])).toBe(true);
    }
  });

  test('day sub-phases have transitions', () => {
    const dayPhases = [PHASES.REVEIL, PHASES.VOTE_CAPITAINE, PHASES.DELIBERATION, PHASES.VOTE];
    for (const phase of dayPhases) {
      expect(PHASES.VALID_TRANSITIONS[phase]).toBeDefined();
    }
  });

  test('LOUPS can go to LOUP_BLANC, SORCIERE, VOYANTE, REVEIL', () => {
    const allowed = PHASES.VALID_TRANSITIONS[PHASES.LOUPS];
    expect(allowed).toContain(PHASES.LOUP_BLANC);
    expect(allowed).toContain(PHASES.SORCIERE);
    expect(allowed).toContain(PHASES.VOYANTE);
    expect(allowed).toContain(PHASES.REVEIL);
  });

  test('DELIBERATION only leads to VOTE', () => {
    expect(PHASES.VALID_TRANSITIONS[PHASES.DELIBERATION]).toEqual([PHASES.VOTE]);
  });
});

describe('isValidTransition()', () => {
  test('allows valid forward transitions', () => {
    expect(PHASES.isValidTransition(PHASES.VOLEUR, PHASES.CUPIDON)).toBe(true);
    expect(PHASES.isValidTransition(PHASES.LOUPS, PHASES.SORCIERE)).toBe(true);
    expect(PHASES.isValidTransition(PHASES.SORCIERE, PHASES.VOYANTE)).toBe(true);
    expect(PHASES.isValidTransition(PHASES.VOYANTE, PHASES.REVEIL)).toBe(true);
    expect(PHASES.isValidTransition(PHASES.DELIBERATION, PHASES.VOTE)).toBe(true);
  });

  test('rejects invalid backward transitions', () => {
    expect(PHASES.isValidTransition(PHASES.VOYANTE, PHASES.LOUPS)).toBe(false);
    expect(PHASES.isValidTransition(PHASES.REVEIL, PHASES.LOUPS)).toBe(false);
    expect(PHASES.isValidTransition(PHASES.DELIBERATION, PHASES.REVEIL)).toBe(false);
    expect(PHASES.isValidTransition(PHASES.VOTE, PHASES.DELIBERATION)).toBe(false);
  });

  test('rejects unknown and null states', () => {
    expect(PHASES.isValidTransition(null, PHASES.VOLEUR)).toBe(false);
    expect(PHASES.isValidTransition(undefined, PHASES.LOUPS)).toBe(false);
    expect(PHASES.isValidTransition('UnknownPhase', PHASES.LOUPS)).toBe(false);
    expect(PHASES.isValidTransition(PHASES.LOUPS, 'UnknownPhase')).toBe(false);
    expect(PHASES.isValidTransition(PHASES.LOUPS, PHASES.ENDED)).toBe(false);
  });

  test('validates full night cycle', () => {
    expect(PHASES.isValidTransition(PHASES.VOLEUR, PHASES.CUPIDON)).toBe(true);
    expect(PHASES.isValidTransition(PHASES.CUPIDON, PHASES.SALVATEUR)).toBe(true);
    expect(PHASES.isValidTransition(PHASES.SALVATEUR, PHASES.LOUPS)).toBe(true);
    expect(PHASES.isValidTransition(PHASES.LOUPS, PHASES.SORCIERE)).toBe(true);
    expect(PHASES.isValidTransition(PHASES.SORCIERE, PHASES.VOYANTE)).toBe(true);
    expect(PHASES.isValidTransition(PHASES.VOYANTE, PHASES.REVEIL)).toBe(true);
  });

  test('validates full day cycle', () => {
    expect(PHASES.isValidTransition(PHASES.REVEIL, PHASES.VOTE_CAPITAINE)).toBe(true);
    expect(PHASES.isValidTransition(PHASES.VOTE_CAPITAINE, PHASES.DELIBERATION)).toBe(true);
    expect(PHASES.isValidTransition(PHASES.DELIBERATION, PHASES.VOTE)).toBe(true);
  });

  test('validates skipped-role transitions', () => {
    // Skip Loup Blanc/Sorciere → direct VOYANTE
    expect(PHASES.isValidTransition(PHASES.LOUPS, PHASES.VOYANTE)).toBe(true);
    // Skip everything after loups → REVEIL
    expect(PHASES.isValidTransition(PHASES.LOUPS, PHASES.REVEIL)).toBe(true);
  });

  test('validates every transition path exhaustively', () => {
    const subPhases = PHASES.SUB_PHASES;
    for (const from of subPhases) {
      const allowed = new Set(PHASES.VALID_TRANSITIONS[from] || []);
      for (const to of subPhases) {
        if (to === from) {
          expect(PHASES.isValidTransition(from, to)).toBe(true);
          continue;
        }
        expect(PHASES.isValidTransition(from, to)).toBe(allowed.has(to));
      }
    }
  });
});

describe('isValidMainTransition()', () => {
  test('allows only declared main phase transitions', () => {
    expect(PHASES.isValidMainTransition(PHASES.NIGHT, PHASES.DAY)).toBe(true);
    expect(PHASES.isValidMainTransition(PHASES.DAY, PHASES.NIGHT)).toBe(true);
    expect(PHASES.isValidMainTransition(PHASES.NIGHT, PHASES.ENDED)).toBe(true);
    expect(PHASES.isValidMainTransition(PHASES.DAY, PHASES.ENDED)).toBe(true);
  });

  test('rejects illegal and unknown main phase transitions', () => {
    expect(PHASES.isValidMainTransition(PHASES.ENDED, PHASES.NIGHT)).toBe(false);
    expect(PHASES.isValidMainTransition(PHASES.ENDED, PHASES.DAY)).toBe(false);
    expect(PHASES.isValidMainTransition(PHASES.ENDED, PHASES.ENDED)).toBe(false);
    expect(PHASES.isValidMainTransition('Unknown', PHASES.DAY)).toBe(false);
    expect(PHASES.isValidMainTransition(PHASES.DAY, 'Unknown')).toBe(false);
    expect(PHASES.isValidMainTransition(null, PHASES.DAY)).toBe(false);
  });
});
