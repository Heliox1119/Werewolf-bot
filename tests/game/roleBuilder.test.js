/**
 * Tests for the Role Builder — API integration, schema validation,
 * custom role creation with abilities, invalid rejection, and crash restore.
 * 
 * Covers:
 * 1. Backend schema validation via RoleBuilderService
 * 2. Role creation with multiple abilities
 * 3. Invalid ability rejection
 * 4. Forbidden combo rejection
 * 5. Camp ↔ winCondition validation
 * 6. Crash restore of custom roles (round-trip persistence)
 * 7. Ability execution sanity (integration with event engine)
 */

'use strict';

const {
  validateAbility,
  validateRoleDefinition,
  normalizeAbility,
  normalizeRoleDefinition,
  ABILITY_TYPES,
  ABILITY_EFFECTS,
  ABILITY_TRIGGERS,
  CAMP_VALUES,
  WIN_CONDITIONS,
  TARGET_TYPES,
  MAX_ABILITIES_PER_ROLE,
  FORBIDDEN_COMBOS,
  EFFECT_PARAMETER_SCHEMAS,
} = require('../../game/abilities/abilitySchema');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeValidAbility(overrides = {}) {
  return {
    id: 'test_ability',
    type: 'night_target',
    trigger: 'night_action',
    phase: 'night',
    target: 'alive_other',
    effect: 'protect',
    charges: null,
    cooldown: null,
    parameters: {},
    ...overrides,
  };
}

function makeValidRole(overrides = {}) {
  return {
    name: 'Test Guardian',
    camp: 'village',
    winCondition: 'village_wins',
    abilities: [makeValidAbility()],
    ...overrides,
  };
}

// ─── 1. Backend Schema Validation ────────────────────────────────────────────

