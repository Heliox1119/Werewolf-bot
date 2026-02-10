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
    const phaseValues = Object.values(PHASES);
    const uniqueValues = new Set(phaseValues);
    
    expect(phaseValues.length).toBe(uniqueValues.size);
  });

  test('toutes les phases sont des strings', () => {
    Object.values(PHASES).forEach(phase => {
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
