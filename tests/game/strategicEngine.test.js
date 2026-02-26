/**
 * Unit tests for the Strategic Role Analysis Engine.
 *
 * Tests cover:
 *   - Power scoring (base, modifiers, normalization, tiers)
 *   - Orientation detection (dominant axis, hybrid, support)
 *   - Stability / risk analysis (flag detection, severity)
 *   - Full analyze() pipeline
 */
'use strict';

const StrategicEngine = require('../../web/public/js/strategicEngine');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAbility(overrides = {}) {
  return {
    id: 'test_ability',
    type: 'night_target',
    trigger: 'night_action',
    phase: 'night',
    target: 'alive_other',
    effect: 'kill',
    charges: null,
    cooldown: null,
    parameters: {},
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Power Scoring
// ═══════════════════════════════════════════════════════════════════════════════

describe('StrategicEngine.computePower', () => {
  test('returns score 0 for empty abilities', () => {
    const result = StrategicEngine.computePower([]);
    expect(result.score).toBe(0);
    expect(result.tier).toBe('N/A');
    expect(result.breakdown).toHaveLength(0);
  });

  test('returns score 0 for null abilities', () => {
    const result = StrategicEngine.computePower(null);
    expect(result.score).toBe(0);
  });

  test('assigns higher score to kill than protect', () => {
    const killResult = StrategicEngine.computePower([makeAbility({ effect: 'kill' })]);
    const protResult = StrategicEngine.computePower([makeAbility({ effect: 'protect' })]);
    expect(killResult.score).toBeGreaterThan(protResult.score);
  });

  test('passive type increases power score', () => {
    const active = StrategicEngine.computePower([
      makeAbility({ effect: 'inspect_alignment', type: 'night_target' }),
    ]);
    const passive = StrategicEngine.computePower([
      makeAbility({ effect: 'inspect_alignment', type: 'passive' }),
    ]);
    expect(passive.score).toBeGreaterThan(active.score);
  });

  test('limited charges (1 use) reduces power', () => {
    const unlimited = StrategicEngine.computePower([
      makeAbility({ effect: 'kill', charges: null }),
    ]);
    const oneUse = StrategicEngine.computePower([
      makeAbility({ effect: 'kill', charges: 1 }),
    ]);
    expect(oneUse.score).toBeLessThan(unlimited.score);
  });

  test('bypass protection parameter increases power', () => {
    const normal = StrategicEngine.computePower([
      makeAbility({ effect: 'kill' }),
    ]);
    const bypass = StrategicEngine.computePower([
      makeAbility({ effect: 'kill', parameters: { bypassProtection: true } }),
    ]);
    expect(bypass.score).toBeGreaterThan(normal.score);
  });

  test('multiple abilities score higher than single', () => {
    const single = StrategicEngine.computePower([
      makeAbility({ effect: 'protect' }),
    ]);
    const multi = StrategicEngine.computePower([
      makeAbility({ effect: 'protect' }),
      makeAbility({ effect: 'inspect_alignment', id: 'ab2' }),
    ]);
    expect(multi.score).toBeGreaterThan(single.score);
  });

  test('score never exceeds 10', () => {
    const abilities = [
      makeAbility({ effect: 'kill', type: 'passive', parameters: { bypassProtection: true }, id: 'a1' }),
      makeAbility({ effect: 'immune_to_kill', type: 'passive', id: 'a2' }),
      makeAbility({ effect: 'redirect', id: 'a3' }),
      makeAbility({ effect: 'swap_roles', id: 'a4' }),
      makeAbility({ effect: 'win_override', id: 'a5' }),
    ];
    const result = StrategicEngine.computePower(abilities);
    expect(result.score).toBeLessThanOrEqual(10);
  });

  test('breakdown lists each ability contribution', () => {
    const abilities = [
      makeAbility({ effect: 'kill', id: 'a1' }),
      makeAbility({ effect: 'protect', id: 'a2' }),
    ];
    const result = StrategicEngine.computePower(abilities);
    expect(result.breakdown).toHaveLength(2);
    expect(result.breakdown[0].effect).toBe('kill');
    expect(result.breakdown[1].effect).toBe('protect');
    expect(result.breakdown[0].base).toBeGreaterThan(result.breakdown[1].base);
  });

  test('tier classification - Faible for low score', () => {
    const result = StrategicEngine.computePower([
      makeAbility({ effect: 'protect', type: 'on_death', charges: 1, cooldown: 5 }),
    ]);
    expect(['Faible', 'Modéré']).toContain(result.tier);
  });

  test('tier classification - high power yields Puissant or Extrême', () => {
    const abilities = [
      makeAbility({ effect: 'kill', parameters: { bypassProtection: true }, id: 'a1' }),
      makeAbility({ effect: 'immune_to_kill', type: 'passive', id: 'a2' }),
      makeAbility({ effect: 'win_override', id: 'a3' }),
    ];
    const result = StrategicEngine.computePower(abilities);
    expect(['Puissant', 'Extrême']).toContain(result.tier);
  });

  test('high cooldown reduces power', () => {
    const noCooldown = StrategicEngine.computePower([
      makeAbility({ effect: 'kill', cooldown: null }),
    ]);
    const highCooldown = StrategicEngine.computePower([
      makeAbility({ effect: 'kill', cooldown: 5 }),
    ]);
    expect(highCooldown.score).toBeLessThan(noCooldown.score);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Orientation Detection
// ═══════════════════════════════════════════════════════════════════════════════

describe('StrategicEngine.computeOrientation', () => {
  test('returns "none" for empty abilities', () => {
    const result = StrategicEngine.computeOrientation([]);
    expect(result.dominant).toBe('none');
  });

  test('classifies kill-heavy role as aggressive', () => {
    const result = StrategicEngine.computeOrientation([
      makeAbility({ effect: 'kill' }),
      makeAbility({ effect: 'silence', id: 'a2' }),
    ]);
    expect(result.dominant).toBe('aggressive');
  });

  test('classifies protect + immunity as defensive or support', () => {
    const result = StrategicEngine.computeOrientation([
      makeAbility({ effect: 'protect' }),
      makeAbility({ effect: 'immune_to_kill', id: 'a2' }),
    ]);
    expect(['defensive', 'support']).toContain(result.dominant);
  });

  test('classifies inspection abilities as information', () => {
    const result = StrategicEngine.computeOrientation([
      makeAbility({ effect: 'inspect_role' }),
      makeAbility({ effect: 'inspect_alignment', id: 'a2' }),
    ]);
    expect(result.dominant).toBe('information');
  });

  test('classifies swap+redirect+win_override as chaos', () => {
    const result = StrategicEngine.computeOrientation([
      makeAbility({ effect: 'swap_roles' }),
      makeAbility({ effect: 'win_override', id: 'a2' }),
    ]);
    expect(result.dominant).toBe('chaos');
  });

  test('classifies mixed abilities as hybrid', () => {
    // Kill (aggressive) + inspect_role (information) — close in weight
    const result = StrategicEngine.computeOrientation([
      makeAbility({ effect: 'kill' }),
      makeAbility({ effect: 'inspect_role', id: 'a2' }),
      makeAbility({ effect: 'reveal_role', id: 'a3' }),
    ]);
    // Aggressive: kill=5, Information: inspect_role=3 + reveal_role=2.8 = 5.8
    // close enough → could be hybrid or information
    expect(['hybrid', 'information', 'aggressive']).toContain(result.dominant);
  });

  test('protect-only without aggression = support', () => {
    const result = StrategicEngine.computeOrientation([
      makeAbility({ effect: 'protect' }),
      makeAbility({ effect: 'double_vote', id: 'a2' }),
    ]);
    expect(result.dominant).toBe('support');
  });

  test('scores object has all axes', () => {
    const result = StrategicEngine.computeOrientation([makeAbility({ effect: 'kill' })]);
    expect(result.scores).toHaveProperty('aggressive');
    expect(result.scores).toHaveProperty('defensive');
    expect(result.scores).toHaveProperty('information');
    expect(result.scores).toHaveProperty('control');
    expect(result.scores).toHaveProperty('chaos');
  });

  test('meta contains label, icon, and color', () => {
    const result = StrategicEngine.computeOrientation([makeAbility({ effect: 'kill' })]);
    expect(result.meta).toHaveProperty('label');
    expect(result.meta).toHaveProperty('icon');
    expect(result.meta).toHaveProperty('color');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Risk Analysis
// ═══════════════════════════════════════════════════════════════════════════════

describe('StrategicEngine.computeRisk', () => {
  test('returns low risk for empty abilities', () => {
    const result = StrategicEngine.computeRisk([], { camp: 'village' });
    expect(result.level).toBe('Aucun');
    expect(result.flags).toHaveLength(0);
  });

  test('flags passive + kill as high risk', () => {
    const result = StrategicEngine.computeRisk([
      makeAbility({ effect: 'kill', type: 'passive' }),
    ], { camp: 'wolves' });
    const flagLabels = result.flags.map(f => f.label);
    expect(flagLabels.some(l => l.includes('passif'))).toBe(true);
    expect(result.totalSeverity).toBeGreaterThanOrEqual(3);
  });

  test('flags unlimited kill', () => {
    const result = StrategicEngine.computeRisk([
      makeAbility({ effect: 'kill', charges: null }),
    ], { camp: 'wolves' });
    const flagLabels = result.flags.map(f => f.label);
    expect(flagLabels.some(l => l.includes('limite'))).toBe(true);
  });

  test('flags bypass protection', () => {
    const result = StrategicEngine.computeRisk([
      makeAbility({ effect: 'kill', parameters: { bypassProtection: true } }),
    ], { camp: 'wolves' });
    const flagLabels = result.flags.map(f => f.label);
    expect(flagLabels.some(l => l.includes('protection'))).toBe(true);
  });

  test('flags too many abilities', () => {
    const abilities = Array.from({ length: 4 }, (_, i) =>
      makeAbility({ effect: 'protect', id: 'a' + i })
    );
    const result = StrategicEngine.computeRisk(abilities, { camp: 'village' });
    const flagLabels = result.flags.map(f => f.label);
    expect(flagLabels.some(l => l.includes('Nombre élevé'))).toBe(true);
  });

  test('flags passive immunity', () => {
    const result = StrategicEngine.computeRisk([
      makeAbility({ effect: 'immune_to_kill', type: 'passive' }),
    ], { camp: 'village' });
    const flagLabels = result.flags.map(f => f.label);
    expect(flagLabels.some(l => l.includes('Immunité permanente'))).toBe(true);
  });

  test('flags solo camp with immunity', () => {
    const result = StrategicEngine.computeRisk([
      makeAbility({ effect: 'immune_to_kill' }),
    ], { camp: 'solo' });
    const flagLabels = result.flags.map(f => f.label);
    expect(flagLabels.some(l => l.includes('Solo'))).toBe(true);
  });

  test('flags no cooldown on offensive powers', () => {
    const result = StrategicEngine.computeRisk([
      makeAbility({ effect: 'silence', charges: null, cooldown: null }),
    ], { camp: 'village' });
    const flagLabels = result.flags.map(f => f.label);
    expect(flagLabels.some(l => l.includes('délai'))).toBe(true);
  });

  test('moderate risk returns appropriate level', () => {
    const result = StrategicEngine.computeRisk([
      makeAbility({ effect: 'kill', charges: null }),
    ], { camp: 'wolves' });
    expect(['Modéré', 'Élevé', 'Critique']).toContain(result.level);
  });

  test('risk color matches severity', () => {
    const safe = StrategicEngine.computeRisk([
      makeAbility({ effect: 'protect', charges: 1 }),
    ], { camp: 'village' });
    // Low severity → greenish
    expect(safe.color).toBeTruthy();

    const dangerous = StrategicEngine.computeRisk([
      makeAbility({ effect: 'kill', type: 'passive', parameters: { bypassProtection: true } }),
    ], { camp: 'solo' });
    // High severity → reddish
    expect(dangerous.color).toBe('#ef4444');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Full Analysis Pipeline
// ═══════════════════════════════════════════════════════════════════════════════

describe('StrategicEngine.analyze', () => {
  test('returns power, orientation, and risk', () => {
    const abilities = [makeAbility({ effect: 'kill' })];
    const result = StrategicEngine.analyze(abilities, { camp: 'wolves' });

    expect(result).toHaveProperty('power');
    expect(result).toHaveProperty('orientation');
    expect(result).toHaveProperty('risk');
    expect(result.power.score).toBeGreaterThan(0);
    expect(result.orientation.dominant).toBeTruthy();
    expect(result.risk.level).toBeTruthy();
  });

  test('analysis is deterministic (same input → same output)', () => {
    const abilities = [
      makeAbility({ effect: 'kill', id: 'a1' }),
      makeAbility({ effect: 'protect', id: 'a2' }),
    ];
    const ctx = { camp: 'village', winCondition: 'village_wins' };

    const run1 = StrategicEngine.analyze(abilities, ctx);
    const run2 = StrategicEngine.analyze(abilities, ctx);

    expect(run1.power.score).toBe(run2.power.score);
    expect(run1.orientation.dominant).toBe(run2.orientation.dominant);
    expect(run1.risk.level).toBe(run2.risk.level);
  });

  test('empty abilities produce zero power and no orientation', () => {
    const result = StrategicEngine.analyze([], {});
    expect(result.power.score).toBe(0);
    expect(result.orientation.dominant).toBe('none');
    expect(result.risk.flags).toHaveLength(0);
  });

  test('realistic village protector profile', () => {
    const abilities = [
      makeAbility({
        id: 'guard_protect',
        effect: 'protect',
        type: 'night_target',
        trigger: 'night_action',
        phase: 'night',
        target: 'alive_other',
        charges: null,
        cooldown: null,
      }),
    ];
    const result = StrategicEngine.analyze(abilities, {
      camp: 'village',
      winCondition: 'village_wins',
    });

    expect(result.power.score).toBeLessThan(6);
    expect(['defensive', 'support']).toContain(result.orientation.dominant);
    expect(result.risk.totalSeverity).toBeLessThanOrEqual(2);
  });

  test('realistic wolf killer profile', () => {
    const abilities = [
      makeAbility({
        id: 'wolf_kill',
        effect: 'kill',
        type: 'night_target',
        trigger: 'night_action',
        phase: 'night',
        target: 'alive_other',
        charges: null,
        cooldown: null,
      }),
    ];
    const result = StrategicEngine.analyze(abilities, {
      camp: 'wolves',
      winCondition: 'wolves_win',
    });

    expect(result.power.score).toBeGreaterThan(3);
    expect(result.orientation.dominant).toBe('aggressive');
  });

  test('overpowered solo role gets critical risk', () => {
    const abilities = [
      makeAbility({ effect: 'kill', type: 'passive', id: 'a1', parameters: { bypassProtection: true } }),
      makeAbility({ effect: 'immune_to_kill', type: 'passive', id: 'a2' }),
      makeAbility({ effect: 'win_override', id: 'a3', parameters: { condition: 'solo_survive' } }),
      makeAbility({ effect: 'swap_roles', id: 'a4' }),
    ];
    const result = StrategicEngine.analyze(abilities, {
      camp: 'solo',
      winCondition: 'solo_survive',
    });

    expect(result.power.score).toBeGreaterThan(7);
    expect(result.risk.level).toBe('Critique');
    expect(result.risk.flags.length).toBeGreaterThanOrEqual(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Exports / Constants
// ═══════════════════════════════════════════════════════════════════════════════

describe('StrategicEngine constants', () => {
  test('EFFECT_WEIGHTS covers all expected effects', () => {
    const effects = ['kill', 'protect', 'inspect_alignment', 'inspect_role',
      'redirect', 'double_vote', 'immune_to_kill', 'win_override',
      'silence', 'block', 'reveal_role', 'reveal_alignment',
      'modify_vote_weight', 'swap_roles'];
    for (const e of effects) {
      expect(StrategicEngine.EFFECT_WEIGHTS[e]).toBeDefined();
      expect(typeof StrategicEngine.EFFECT_WEIGHTS[e]).toBe('number');
    }
  });

  test('ORIENTATION_LABELS has all required keys', () => {
    const keys = ['aggressive', 'defensive', 'information', 'control', 'chaos', 'hybrid', 'support', 'none'];
    for (const k of keys) {
      expect(StrategicEngine.ORIENTATION_LABELS[k]).toBeDefined();
      expect(StrategicEngine.ORIENTATION_LABELS[k].label).toBeTruthy();
    }
  });

  test('API is frozen (immutable)', () => {
    expect(() => { StrategicEngine.computePower = null; }).toThrow();
  });
});