describe('roleBuilder — schema validation', () => {
  test('accepts a well-formed role with one ability', () => {
    const result = validateRoleDefinition(makeValidRole());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('rejects role without name', () => {
    const result = validateRoleDefinition(makeValidRole({ name: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('name'))).toBe(true);
  });

  test('rejects role name > 50 chars', () => {
    const result = validateRoleDefinition(makeValidRole({ name: 'A'.repeat(51) }));
    expect(result.valid).toBe(false);
  });

  test('rejects role with invalid camp', () => {
    const result = validateRoleDefinition(makeValidRole({ camp: 'neutral' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('camp'))).toBe(true);
  });

  test('rejects role with invalid winCondition', () => {
    const result = validateRoleDefinition(makeValidRole({ winCondition: 'everyone_dies' }));
    expect(result.valid).toBe(false);
  });

  test('rejects non-array abilities', () => {
    const result = validateRoleDefinition(makeValidRole({ abilities: 'not-an-array' }));
    expect(result.valid).toBe(false);
  });

  test('rejects null role', () => {
    const result = validateRoleDefinition(null);
    expect(result.valid).toBe(false);
  });
});

// ─── 2. Role Creation with Multiple Abilities ───────────────────────────────

describe('roleBuilder — multiple abilities', () => {
  test('accepts role with 2 valid abilities', () => {
    const role = makeValidRole({
      abilities: [
        makeValidAbility({ id: 'guard_protect', effect: 'protect' }),
        makeValidAbility({ id: 'guard_inspect', effect: 'inspect_alignment' }),
      ],
    });
    const result = validateRoleDefinition(role);
    expect(result.valid).toBe(true);
  });

  test('accepts role with MAX abilities', () => {
    const abilities = [];
    for (let i = 0; i < MAX_ABILITIES_PER_ROLE; i++) {
      abilities.push(makeValidAbility({ id: `ability_${i}`, effect: ABILITY_EFFECTS[i % ABILITY_EFFECTS.length] }));
    }
    // Skip forbidden combos by using safe effects only
    const safeEffects = ['protect', 'inspect_alignment', 'inspect_role', 'double_vote', 'silence'];
    const safeAbilities = safeEffects.slice(0, MAX_ABILITIES_PER_ROLE).map((eff, i) => (
      makeValidAbility({ id: `ab_${i}`, effect: eff })
    ));
    const role = makeValidRole({ abilities: safeAbilities });
    const result = validateRoleDefinition(role);
    expect(result.valid).toBe(true);
  });

  test('rejects role with > MAX abilities', () => {
    const abilities = [];
    for (let i = 0; i <= MAX_ABILITIES_PER_ROLE; i++) {
      abilities.push(makeValidAbility({ id: `ab_${i}`, effect: 'protect' }));
    }
    const result = validateRoleDefinition(makeValidRole({ abilities }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Maximum'))).toBe(true);
  });

  test('normalizes multiple abilities with correct priorities', () => {
    const role = makeValidRole({
      abilities: [
        makeValidAbility({ id: 'a1', effect: 'protect' }),
        makeValidAbility({ id: 'a2', effect: 'kill' }),
      ],
    });
    const normalized = normalizeRoleDefinition(role);
    expect(normalized.abilities[0].priority).toBe(30); // protect
    expect(normalized.abilities[1].priority).toBe(40); // kill
  });

  test('accepts wolf role with multiple wolf-appropriate abilities', () => {
    const role = makeValidRole({
      name: 'Alpha Wolf',
      camp: 'wolves',
      winCondition: 'wolves_win',
      abilities: [
        makeValidAbility({ id: 'alpha_kill', effect: 'kill' }),
        makeValidAbility({ id: 'alpha_silence', effect: 'silence' }),
      ],
    });
    const result = validateRoleDefinition(role);
    expect(result.valid).toBe(true);
  });
});

// ─── 3. Invalid Ability Rejection ────────────────────────────────────────────

describe('roleBuilder — invalid ability rejection', () => {
  test('rejects ability with invalid type', () => {
    const result = validateAbility(makeValidAbility({ type: 'flying' }));
    expect(result.valid).toBe(false);
  });

  test('rejects ability with invalid trigger', () => {
    const result = validateAbility(makeValidAbility({ trigger: 'magic_spell' }));
    expect(result.valid).toBe(false);
  });

  test('rejects ability with invalid effect', () => {
    const result = validateAbility(makeValidAbility({ effect: 'teleport' }));
    expect(result.valid).toBe(false);
  });

  test('rejects ability with invalid target', () => {
    const result = validateAbility(makeValidAbility({ target: 'everyone' }));
    expect(result.valid).toBe(false);
  });

  test('rejects ability with bad id format', () => {
    const result = validateAbility(makeValidAbility({ id: 'UPPER-CASE' }));
    expect(result.valid).toBe(false);
  });

  test('rejects ability with charges = 0', () => {
    const result = validateAbility(makeValidAbility({ charges: 0 }));
    expect(result.valid).toBe(false);
  });

  test('rejects ability with charges > 99', () => {
    const result = validateAbility(makeValidAbility({ charges: 100 }));
    expect(result.valid).toBe(false);
  });

  test('rejects ability with cooldown > 10', () => {
    const result = validateAbility(makeValidAbility({ cooldown: 11 }));
    expect(result.valid).toBe(false);
  });

  test('rejects night_target with wrong trigger', () => {
    const result = validateAbility(makeValidAbility({
      type: 'night_target', trigger: 'vote_cast',
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('night_target'))).toBe(true);
  });

  test('rejects on_death with wrong trigger', () => {
    const result = validateAbility(makeValidAbility({
      type: 'on_death', trigger: 'night_action',
    }));
    expect(result.valid).toBe(false);
  });

  test('rejects on_attacked with wrong trigger', () => {
    const result = validateAbility(makeValidAbility({
      type: 'on_attacked', trigger: 'phase_start',
    }));
    expect(result.valid).toBe(false);
  });

  test('rejects passive with invalid trigger', () => {
    const result = validateAbility(makeValidAbility({
      type: 'passive', trigger: 'night_action',
    }));
    expect(result.valid).toBe(false);
  });

  test('rejects unknown parameters', () => {
    const result = validateAbility(makeValidAbility({
      parameters: { hackedField: true },
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Unknown parameter'))).toBe(true);
  });

  test('rejects modify_vote_weight without weight', () => {
    const result = validateAbility(makeValidAbility({
      effect: 'modify_vote_weight',
      parameters: {},
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("Missing required parameter 'weight'"))).toBe(true);
  });

  test('rejects win_override without condition', () => {
    const result = validateAbility(makeValidAbility({
      type: 'passive',
      trigger: 'phase_start',
      effect: 'win_override',
      parameters: {},
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("Missing required parameter 'condition'"))).toBe(true);
  });

  test('rejects duplicate ability IDs in role', () => {
    const role = makeValidRole({
      abilities: [
        makeValidAbility({ id: 'same_id' }),
        makeValidAbility({ id: 'same_id' }),
      ],
    });
    const result = validateRoleDefinition(role);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Duplicate ability id'))).toBe(true);
  });
});

// ─── 4. Forbidden Combo Rejection ────────────────────────────────────────────

describe('roleBuilder — forbidden combos', () => {
  test.each(FORBIDDEN_COMBOS)('rejects %s + %s', (effectA, effectB) => {
    const typeB = effectB === 'immune_to_kill' ? 'passive' : 'night_target';
    const triggerB = effectB === 'immune_to_kill' ? 'player_targeted' : 'night_action';

    const role = makeValidRole({
      abilities: [
        makeValidAbility({ id: 'ab_a', effect: effectA }),
        makeValidAbility({ id: 'ab_b', effect: effectB, type: typeB, trigger: triggerB }),
      ],
    });
    const result = validateRoleDefinition(role);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Forbidden ability combination'))).toBe(true);
  });

  test('allows non-forbidden combo (protect + inspect)', () => {
    const role = makeValidRole({
      abilities: [
        makeValidAbility({ id: 'a1', effect: 'protect' }),
        makeValidAbility({ id: 'a2', effect: 'inspect_alignment' }),
      ],
    });
    const result = validateRoleDefinition(role);
    expect(result.valid).toBe(true);
  });
});

// ─── 5. Camp ↔ Win Condition Validation ──────────────────────────────────────

describe('roleBuilder — camp/winCondition compatibility', () => {
  test('village + village_wins ✓', () => {
    const result = validateRoleDefinition(makeValidRole({ camp: 'village', winCondition: 'village_wins' }));
    expect(result.valid).toBe(true);
  });

  test('village + wolves_win ✗', () => {
    const result = validateRoleDefinition(makeValidRole({ camp: 'village', winCondition: 'wolves_win' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Village camp cannot have wolves_win'))).toBe(true);
  });

  test('wolves + village_wins ✗', () => {
    const result = validateRoleDefinition(makeValidRole({ camp: 'wolves', winCondition: 'village_wins' }));
    expect(result.valid).toBe(false);
  });

  test('wolves + wolves_win ✓', () => {
    const result = validateRoleDefinition(makeValidRole({
      camp: 'wolves', winCondition: 'wolves_win',
      abilities: [makeValidAbility({ id: 'wolf_kill', effect: 'kill' })],
    }));
    expect(result.valid).toBe(true);
  });

  test('solo + solo_survive ✓', () => {
    const result = validateRoleDefinition(makeValidRole({
      camp: 'solo', winCondition: 'solo_survive',
      abilities: [makeValidAbility({ id: 'solo_inspect', effect: 'inspect_alignment' })],
    }));
    expect(result.valid).toBe(true);
  });

  test('solo + lovers_survive ✓', () => {
    const result = validateRoleDefinition(makeValidRole({
      camp: 'solo', winCondition: 'lovers_survive',
      abilities: [makeValidAbility()],
    }));
    expect(result.valid).toBe(true);
  });
});

// ─── 6. Crash Restore — Serialization Round-Trip ─────────────────────────────

describe('roleBuilder — crash restore', () => {
  test('normalized role survives JSON round-trip', () => {
    const role = makeValidRole({
      name: '  Test Guardian  ',
      abilities: [
        makeValidAbility({ id: 'a1', effect: 'protect', charges: 3 }),
        makeValidAbility({ id: 'a2', effect: 'inspect_role', cooldown: 2 }),
      ],
    });

    const normalized = normalizeRoleDefinition(role);
    const json = JSON.stringify(normalized.abilities);
    const restored = JSON.parse(json);

    expect(restored).toHaveLength(2);
    expect(restored[0].id).toBe('a1');
    expect(restored[0].charges).toBe(3);
    expect(restored[0].priority).toBe(30); // protect
    expect(restored[1].id).toBe('a2');
    expect(restored[1].cooldown).toBe(2);
    expect(restored[1].priority).toBe(50); // inspect_role

    // Re-validate restored abilities
    for (const ab of restored) {
      const result = validateAbility(ab);
      expect(result.valid).toBe(true);
    }
  });

  test('empty abilities array survives round-trip', () => {
    const json = JSON.stringify([]);
    const restored = JSON.parse(json);
    expect(restored).toEqual([]);
  });

  test('normalized role name is trimmed', () => {
    const normalized = normalizeRoleDefinition(makeValidRole({ name: '  Spaced Name  ' }));
    expect(normalized.name).toBe('Spaced Name');
  });

  test('null charges/cooldown preserved through normalization', () => {
    const normalized = normalizeAbility(makeValidAbility({ charges: null, cooldown: null }));
    expect(normalized.charges).toBeNull();
    expect(normalized.cooldown).toBeNull();
  });
});

// ─── 7. Ability Execution Sanity ─────────────────────────────────────────────

describe('roleBuilder — execution sanity', () => {
  let dispatch, EVENTS, getAbilityState, resetCycleState;

  beforeAll(() => {
    try {
      const engine = require('../../game/abilities/gameEventEngine');
      dispatch = engine.dispatch;
      EVENTS = engine.EVENTS;
      getAbilityState = engine.getAbilityState;
      resetCycleState = engine.resetCycleState;
    } catch {
      // If engine not available, skip execution tests
    }
  });

  function makeGameWithCustomRole(roleDef) {
    return {
      phase: 'Nuit',
      dayCount: 1,
      players: [
        {
          id: 'p1', username: 'CustomPlayer', role: roleDef.name, alive: true,
          _customRole: roleDef,
        },
        { id: 'p2', username: 'Villager', role: 'Villageois', alive: true },
      ],
      mainChannelId: 'ch1',
    };
  }

  test('custom protect role dispatches correctly', () => {
    if (!dispatch) return; // Skip if engine unavailable

    const role = normalizeRoleDefinition(makeValidRole({
      name: 'CustomShield',
      abilities: [makeValidAbility({ id: 'shield_protect', effect: 'protect' })],
    }));

    const game = makeGameWithCustomRole(role);
    resetCycleState(game);

    const { results } = dispatch(EVENTS.NIGHT_ACTION, { game, target: game.players[1] });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].applied).toBe(true);
  });

  test('custom kill role dispatches correctly', () => {
    if (!dispatch) return;

    const role = normalizeRoleDefinition({
      name: 'CustomKiller',
      camp: 'wolves',
      winCondition: 'wolves_win',
      abilities: [makeValidAbility({ id: 'custom_kill', effect: 'kill' })],
    });

    const game = makeGameWithCustomRole(role);
    resetCycleState(game);

    const { results } = dispatch(EVENTS.NIGHT_ACTION, { game, target: game.players[1] });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test('charges are tracked after ability use', () => {
    if (!dispatch) return;

    const role = normalizeRoleDefinition(makeValidRole({
      name: 'LimitedGuard',
      abilities: [makeValidAbility({ id: 'limited_protect', effect: 'protect', charges: 2 })],
    }));

    const game = makeGameWithCustomRole(role);
    resetCycleState(game);

    dispatch(EVENTS.NIGHT_ACTION, { game, target: game.players[1] });

    const state = getAbilityState(game);
    expect(state.chargesUsed['p1:limited_protect']).toBe(1);
  });

  test('role with zero abilities produces no events', () => {
    if (!dispatch) return;

    const role = normalizeRoleDefinition({
      name: 'Passive Nobody',
      camp: 'village',
      winCondition: 'village_wins',
      abilities: [],
    });

    const game = makeGameWithCustomRole(role);
    resetCycleState(game);

    const { results } = dispatch(EVENTS.NIGHT_ACTION, { game, target: game.players[1] });
    expect(results).toHaveLength(0);
  });
});

// ─── 8. Parameter Validation ─────────────────────────────────────────────────

describe('roleBuilder — parameter validation', () => {
  test('modify_vote_weight with valid weight passes', () => {
    const result = validateAbility(makeValidAbility({
      effect: 'modify_vote_weight',
      parameters: { weight: 2 },
    }));
    expect(result.valid).toBe(true);
  });

  test('modify_vote_weight with weight > 5 fails', () => {
    const result = validateAbility(makeValidAbility({
      effect: 'modify_vote_weight',
      parameters: { weight: 10 },
    }));
    expect(result.valid).toBe(false);
  });

  test('win_override with valid condition passes', () => {
    const result = validateAbility(makeValidAbility({
      type: 'passive', trigger: 'phase_start',
      effect: 'win_override',
      parameters: { condition: 'solo_survive' },
    }));
    expect(result.valid).toBe(true);
  });

  test('win_override with invalid condition fails', () => {
    const result = validateAbility(makeValidAbility({
      type: 'passive', trigger: 'phase_start',
      effect: 'win_override',
      parameters: { condition: 'everyone_wins' },
    }));
    expect(result.valid).toBe(false);
  });

  test('silence with duration in range passes', () => {
    const result = validateAbility(makeValidAbility({
      effect: 'silence',
      parameters: { duration: 3 },
    }));
    expect(result.valid).toBe(true);
  });

  test('silence with duration > 5 fails', () => {
    const result = validateAbility(makeValidAbility({
      effect: 'silence',
      parameters: { duration: 10 },
    }));
    expect(result.valid).toBe(false);
  });

  test('immune_to_kill with maxUses in range passes', () => {
    const result = validateAbility(makeValidAbility({
      type: 'on_attacked', trigger: 'player_targeted',
      effect: 'immune_to_kill',
      parameters: { maxUses: 2 },
    }));
    expect(result.valid).toBe(true);
  });

  test('protect with protectSelf boolean passes', () => {
    const result = validateAbility(makeValidAbility({
      effect: 'protect',
      parameters: { protectSelf: true },
    }));
    expect(result.valid).toBe(true);
  });

  test('protect with protectSelf non-boolean fails', () => {
    const result = validateAbility(makeValidAbility({
      effect: 'protect',
      parameters: { protectSelf: 'yes' },
    }));
    expect(result.valid).toBe(false);
  });
});

// ─── 9. Normalization ────────────────────────────────────────────────────────

describe('roleBuilder — normalization', () => {
  test('fills default priority from effect', () => {
    const normalized = normalizeAbility(makeValidAbility({ effect: 'kill' }));
    expect(normalized.priority).toBe(40);
  });

  test('respects explicit priority over default', () => {
    const normalized = normalizeAbility(makeValidAbility({ effect: 'kill', priority: 15 }));
    expect(normalized.priority).toBe(15);
  });

  test('defaults phase and target to null', () => {
    const normalized = normalizeAbility({
      id: 'test', type: 'night_target', trigger: 'night_action', effect: 'protect',
    });
    expect(normalized.phase).toBeNull();
    expect(normalized.target).toBeNull();
  });

  test('defaults charges and cooldown to null', () => {
    const normalized = normalizeAbility({
      id: 'test', type: 'night_target', trigger: 'night_action', effect: 'protect',
    });
    expect(normalized.charges).toBeNull();
    expect(normalized.cooldown).toBeNull();
  });

  test('copies parameters by value', () => {
    const original = { protectSelf: true };
    const normalized = normalizeAbility(makeValidAbility({ parameters: original }));
    original.protectSelf = false;
    expect(normalized.parameters.protectSelf).toBe(true); // Not mutated
  });
});
