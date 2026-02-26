/**
 * Tests for the Ability Engine — abilitySchema, effectHandlers,
 * gameEventEngine, conflictResolver, builtinRoles, roleBuilderService.
 * 
 * Covers:
 * 1. Ability execution order
 * 2. Protect vs kill resolution
 * 3. Redirect resolution
 * 4. On-death triggers
 * 5. Crash restore integrity (serialization)
 * 6. Infinite loop prevention
 * 7. runAtomic compatibility (deterministic, synchronous)
 */

'use strict';

// ─── Schema Validation Tests ─────────────────────────────────────────────────

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
  MAX_ABILITIES_PER_ROLE,
  MAX_EVENT_DEPTH,
} = require('../../game/abilities/abilitySchema');

describe('abilitySchema', () => {
  describe('validateAbility', () => {
    const validAbility = {
      id: 'test_protect',
      type: 'night_target',
      trigger: 'night_action',
      phase: 'night',
      target: 'alive_other',
      effect: 'protect',
      charges: null,
      cooldown: null,
      parameters: {},
    };

    test('accepts a valid ability', () => {
      const result = validateAbility(validAbility);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('rejects null input', () => {
      const result = validateAbility(null);
      expect(result.valid).toBe(false);
    });

    test('rejects invalid ability type', () => {
      const result = validateAbility({ ...validAbility, type: 'invalid_type' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid ability type'))).toBe(true);
    });

    test('rejects invalid effect', () => {
      const result = validateAbility({ ...validAbility, effect: 'nuke_everything' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid effect'))).toBe(true);
    });

    test('rejects invalid trigger', () => {
      const result = validateAbility({ ...validAbility, trigger: 'on_full_moon' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid trigger'))).toBe(true);
    });

    test('rejects charges out of range', () => {
      const result = validateAbility({ ...validAbility, charges: 0 });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Charges'))).toBe(true);
    });

    test('rejects cooldown out of range', () => {
      const result = validateAbility({ ...validAbility, cooldown: 100 });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Cooldown'))).toBe(true);
    });

    test('rejects non-alphanumeric id', () => {
      const result = validateAbility({ ...validAbility, id: 'INVALID-ID' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('lowercase alphanumeric'))).toBe(true);
    });

    test('enforces night_target must have night_action trigger', () => {
      const result = validateAbility({ ...validAbility, type: 'night_target', trigger: 'vote_cast' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('night_target abilities must have trigger'))).toBe(true);
    });

    test('enforces on_death must have player_death trigger', () => {
      const result = validateAbility({ ...validAbility, type: 'on_death', trigger: 'night_action' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('on_death abilities must have trigger'))).toBe(true);
    });

    test('rejects unknown parameters', () => {
      const result = validateAbility({
        ...validAbility,
        parameters: { unknownParam: 'hacked' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Unknown parameter'))).toBe(true);
    });

    test('validates modify_vote_weight requires weight parameter', () => {
      const result = validateAbility({
        ...validAbility,
        effect: 'modify_vote_weight',
        parameters: {},
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Missing required parameter 'weight'"))).toBe(true);
    });

    test('validates win_override requires condition parameter', () => {
      const result = validateAbility({
        ...validAbility,
        type: 'passive',
        trigger: 'phase_start',
        effect: 'win_override',
        parameters: {},
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Missing required parameter 'condition'"))).toBe(true);
    });
  });

  describe('validateRoleDefinition', () => {
    const validRole = {
      name: 'Test Guardian',
      camp: 'village',
      winCondition: 'village_wins',
      abilities: [
        {
          id: 'guard_protect',
          type: 'night_target',
          trigger: 'night_action',
          phase: 'night',
          target: 'alive_other',
          effect: 'protect',
          charges: null,
          cooldown: null,
          parameters: {},
        },
      ],
    };

    test('accepts a valid role', () => {
      const result = validateRoleDefinition(validRole);
      expect(result.valid).toBe(true);
    });

    test('rejects null input', () => {
      const result = validateRoleDefinition(null);
      expect(result.valid).toBe(false);
    });

    test('rejects invalid camp', () => {
      const result = validateRoleDefinition({ ...validRole, camp: 'neutral' });
      expect(result.valid).toBe(false);
    });

    test('rejects village camp with wolves_win condition', () => {
      const result = validateRoleDefinition({ ...validRole, camp: 'village', winCondition: 'wolves_win' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Village camp cannot have wolves_win'))).toBe(true);
    });

    test('rejects wolves camp with village_wins condition', () => {
      const result = validateRoleDefinition({ ...validRole, camp: 'wolves', winCondition: 'village_wins' });
      expect(result.valid).toBe(false);
    });

    test('rejects duplicate ability ids', () => {
      const result = validateRoleDefinition({
        ...validRole,
        abilities: [
          { ...validRole.abilities[0], id: 'dupe' },
          { ...validRole.abilities[0], id: 'dupe' },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Duplicate ability id'))).toBe(true);
    });

    test('rejects too many abilities', () => {
      const abilities = [];
      for (let i = 0; i < MAX_ABILITIES_PER_ROLE + 1; i++) {
        abilities.push({ ...validRole.abilities[0], id: `ability_${i}` });
      }
      const result = validateRoleDefinition({ ...validRole, abilities });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Maximum'))).toBe(true);
    });

    test('rejects forbidden ability combos (kill + immune_to_kill)', () => {
      const result = validateRoleDefinition({
        ...validRole,
        abilities: [
          { ...validRole.abilities[0], id: 'a1', effect: 'kill' },
          {
            ...validRole.abilities[0],
            id: 'a2',
            type: 'passive',
            trigger: 'player_targeted',
            effect: 'immune_to_kill',
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Forbidden ability combination'))).toBe(true);
    });
  });

  describe('normalizeAbility', () => {
    test('fills defaults', () => {
      const normalized = normalizeAbility({
        id: 'test',
        type: 'night_target',
        trigger: 'night_action',
        effect: 'protect',
      });
      expect(normalized.phase).toBeNull();
      expect(normalized.target).toBeNull();
      expect(normalized.charges).toBeNull();
      expect(normalized.cooldown).toBeNull();
      expect(normalized.priority).toBe(30); // protect priority
      expect(normalized.parameters).toEqual({});
    });
  });

  describe('normalizeRoleDefinition', () => {
    test('trims name and normalizes abilities', () => {
      const normalized = normalizeRoleDefinition({
        name: '  Test Role  ',
        camp: 'village',
        winCondition: 'village_wins',
        abilities: [
          {
            id: 'a1',
            type: 'night_target',
            trigger: 'night_action',
            effect: 'protect',
          },
        ],
      });
      expect(normalized.name).toBe('Test Role');
      expect(normalized.abilities[0].priority).toBe(30);
    });
  });
});

// ─── Effect Handlers Tests ───────────────────────────────────────────────────

const { handlers, getHandler, getPlayerAlignment } = require('../../game/abilities/effectHandlers');

describe('effectHandlers', () => {
  function makeContext(overrides = {}) {
    return {
      game: {
        players: [
          { id: 'p1', username: 'Alice', role: 'Villageois', alive: true },
          { id: 'p2', username: 'Bob', role: 'Loup-Garou', alive: true },
          { id: 'p3', username: 'Charlie', role: 'Chasseur', alive: true },
        ],
        mainChannelId: 'ch1',
      },
      source: { id: 'p1', username: 'Alice', role: 'Villageois', alive: true },
      target: { id: 'p2', username: 'Bob', role: 'Loup-Garou', alive: true },
      ability: { id: 'test', effect: 'protect', parameters: {} },
      parameters: {},
      cycleState: {
        protections: [],
        pendingKills: [],
        immunities: [],
        redirects: [],
        blocked: [],
        silenced: [],
        reveals: [],
        voteModifiers: [],
        winOverrides: [],
      },
      logAction: jest.fn(),
      ...overrides,
    };
  }

  test('getHandler returns handler for valid effect', () => {
    expect(typeof getHandler('protect')).toBe('function');
    expect(typeof getHandler('kill')).toBe('function');
  });

  test('getHandler returns null for unknown effect', () => {
    expect(getHandler('nonexistent')).toBeNull();
  });

  describe('protect', () => {
    test('adds protection to cycle state', () => {
      const ctx = makeContext();
      const result = handlers.protect(ctx);
      expect(result.applied).toBe(true);
      expect(ctx.cycleState.protections).toHaveLength(1);
      expect(ctx.cycleState.protections[0].targetId).toBe('p2');
    });

    test('fails without target', () => {
      const ctx = makeContext({ target: null });
      const result = handlers.protect(ctx);
      expect(result.applied).toBe(false);
    });
  });

  describe('kill', () => {
    test('queues kill in cycle state', () => {
      const ctx = makeContext({ ability: { id: 'test', effect: 'kill' }, parameters: {} });
      const result = handlers.kill(ctx);
      expect(result.applied).toBe(true);
      expect(ctx.cycleState.pendingKills).toHaveLength(1);
    });

    test('blocked by protection', () => {
      const ctx = makeContext({ ability: { id: 'test', effect: 'kill' }, parameters: {} });
      ctx.cycleState.protections = [{ sourceId: 'p3', targetId: 'p2', abilityId: 'salvateur_protect' }];
      const result = handlers.kill(ctx);
      expect(result.applied).toBe(false);
      expect(result.data.blocked).toBe(true);
      expect(result.data.reason).toBe('protected');
    });

    test('blocked by immunity', () => {
      const ctx = makeContext({ ability: { id: 'test', effect: 'kill' }, parameters: {} });
      ctx.cycleState.immunities = [{ targetId: 'p2', maxUses: 1 }];
      const result = handlers.kill(ctx);
      expect(result.applied).toBe(false);
      expect(result.data.reason).toBe('immune');
    });

    test('bypass protection with parameter', () => {
      const ctx = makeContext({
        ability: { id: 'test', effect: 'kill' },
        parameters: { bypassProtection: true },
      });
      ctx.cycleState.protections = [{ sourceId: 'p3', targetId: 'p2', abilityId: 'prot' }];
      const result = handlers.kill(ctx);
      expect(result.applied).toBe(true);
    });

    test('fails on dead target', () => {
      const ctx = makeContext({
        target: { id: 'p2', username: 'Bob', alive: false },
        ability: { id: 'test', effect: 'kill' },
        parameters: {},
      });
      const result = handlers.kill(ctx);
      expect(result.applied).toBe(false);
    });

    test('follows redirect', () => {
      const ctx = makeContext({ ability: { id: 'test', effect: 'kill' }, parameters: {} });
      ctx.cycleState.redirects = [{ originalTargetId: 'p2', newTargetId: 'p3', sourceId: 'p2' }];
      const result = handlers.kill(ctx);
      expect(result.applied).toBe(true);
      expect(result.data.redirected).toBe(true);
      expect(result.data.newTargetId).toBe('p3');
    });
  });

  describe('inspect_alignment', () => {
    test('returns village for villager', () => {
      const ctx = makeContext();
      ctx.target = { id: 'p1', username: 'Alice', role: 'Villageois', alive: true };
      const result = handlers.inspect_alignment(ctx);
      expect(result.applied).toBe(true);
      expect(result.data.alignment).toBe('village');
    });

    test('returns wolves for werewolf', () => {
      const ctx = makeContext();
      const result = handlers.inspect_alignment(ctx);
      expect(result.applied).toBe(true);
      expect(result.data.alignment).toBe('wolves');
    });
  });

  describe('inspect_role', () => {
    test('returns exact role', () => {
      const ctx = makeContext();
      const result = handlers.inspect_role(ctx);
      expect(result.applied).toBe(true);
      expect(result.data.role).toBe('Loup-Garou');
    });
  });

  describe('double_vote', () => {
    test('adds vote modifier', () => {
      const ctx = makeContext();
      const result = handlers.double_vote(ctx);
      expect(result.applied).toBe(true);
      expect(ctx.cycleState.voteModifiers).toHaveLength(1);
      expect(ctx.cycleState.voteModifiers[0].weight).toBe(2);
    });
  });

  describe('silence', () => {
    test('adds silence to cycle state', () => {
      const ctx = makeContext();
      const result = handlers.silence(ctx);
      expect(result.applied).toBe(true);
      expect(ctx.cycleState.silenced).toHaveLength(1);
    });
  });

  describe('block', () => {
    test('adds block to cycle state', () => {
      const ctx = makeContext();
      const result = handlers.block(ctx);
      expect(result.applied).toBe(true);
      expect(ctx.cycleState.blocked).toHaveLength(1);
    });
  });

  describe('redirect', () => {
    test('adds redirect to cycle state', () => {
      const ctx = makeContext();
      const result = handlers.redirect(ctx);
      expect(result.applied).toBe(true);
      expect(ctx.cycleState.redirects).toHaveLength(1);
    });
  });

  describe('swap_roles', () => {
    test('swaps roles between players', () => {
      const ctx = makeContext();
      const result = handlers.swap_roles(ctx);
      expect(result.applied).toBe(true);
      // Alice was Villageois, Bob was Loup-Garou
      const alice = ctx.game.players.find(p => p.id === 'p1');
      const bob = ctx.game.players.find(p => p.id === 'p2');
      expect(alice.role).toBe('Loup-Garou');
      expect(bob.role).toBe('Villageois');
    });
  });

  describe('immune_to_kill', () => {
    test('adds immunity to cycle state', () => {
      const ctx = makeContext();
      const result = handlers.immune_to_kill(ctx);
      expect(result.applied).toBe(true);
      expect(ctx.cycleState.immunities).toHaveLength(1);
    });
  });

  describe('win_override', () => {
    test('adds win override to cycle state', () => {
      const ctx = makeContext({ parameters: { condition: 'solo_survive' } });
      const result = handlers.win_override(ctx);
      expect(result.applied).toBe(true);
      expect(ctx.cycleState.winOverrides).toHaveLength(1);
    });
  });

  describe('getPlayerAlignment', () => {
    test('returns wolves for werewolf', () => {
      const game = { players: [] };
      const result = getPlayerAlignment(game, { role: 'Loup-Garou' });
      expect(result).toBe('wolves');
    });

    test('returns village for villager', () => {
      const game = { players: [] };
      const result = getPlayerAlignment(game, { role: 'Villageois' });
      expect(result).toBe('village');
    });

    test('returns custom camp from _customRole', () => {
      const game = { players: [] };
      const result = getPlayerAlignment(game, {
        role: 'CustomRole',
        _customRole: { camp: 'solo' },
      });
      expect(result).toBe('solo');
    });
  });
});

// ─── Conflict Resolver Tests ─────────────────────────────────────────────────

const { resolveConflicts, applyKills } = require('../../game/abilities/conflictResolver');

describe('conflictResolver', () => {
  function makeCycleState(overrides = {}) {
    return {
      protections: [],
      pendingKills: [],
      immunities: [],
      redirects: [],
      blocked: [],
      silenced: [],
      reveals: [],
      voteModifiers: [],
      winOverrides: [],
      ...overrides,
    };
  }

  const game = {
    players: [
      { id: 'p1', username: 'Alice', alive: true },
      { id: 'p2', username: 'Bob', alive: true },
      { id: 'p3', username: 'Charlie', alive: true },
    ],
    mainChannelId: 'ch1',
  };

  describe('protect vs kill resolution', () => {
    test('protection prevents kill', () => {
      const cycle = makeCycleState({
        protections: [{ sourceId: 'p3', targetId: 'p1', abilityId: 'prot' }],
        pendingKills: [{ targetId: 'p1', sourceId: 'p2', abilityId: 'kill1', reason: 'ability' }],
      });

      const result = resolveConflicts(cycle, game);
      expect(result.confirmedKills).toHaveLength(0);
      expect(result.cycleState.survivedKills).toHaveLength(1);
    });

    test('immunity prevents kill', () => {
      const cycle = makeCycleState({
        immunities: [{ targetId: 'p1', maxUses: 1 }],
        pendingKills: [{ targetId: 'p1', sourceId: 'p2', abilityId: 'kill1', reason: 'ability' }],
      });

      const result = resolveConflicts(cycle, game);
      expect(result.confirmedKills).toHaveLength(0);
    });

    test('unprotected kill goes through', () => {
      const cycle = makeCycleState({
        pendingKills: [{ targetId: 'p1', sourceId: 'p2', abilityId: 'kill1', reason: 'ability' }],
      });

      const result = resolveConflicts(cycle, game);
      expect(result.confirmedKills).toHaveLength(1);
      expect(result.confirmedKills[0].targetId).toBe('p1');
    });
  });

  describe('block resolution', () => {
    test('blocked source has kills removed', () => {
      const cycle = makeCycleState({
        blocked: [{ targetId: 'p2', sourceId: 'p3', duration: 1 }],
        pendingKills: [{ targetId: 'p1', sourceId: 'p2', abilityId: 'kill1' }],
      });

      const result = resolveConflicts(cycle, game);
      expect(result.confirmedKills).toHaveLength(0);
    });

    test('blocked source has protections removed', () => {
      const cycle = makeCycleState({
        blocked: [{ targetId: 'p3', sourceId: 'p1', duration: 1 }],
        protections: [{ sourceId: 'p3', targetId: 'p1', abilityId: 'prot' }],
        pendingKills: [{ targetId: 'p1', sourceId: 'p2', abilityId: 'kill1' }],
      });

      const result = resolveConflicts(cycle, game);
      // P3's protection was blocked, so P1's kill should go through
      expect(result.confirmedKills).toHaveLength(1);
    });
  });

  describe('redirect resolution', () => {
    test('kill is redirected to new target', () => {
      const cycle = makeCycleState({
        redirects: [{ originalTargetId: 'p1', newTargetId: 'p3', sourceId: 'p1' }],
        pendingKills: [{ targetId: 'p1', sourceId: 'p2', abilityId: 'kill1' }],
      });

      const result = resolveConflicts(cycle, game);
      expect(result.confirmedKills).toHaveLength(1);
      expect(result.confirmedKills[0].targetId).toBe('p3');
      expect(result.confirmedKills[0].redirected).toBe(true);
    });

    test('redirect to dead player is removed', () => {
      const gameWithDead = {
        players: [
          { id: 'p1', alive: true },
          { id: 'p2', alive: true },
          { id: 'p3', alive: false }, // dead
        ],
      };

      const cycle = makeCycleState({
        redirects: [{ originalTargetId: 'p1', newTargetId: 'p3', sourceId: 'p1' }],
        pendingKills: [{ targetId: 'p1', sourceId: 'p2', abilityId: 'kill1' }],
      });

      const result = resolveConflicts(cycle, gameWithDead);
      // Redirect was removed (target dead), kill hits original target
      expect(result.confirmedKills).toHaveLength(1);
      expect(result.confirmedKills[0].targetId).toBe('p1');
    });
  });

  describe('deduplication', () => {
    test('same player cannot be killed twice', () => {
      const cycle = makeCycleState({
        pendingKills: [
          { targetId: 'p1', sourceId: 'p2', abilityId: 'kill1' },
          { targetId: 'p1', sourceId: 'p3', abilityId: 'kill2' },
        ],
      });

      const result = resolveConflicts(cycle, game);
      expect(result.confirmedKills).toHaveLength(1);
    });

    test('silence is deduplicated per target', () => {
      const cycle = makeCycleState({
        silenced: [
          { targetId: 'p1', sourceId: 'p2', duration: 1 },
          { targetId: 'p1', sourceId: 'p3', duration: 2 },
        ],
      });

      const result = resolveConflicts(cycle, game);
      expect(result.cycleState.silenced).toHaveLength(1);
    });

    test('vote modifiers last-wins per player', () => {
      const cycle = makeCycleState({
        voteModifiers: [
          { playerId: 'p1', weight: 2, reason: 'double_vote' },
          { playerId: 'p1', weight: 3, reason: 'modify_vote_weight' },
        ],
      });

      const result = resolveConflicts(cycle, game);
      expect(result.cycleState.voteModifiers).toHaveLength(1);
      expect(result.cycleState.voteModifiers[0].weight).toBe(3);
    });
  });

  describe('applyKills', () => {
    test('marks player as dead via killFn', () => {
      const mockKillFn = jest.fn().mockReturnValue([]);
      const kills = [{ targetId: 'p1', sourceId: 'p2', abilityId: 'kill1' }];
      const testGame = {
        players: [
          { id: 'p1', username: 'Alice', alive: true },
          { id: 'p2', username: 'Bob', alive: true },
        ],
        mainChannelId: 'ch1',
      };

      const deaths = applyKills(kills, testGame, mockKillFn);
      expect(mockKillFn).toHaveBeenCalledWith('ch1', 'p1', { throwOnDbFailure: true });
      expect(deaths).toHaveLength(1);
    });

    test('skips already dead players', () => {
      const mockKillFn = jest.fn().mockReturnValue([]);
      const kills = [{ targetId: 'p1', sourceId: 'p2', abilityId: 'kill1' }];
      const testGame = {
        players: [{ id: 'p1', username: 'Alice', alive: false }],
        mainChannelId: 'ch1',
      };

      const deaths = applyKills(kills, testGame, mockKillFn);
      expect(mockKillFn).not.toHaveBeenCalled();
      expect(deaths).toHaveLength(0);
    });
  });
});

// ─── Event Engine Tests ──────────────────────────────────────────────────────

const {
  dispatch,
  EVENTS,
  getAbilityState,
  resetCycleState,
  collectMatchingAbilities,
  sortByPriority,
  serializeAbilityState,
  restoreAbilityState,
} = require('../../game/abilities/gameEventEngine');

describe('gameEventEngine', () => {
  function makeGame(customPlayers = []) {
    return {
      phase: 'Nuit',
      dayCount: 1,
      players: customPlayers.length > 0 ? customPlayers : [
        {
          id: 'p1', username: 'Alice', role: 'CustomGuard', alive: true,
          _customRole: {
            name: 'CustomGuard',
            camp: 'village',
            winCondition: 'village_wins',
            abilities: [
              {
                id: 'guard_protect',
                type: 'night_target',
                trigger: 'night_action',
                phase: 'night',
                target: 'alive_other',
                effect: 'protect',
                charges: null,
                cooldown: null,
                priority: 30,
                parameters: {},
              },
            ],
          },
        },
        {
          id: 'p2', username: 'Bob', role: 'CustomKiller', alive: true,
          _customRole: {
            name: 'CustomKiller',
            camp: 'wolves',
            winCondition: 'wolves_win',
            abilities: [
              {
                id: 'killer_strike',
                type: 'night_target',
                trigger: 'night_action',
                phase: 'night',
                target: 'alive_other',
                effect: 'kill',
                charges: null,
                cooldown: null,
                priority: 40,
                parameters: {},
              },
            ],
          },
        },
        { id: 'p3', username: 'Charlie', role: 'Villageois', alive: true },
      ],
      mainChannelId: 'ch1',
    };
  }

  describe('collectMatchingAbilities', () => {
    test('collects abilities matching trigger', () => {
      const game = makeGame();
      const matches = collectMatchingAbilities(game, 'night_action');
      expect(matches).toHaveLength(2);
    });

    test('skips dead players', () => {
      const game = makeGame();
      game.players[0].alive = false;
      const matches = collectMatchingAbilities(game, 'night_action');
      expect(matches).toHaveLength(1);
      expect(matches[0].player.id).toBe('p2');
    });

    test('skips players without custom roles', () => {
      const game = makeGame();
      const matches = collectMatchingAbilities(game, 'night_action');
      // p3 has no _customRole
      const playerIds = matches.map(m => m.player.id);
      expect(playerIds).not.toContain('p3');
    });

    test('respects charges limit', () => {
      const game = makeGame();
      const state = getAbilityState(game);
      state.chargesUsed['p1:guard_protect'] = 999;
      game.players[0]._customRole.abilities = [
        { ...game.players[0]._customRole.abilities[0], charges: 1 },
      ];
      const matches = collectMatchingAbilities(game, 'night_action');
      expect(matches).toHaveLength(1); // Only p2's ability
    });

    test('respects cooldown', () => {
      const game = makeGame();
      game.dayCount = 3;
      game.players[0]._customRole.abilities = [
        { ...game.players[0]._customRole.abilities[0], cooldown: 2 },
      ];
      const state = getAbilityState(game);
      state.lastUsedTurn['p1:guard_protect'] = 2; // Used on turn 2, cooldown 2
      const matches = collectMatchingAbilities(game, 'night_action');
      expect(matches).toHaveLength(1); // Only p2's
    });

    test('prevents same ability executing twice in cycle', () => {
      const game = makeGame();
      const state = getAbilityState(game);
      state.executedThisCycle = ['p1:guard_protect'];
      const matches = collectMatchingAbilities(game, 'night_action');
      expect(matches).toHaveLength(1);
    });
  });

  describe('sortByPriority', () => {
    test('sorts by priority ascending', () => {
      const game = makeGame();
      const abilities = [
        { player: game.players[1], ability: { priority: 40, effect: 'kill' } },
        { player: game.players[0], ability: { priority: 30, effect: 'protect' } },
      ];
      const sorted = sortByPriority(game, abilities);
      expect(sorted[0].ability.priority).toBe(30);
      expect(sorted[1].ability.priority).toBe(40);
    });

    test('breaks ties by player join order', () => {
      const game = makeGame();
      const abilities = [
        { player: game.players[1], ability: { priority: 50, effect: 'kill' } },
        { player: game.players[0], ability: { priority: 50, effect: 'protect' } },
      ];
      const sorted = sortByPriority(game, abilities);
      expect(sorted[0].player.id).toBe('p1'); // Earlier in array
    });
  });

  describe('dispatch', () => {
    test('returns results for matching abilities', () => {
      const game = makeGame();
      const { results } = dispatch(EVENTS.NIGHT_ACTION, { game, target: game.players[2] });
      expect(results.length).toBeGreaterThan(0);
    });

    test('returns empty for non-matching events', () => {
      const game = makeGame();
      const { results } = dispatch(EVENTS.VOTE_CAST, { game });
      expect(results).toHaveLength(0);
    });

    test('rejects unknown events', () => {
      const game = makeGame();
      const { results } = dispatch('unknown_event', { game });
      expect(results).toHaveLength(0);
    });

    test('prevents infinite recursion', () => {
      // Create a recursive scenario: on_death triggers another death
      const game = makeGame([
        {
          id: 'p1', username: 'Alice', role: 'Living Bomb', alive: true,
          _customRole: {
            name: 'Living Bomb',
            camp: 'village',
            winCondition: 'village_wins',
            abilities: [
              {
                id: 'bomb_explode',
                type: 'on_death',
                trigger: 'player_death',
                phase: null,
                target: 'alive_other',
                effect: 'kill',
                charges: null,
                cooldown: null,
                priority: 40,
                parameters: {},
              },
            ],
          },
        },
        { id: 'p2', username: 'Bob', role: 'Villageois', alive: true },
      ]);

      // Dispatch AT max depth — should be stopped
      const { results: atMax } = dispatch(EVENTS.PLAYER_DEATH, {
        game,
        source: game.players[0],
        target: game.players[0],
        depth: MAX_EVENT_DEPTH,
      });
      expect(atMax).toHaveLength(0); // Max depth reached, no execution

      // Dispatch at depth - 1 executes but recursive child is stopped
      resetCycleState(game);
      const { results: atPenultimate } = dispatch(EVENTS.PLAYER_DEATH, {
        game,
        source: game.players[0],
        target: game.players[0],
        depth: MAX_EVENT_DEPTH - 1,
      });
      // It executes the bomb effect at this level (length >= 1)
      // but does NOT recurse infinitely
      expect(atPenultimate.length).toBeGreaterThanOrEqual(1);
      expect(atPenultimate.length).toBeLessThanOrEqual(5); // bounded
    });

    test('tracks charges after execution', () => {
      const game = makeGame();
      game.players[0]._customRole.abilities = [
        { ...game.players[0]._customRole.abilities[0], charges: 3 },
      ];

      dispatch(EVENTS.NIGHT_ACTION, { game, target: game.players[2] });

      const state = getAbilityState(game);
      expect(state.chargesUsed['p1:guard_protect']).toBe(1);
    });

    test('tracks cooldown after execution', () => {
      const game = makeGame();
      game.dayCount = 5;
      game.players[0]._customRole.abilities = [
        { ...game.players[0]._customRole.abilities[0], cooldown: 2 },
      ];

      dispatch(EVENTS.NIGHT_ACTION, { game, target: game.players[2] });

      const state = getAbilityState(game);
      expect(state.lastUsedTurn['p1:guard_protect']).toBe(5);
    });
  });

  describe('serialization (crash recovery)', () => {
    test('serializeAbilityState produces valid JSON', () => {
      const game = makeGame();
      const state = getAbilityState(game);
      state.chargesUsed['p1:guard_protect'] = 2;
      state.lastUsedTurn['p1:guard_protect'] = 3;

      const json = serializeAbilityState(game);
      const parsed = JSON.parse(json);
      expect(parsed.chargesUsed['p1:guard_protect']).toBe(2);
      expect(parsed.lastUsedTurn['p1:guard_protect']).toBe(3);
    });

    test('restoreAbilityState from valid JSON', () => {
      const game = { _abilityState: null };
      restoreAbilityState(game, '{"chargesUsed":{"p1:test":1},"lastUsedTurn":{"p1:test":5}}');
      expect(game._abilityState.chargesUsed['p1:test']).toBe(1);
      expect(game._abilityState.lastUsedTurn['p1:test']).toBe(5);
      expect(game._abilityState.executedThisCycle).toEqual([]);
    });

    test('restoreAbilityState handles invalid JSON', () => {
      const game = { _abilityState: null };
      restoreAbilityState(game, 'not-json');
      expect(game._abilityState.chargesUsed).toEqual({});
      expect(game._abilityState.lastUsedTurn).toEqual({});
    });

    test('restoreAbilityState handles null', () => {
      const game = { _abilityState: null };
      restoreAbilityState(game, null);
      expect(game._abilityState.chargesUsed).toEqual({});
    });

    test('round-trip serialize/restore preserves state', () => {
      const game = makeGame();
      const state = getAbilityState(game);
      state.chargesUsed = { 'p1:guard_protect': 2, 'p2:killer_strike': 1 };
      state.lastUsedTurn = { 'p1:guard_protect': 3 };
      state.executedThisCycle = ['p1:guard_protect']; // Should NOT persist

      const json = serializeAbilityState(game);
      const game2 = {};
      restoreAbilityState(game2, json);

      expect(game2._abilityState.chargesUsed).toEqual(state.chargesUsed);
      expect(game2._abilityState.lastUsedTurn).toEqual(state.lastUsedTurn);
      expect(game2._abilityState.executedThisCycle).toEqual([]); // Reset
    });
  });

  describe('resetCycleState', () => {
    test('clears executedThisCycle', () => {
      const game = makeGame();
      const state = getAbilityState(game);
      state.executedThisCycle = ['p1:guard_protect'];
      resetCycleState(game);
      expect(game._abilityState.executedThisCycle).toEqual([]);
    });
  });
});

// ─── Built-in Role Definitions Tests ─────────────────────────────────────────

const {
  BUILTIN_ROLE_DEFINITIONS,
  getBuiltinDefinition,
  hasBuiltinDefinition,
  HUNTER_DEFINITION,
  SALVATEUR_DEFINITION,
} = require('../../game/abilities/builtinRoles');

describe('builtinRoles', () => {
  test('HUNTER_DEFINITION is correctly structured', () => {
    expect(HUNTER_DEFINITION.name).toBe('Chasseur');
    expect(HUNTER_DEFINITION.camp).toBe('village');
    expect(HUNTER_DEFINITION.abilities).toHaveLength(1);
    expect(HUNTER_DEFINITION.abilities[0].id).toBe('hunter_shoot');
    expect(HUNTER_DEFINITION.abilities[0].type).toBe('on_death');
    expect(HUNTER_DEFINITION.abilities[0].trigger).toBe('player_death');
    expect(HUNTER_DEFINITION.abilities[0].effect).toBe('kill');
    expect(HUNTER_DEFINITION.abilities[0].charges).toBe(1);
  });

  test('SALVATEUR_DEFINITION is correctly structured', () => {
    expect(SALVATEUR_DEFINITION.name).toBe('Salvateur');
    expect(SALVATEUR_DEFINITION.camp).toBe('village');
    expect(SALVATEUR_DEFINITION.abilities).toHaveLength(1);
    expect(SALVATEUR_DEFINITION.abilities[0].id).toBe('salvateur_protect');
    expect(SALVATEUR_DEFINITION.abilities[0].type).toBe('night_target');
    expect(SALVATEUR_DEFINITION.abilities[0].trigger).toBe('night_action');
    expect(SALVATEUR_DEFINITION.abilities[0].effect).toBe('protect');
    expect(SALVATEUR_DEFINITION.abilities[0].charges).toBeNull();
  });

  test('getBuiltinDefinition returns correct definition', () => {
    expect(getBuiltinDefinition('Chasseur')).toBe(HUNTER_DEFINITION);
  });

  test('getBuiltinDefinition returns null for unknown role', () => {
    expect(getBuiltinDefinition('Ninja')).toBeNull();
  });

  test('hasBuiltinDefinition works correctly', () => {
    expect(hasBuiltinDefinition('Chasseur')).toBe(true);
    expect(hasBuiltinDefinition('Salvateur')).toBe(true);
    expect(hasBuiltinDefinition('Ninja')).toBe(false);
  });

  test('all builtin definitions pass schema validation', () => {
    for (const [roleName, def] of Object.entries(BUILTIN_ROLE_DEFINITIONS)) {
      const result = validateRoleDefinition(def);
      expect(result.valid).toBe(true);
    }
  });
});

// ─── Performance (structural) ────────────────────────────────────────────────

describe('performance guarantees', () => {
  test('no eval or Function constructor in handlers', () => {
    const handlersModule = require('../../game/abilities/effectHandlers');
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '../../game/abilities/effectHandlers.js'),
      'utf8'
    );
    expect(source).not.toContain('eval(');
    expect(source).not.toContain('new Function(');
    expect(source).not.toContain('setTimeout');
    expect(source).not.toContain('setInterval');
  });

  test('no eval or Function constructor in engine', () => {
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '../../game/abilities/gameEventEngine.js'),
      'utf8'
    );
    expect(source).not.toContain('eval(');
    expect(source).not.toContain('new Function(');
  });

  test('dispatch is synchronous (returns object, not promise)', () => {
    const game = {
      phase: 'Nuit',
      dayCount: 1,
      players: [{ id: 'p1', alive: true, role: 'V' }],
      mainChannelId: 'ch1',
    };
    const result = dispatch(EVENTS.NIGHT_ACTION, { game });
    expect(result).toBeDefined();
    expect(typeof result.then).not.toBe('function'); // Not a promise
    expect(result).toHaveProperty('results');
    expect(result).toHaveProperty('cycleState');
  });

  test('ability evaluation is O(n) in player count', () => {
    // Create a game with many players, each with abilities
    const players = [];
    for (let i = 0; i < 100; i++) {
      players.push({
        id: `p${i}`,
        username: `Player${i}`,
        role: 'CustomGuard',
        alive: true,
        _customRole: {
          name: 'CustomGuard',
          camp: 'village',
          winCondition: 'village_wins',
          abilities: [{
            id: 'guard_protect',
            type: 'night_target',
            trigger: 'night_action',
            phase: 'night',
            target: 'alive_other',
            effect: 'protect',
            charges: null,
            cooldown: null,
            priority: 30,
            parameters: {},
          }],
        },
      });
    }

    const game = { phase: 'Nuit', dayCount: 1, players, mainChannelId: 'ch1' };
    const start = Date.now();
    const matches = collectMatchingAbilities(game, 'night_action');
    const elapsed = Date.now() - start;

    expect(matches).toHaveLength(100);
    expect(elapsed).toBeLessThan(100); // Should be well under 100ms
  });
});
