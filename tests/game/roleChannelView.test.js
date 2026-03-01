/**
 * Tests for game/roleChannelView.js — Persistent role channel GUI panels.
 *
 * Validates:
 * - Each of the 7 role panel builders (wolves, seer, witch, cupid, salvateur, white_wolf, thief)
 * - Phase/subPhase field presence
 * - Timer display / absence
 * - Context logic ("your turn" vs "waiting for" vs "day rest" vs "game ended")
 * - Witch: potion status, victim display
 * - Cupid: lovers display, done state
 * - Salvateur: last protected
 * - White Wolf: odd/even night info
 * - Thief: cards display, must-take warning, done state
 * - Helpers: isRoleTurn, buildContextField, getRoleChannels, ROLE_CHANNEL_MAP
 */

const PHASES = require('../../game/phases');
const ROLES = require('../../game/roles');

jest.mock('../../utils/i18n', () => ({
  t: (key, params = {}) => {
    let str = key;
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(`{{${k}}}`, v);
    }
    return str;
  },
  translatePhase: (p) => p,
  translateRole: (r) => r,
}));

jest.mock('../../utils/theme', () => ({
  getColor: () => 0x5865F2,
}));

const {
  ROLE_CHANNEL_MAP,
  getRoleChannels,
  buildRolePanel,
  buildWolvesPanel,
  buildSeerPanel,
  buildWitchPanel,
  buildCupidPanel,
  buildSalvateurPanel,
  buildWhiteWolfPanel,
  buildThiefPanel,
  PANEL_BUILDERS,
  isRoleTurn,
  buildContextField,
} = require('../../game/roleChannelView');

// ─── Helpers ──────────────────────────────────────────────────────

function createTestGame(overrides = {}) {
  return {
    mainChannelId: 'ch123',
    guildId: 'g123',
    phase: PHASES.NIGHT,
    subPhase: PHASES.LOUPS,
    dayCount: 1,
    captainId: null,
    players: [
      { id: 'p1', username: 'Alice', role: ROLES.WEREWOLF, alive: true },
      { id: 'p2', username: 'Bob', role: ROLES.SEER, alive: true },
      { id: 'p3', username: 'Carol', role: ROLES.WITCH, alive: true },
      { id: 'p4', username: 'Dave', role: ROLES.VILLAGER, alive: true },
      { id: 'p5', username: 'Eve', role: ROLES.CUPID, alive: true },
      { id: 'p6', username: 'Frank', role: ROLES.SALVATEUR, alive: true },
      { id: 'p7', username: 'Grace', role: ROLES.WHITE_WOLF, alive: true },
      { id: 'p8', username: 'Hank', role: ROLES.THIEF, alive: true },
    ],
    witchPotions: { life: true, death: true },
    nightVictim: null,
    lovers: [],
    lastProtectedPlayerId: null,
    thiefExtraRoles: [],
    wolvesChannelId: 'wc1',
    seerChannelId: 'sc1',
    witchChannelId: 'wtc1',
    cupidChannelId: 'cc1',
    salvateurChannelId: 'slc1',
    whiteWolfChannelId: 'wwc1',
    thiefChannelId: 'tc1',
    ...overrides,
  };
}

const TIMER = { type: 'night-afk:Loups', remainingMs: 60000, totalMs: 120000 };
const NO_TIMER = null;

function getEmbedFields(embed) {
  const json = embed.toJSON();
  return json.fields || [];
}

function getFieldByName(embed, nameIncludes) {
  return getEmbedFields(embed).find(f => f.name.includes(nameIncludes));
}

// ─── ROLE_CHANNEL_MAP & getRoleChannels ───────────────────────────

describe('ROLE_CHANNEL_MAP', () => {
  test('maps all 7 role keys to channelId fields', () => {
    expect(Object.keys(ROLE_CHANNEL_MAP)).toEqual([
      'wolves', 'seer', 'witch', 'cupid', 'salvateur', 'white_wolf', 'thief'
    ]);
  });
});

describe('getRoleChannels', () => {
  test('returns only channels that exist on the game', () => {
    const game = createTestGame({ cupidChannelId: null, thiefChannelId: null });
    const result = getRoleChannels(game);
    expect(result).toHaveProperty('wolves', 'wc1');
    expect(result).toHaveProperty('seer', 'sc1');
    expect(result).not.toHaveProperty('cupid');
    expect(result).not.toHaveProperty('thief');
  });

  test('returns all 7 channels when all are present', () => {
    const game = createTestGame();
    expect(Object.keys(getRoleChannels(game))).toHaveLength(7);
  });
});

// ─── isRoleTurn ───────────────────────────────────────────────────

describe('isRoleTurn', () => {
  test('wolves turn during LOUPS subphase', () => {
    expect(isRoleTurn({ subPhase: PHASES.LOUPS }, 'wolves')).toBe(true);
  });

  test('wolves not turn during VOYANTE subphase', () => {
    expect(isRoleTurn({ subPhase: PHASES.VOYANTE }, 'wolves')).toBe(false);
  });

  test('seer turn during VOYANTE subphase', () => {
    expect(isRoleTurn({ subPhase: PHASES.VOYANTE }, 'seer')).toBe(true);
  });

  test('witch turn during SORCIERE subphase', () => {
    expect(isRoleTurn({ subPhase: PHASES.SORCIERE }, 'witch')).toBe(true);
  });

  test('cupid turn during CUPIDON subphase', () => {
    expect(isRoleTurn({ subPhase: PHASES.CUPIDON }, 'cupid')).toBe(true);
  });

  test('salvateur turn during SALVATEUR subphase', () => {
    expect(isRoleTurn({ subPhase: PHASES.SALVATEUR }, 'salvateur')).toBe(true);
  });

  test('white_wolf turn during LOUP_BLANC subphase', () => {
    expect(isRoleTurn({ subPhase: PHASES.LOUP_BLANC }, 'white_wolf')).toBe(true);
  });

  test('thief turn during VOLEUR subphase', () => {
    expect(isRoleTurn({ subPhase: PHASES.VOLEUR }, 'thief')).toBe(true);
  });
});

// ─── buildContextField ───────────────────────────────────────────

describe('buildContextField', () => {
  test('returns game ended message when game is ENDED', () => {
    const game = createTestGame({ phase: PHASES.ENDED });
    expect(buildContextField(game, 'wolves', 'g1')).toContain('role_panel.game_ended');
  });

  test('returns day rest message when game is DAY', () => {
    const game = createTestGame({ phase: PHASES.DAY, subPhase: PHASES.DELIBERATION });
    expect(buildContextField(game, 'wolves', 'g1')).toContain('role_panel.day_rest');
  });

  test('returns your turn when it is role\'s turn', () => {
    const game = createTestGame({ phase: PHASES.NIGHT, subPhase: PHASES.LOUPS });
    expect(buildContextField(game, 'wolves', 'g1')).toContain('gui.your_turn');
  });

  test('returns waiting for when it is not role\'s turn', () => {
    const game = createTestGame({ phase: PHASES.NIGHT, subPhase: PHASES.VOYANTE });
    const result = buildContextField(game, 'wolves', 'g1');
    expect(result).toContain('gui.waiting_for');
  });
});

// ─── buildRolePanel dispatch ──────────────────────────────────────

describe('buildRolePanel', () => {
  test('returns null for unknown role key', () => {
    expect(buildRolePanel('unknown', createTestGame(), NO_TIMER, 'g1')).toBeNull();
  });

  test('dispatches to each builder', () => {
    const game = createTestGame();
    for (const key of Object.keys(PANEL_BUILDERS)) {
      const embed = buildRolePanel(key, game, TIMER, 'g1');
      expect(embed).not.toBeNull();
      expect(embed.toJSON().title).toBeDefined();
    }
  });
});

// ─── Wolves Panel ─────────────────────────────────────────────────

describe('buildWolvesPanel', () => {
  test('includes pack members field', () => {
    const game = createTestGame();
    const embed = buildWolvesPanel(game, TIMER, 'g1');
    const field = getFieldByName(embed, 'role_panel.pack_members');
    expect(field).toBeDefined();
    expect(field.value).toContain('Alice');
    expect(field.value).toContain('Grace'); // White Wolf is also in the pack
  });

  test('shows phase fields', () => {
    const embed = buildWolvesPanel(createTestGame(), TIMER, 'g1');
    expect(getFieldByName(embed, 'gui.phase')).toBeDefined();
    expect(getFieldByName(embed, 'gui.sub_phase')).toBeDefined();
    expect(getFieldByName(embed, 'gui.day')).toBeDefined();
  });

  test('shows timer when active', () => {
    const embed = buildWolvesPanel(createTestGame(), TIMER, 'g1');
    expect(getFieldByName(embed, 'gui.timer')).toBeDefined();
  });

  test('no timer field when no timer', () => {
    const embed = buildWolvesPanel(createTestGame(), NO_TIMER, 'g1');
    expect(getFieldByName(embed, 'gui.timer')).toBeUndefined();
  });

  test('shows action hint when wolves turn', () => {
    const game = createTestGame({ subPhase: PHASES.LOUPS });
    const embed = buildWolvesPanel(game, NO_TIMER, 'g1');
    const hintField = getEmbedFields(embed).find(f => f.value.includes('role_panel.wolves_action_hint'));
    expect(hintField).toBeDefined();
  });

  test('no action hint when not wolves turn', () => {
    const game = createTestGame({ subPhase: PHASES.VOYANTE });
    const embed = buildWolvesPanel(game, NO_TIMER, 'g1');
    const hintField = getEmbedFields(embed).find(f => f.value && f.value.includes('role_panel.wolves_action_hint'));
    expect(hintField).toBeUndefined();
  });
});

// ─── Seer Panel ───────────────────────────────────────────────────

describe('buildSeerPanel', () => {
  test('shows context field', () => {
    const embed = buildSeerPanel(createTestGame(), NO_TIMER, 'g1');
    expect(getFieldByName(embed, 'gui.context')).toBeDefined();
  });

  test('shows action hint when seer turn', () => {
    const game = createTestGame({ subPhase: PHASES.VOYANTE });
    const embed = buildSeerPanel(game, NO_TIMER, 'g1');
    const hintField = getEmbedFields(embed).find(f => f.value && f.value.includes('role_panel.seer_action_hint'));
    expect(hintField).toBeDefined();
  });

  test('no action hint when not seer turn', () => {
    const game = createTestGame({ subPhase: PHASES.LOUPS });
    const embed = buildSeerPanel(game, NO_TIMER, 'g1');
    const hintField = getEmbedFields(embed).find(f => f.value && f.value.includes('role_panel.seer_action_hint'));
    expect(hintField).toBeUndefined();
  });
});

// ─── Witch Panel ──────────────────────────────────────────────────

describe('buildWitchPanel', () => {
  test('shows potion status', () => {
    const embed = buildWitchPanel(createTestGame(), NO_TIMER, 'g1');
    const field = getFieldByName(embed, 'role_panel.potions');
    expect(field).toBeDefined();
    expect(field.value).toContain('✅');
  });

  test('shows depleted potions', () => {
    const game = createTestGame({ witchPotions: { life: false, death: false } });
    const embed = buildWitchPanel(game, NO_TIMER, 'g1');
    const field = getFieldByName(embed, 'role_panel.potions');
    expect(field.value).toContain('❌');
    expect(field.value).not.toContain('✅');
  });

  test('shows victim during witch turn', () => {
    const game = createTestGame({ subPhase: PHASES.SORCIERE, nightVictim: 'p4' });
    const embed = buildWitchPanel(game, NO_TIMER, 'g1');
    const field = getFieldByName(embed, 'role_panel.wolf_victim');
    expect(field).toBeDefined();
    expect(field.value).toContain('Dave');
  });

  test('does NOT show victim when not witch turn', () => {
    const game = createTestGame({ subPhase: PHASES.LOUPS, nightVictim: 'p4' });
    const embed = buildWitchPanel(game, NO_TIMER, 'g1');
    expect(getFieldByName(embed, 'role_panel.wolf_victim')).toBeUndefined();
  });

  test('no victim field when nightVictim is null', () => {
    const game = createTestGame({ subPhase: PHASES.SORCIERE, nightVictim: null });
    const embed = buildWitchPanel(game, NO_TIMER, 'g1');
    expect(getFieldByName(embed, 'role_panel.wolf_victim')).toBeUndefined();
  });

  test('shows action hint during witch turn', () => {
    const game = createTestGame({ subPhase: PHASES.SORCIERE });
    const embed = buildWitchPanel(game, NO_TIMER, 'g1');
    const hintField = getEmbedFields(embed).find(f => f.value && f.value.includes('role_panel.witch_action_hint'));
    expect(hintField).toBeDefined();
  });
});

// ─── Cupid Panel ──────────────────────────────────────────────────

describe('buildCupidPanel', () => {
  test('shows "your turn" when cupid phase and no lovers', () => {
    const game = createTestGame({ subPhase: PHASES.CUPIDON, lovers: [] });
    const embed = buildCupidPanel(game, NO_TIMER, 'g1');
    const ctx = getFieldByName(embed, 'gui.context');
    expect(ctx.value).toContain('gui.your_turn');
  });

  test('shows "done" when lovers are chosen', () => {
    const game = createTestGame({ subPhase: PHASES.CUPIDON, lovers: [['p1', 'p2']] });
    // lovers.length >= 2 check: lovers is [[p1,p2]] which is length 1
    // The code checks lovers.length >= 2 — let me check...
    // Actually looking at the code: const lovers = game.lovers || []; const loversDone = lovers.length >= 2;
    // game.lovers is [['p1','p2']] — length is 1. But in the actual game state, lovers is stored differently.
    // Let me use flat lovers: ['p1', 'p2']
    const game2 = createTestGame({ subPhase: PHASES.CUPIDON, lovers: ['p1', 'p2'] });
    const embed = buildCupidPanel(game2, NO_TIMER, 'g1');
    const ctx = getFieldByName(embed, 'gui.context');
    expect(ctx.value).toContain('role_panel.cupid_done');
  });

  test('shows lover names when done', () => {
    const game = createTestGame({ subPhase: PHASES.LOUPS, lovers: ['p1', 'p2'] });
    const embed = buildCupidPanel(game, NO_TIMER, 'g1');
    const field = getFieldByName(embed, 'role_panel.lovers');
    expect(field).toBeDefined();
    expect(field.value).toContain('Alice');
    expect(field.value).toContain('Bob');
  });

  test('no lovers field when not yet chosen', () => {
    const game = createTestGame({ subPhase: PHASES.CUPIDON, lovers: [] });
    const embed = buildCupidPanel(game, NO_TIMER, 'g1');
    expect(getFieldByName(embed, 'role_panel.lovers')).toBeUndefined();
  });

  test('shows action hint during cupid turn', () => {
    const game = createTestGame({ subPhase: PHASES.CUPIDON, lovers: [] });
    const embed = buildCupidPanel(game, NO_TIMER, 'g1');
    const hintField = getEmbedFields(embed).find(f => f.value && f.value.includes('role_panel.cupid_action_hint'));
    expect(hintField).toBeDefined();
  });
});

// ─── Salvateur Panel ──────────────────────────────────────────────

describe('buildSalvateurPanel', () => {
  test('shows last protected player', () => {
    const game = createTestGame({ lastProtectedPlayerId: 'p4' });
    const embed = buildSalvateurPanel(game, NO_TIMER, 'g1');
    const field = getFieldByName(embed, 'role_panel.last_protected');
    expect(field).toBeDefined();
    expect(field.value).toContain('Dave');
  });

  test('shows dash when no last protected', () => {
    const game = createTestGame({ lastProtectedPlayerId: null });
    const embed = buildSalvateurPanel(game, NO_TIMER, 'g1');
    const field = getFieldByName(embed, 'role_panel.last_protected');
    expect(field.value).toContain('—');
  });

  test('shows action hint during salvateur turn', () => {
    const game = createTestGame({ subPhase: PHASES.SALVATEUR });
    const embed = buildSalvateurPanel(game, NO_TIMER, 'g1');
    const hintField = getEmbedFields(embed).find(f => f.value && f.value.includes('role_panel.salvateur_action_hint'));
    expect(hintField).toBeDefined();
  });
});

// ─── White Wolf Panel ─────────────────────────────────────────────

describe('buildWhiteWolfPanel', () => {
  test('shows odd night (hunt) when dayCount is odd', () => {
    const game = createTestGame({ dayCount: 1 });
    const embed = buildWhiteWolfPanel(game, NO_TIMER, 'g1');
    const field = getFieldByName(embed, 'role_panel.night_type');
    expect(field).toBeDefined();
    expect(field.value).toContain('role_panel.white_wolf_hunt_night');
  });

  test('shows even night (rest) when dayCount is even', () => {
    const game = createTestGame({ dayCount: 2 });
    const embed = buildWhiteWolfPanel(game, NO_TIMER, 'g1');
    const field = getFieldByName(embed, 'role_panel.night_type');
    expect(field.value).toContain('role_panel.white_wolf_rest_night');
  });

  test('shows action hint during white wolf turn', () => {
    const game = createTestGame({ subPhase: PHASES.LOUP_BLANC });
    const embed = buildWhiteWolfPanel(game, NO_TIMER, 'g1');
    const hintField = getEmbedFields(embed).find(f => f.value && f.value.includes('role_panel.white_wolf_action_hint'));
    expect(hintField).toBeDefined();
  });
});

// ─── Thief Panel ──────────────────────────────────────────────────

describe('buildThiefPanel', () => {
  test('shows available cards', () => {
    const game = createTestGame({ thiefExtraRoles: [ROLES.SEER, ROLES.HUNTER] });
    const embed = buildThiefPanel(game, NO_TIMER, 'g1');
    const field = getFieldByName(embed, 'role_panel.thief_cards');
    expect(field).toBeDefined();
    expect(field.value).toContain(ROLES.SEER);
    expect(field.value).toContain(ROLES.HUNTER);
  });

  test('shows must-take warning when both cards are wolves', () => {
    const game = createTestGame({ thiefExtraRoles: [ROLES.WEREWOLF, ROLES.WHITE_WOLF] });
    const embed = buildThiefPanel(game, NO_TIMER, 'g1');
    const warning = getEmbedFields(embed).find(f => f.name === '⚠️');
    expect(warning).toBeDefined();
    expect(warning.value).toContain('role_panel.thief_must_take');
  });

  test('no must-take warning when cards are not both wolves', () => {
    const game = createTestGame({ thiefExtraRoles: [ROLES.SEER, ROLES.WEREWOLF] });
    const embed = buildThiefPanel(game, NO_TIMER, 'g1');
    const warning = getEmbedFields(embed).find(f => f.name === '⚠️');
    expect(warning).toBeUndefined();
  });

  test('no cards field when no extra roles', () => {
    const game = createTestGame({ thiefExtraRoles: [] });
    const embed = buildThiefPanel(game, NO_TIMER, 'g1');
    expect(getFieldByName(embed, 'role_panel.thief_cards')).toBeUndefined();
  });

  test('shows "done" after thief phase', () => {
    const game = createTestGame({ subPhase: PHASES.LOUPS, thiefExtraRoles: [] });
    const embed = buildThiefPanel(game, NO_TIMER, 'g1');
    const ctx = getFieldByName(embed, 'gui.context');
    expect(ctx.value).toContain('role_panel.thief_done');
  });

  test('shows action hint during thief turn with cards', () => {
    const game = createTestGame({ subPhase: PHASES.VOLEUR, thiefExtraRoles: [ROLES.SEER, ROLES.HUNTER] });
    const embed = buildThiefPanel(game, NO_TIMER, 'g1');
    const hintField = getEmbedFields(embed).find(f => f.value && f.value.includes('role_panel.thief_action_hint'));
    expect(hintField).toBeDefined();
  });
});

// ─── Phase color & footer consistency ─────────────────────────────

describe('Panel consistency', () => {
  const roleKeys = Object.keys(PANEL_BUILDERS);

  test.each(roleKeys)('%s panel has footer', (roleKey) => {
    const game = createTestGame();
    const embed = buildRolePanel(roleKey, game, TIMER, 'g1');
    const json = embed.toJSON();
    expect(json.footer).toBeDefined();
    expect(json.footer.text).toContain('role_panel.footer');
  });

  test.each(roleKeys)('%s panel has timestamp', (roleKey) => {
    const game = createTestGame();
    const embed = buildRolePanel(roleKey, game, TIMER, 'g1');
    const json = embed.toJSON();
    expect(json.timestamp).toBeDefined();
  });

  test.each(roleKeys)('%s panel has title', (roleKey) => {
    const game = createTestGame();
    const embed = buildRolePanel(roleKey, game, TIMER, 'g1');
    const json = embed.toJSON();
    expect(json.title).toBeTruthy();
  });

  test.each(roleKeys)('%s panel has color', (roleKey) => {
    const game = createTestGame();
    const embed = buildRolePanel(roleKey, game, TIMER, 'g1');
    const json = embed.toJSON();
    expect(json.color).toBeDefined();
  });
});

// ─── Day & Ended state across all panels ──────────────────────────

describe('Day state across panels', () => {
  const roleKeys = Object.keys(PANEL_BUILDERS);

  test.each(roleKeys)('%s panel shows day rest during DAY', (roleKey) => {
    const game = createTestGame({ phase: PHASES.DAY, subPhase: PHASES.DELIBERATION });
    const embed = buildRolePanel(roleKey, game, NO_TIMER, 'g1');
    const ctx = getFieldByName(embed, 'gui.context');
    expect(ctx).toBeDefined();
    // Cupid with lovers shows "done", all others show "day rest"
    if (roleKey === 'cupid' && game.lovers.length >= 2) {
      expect(ctx.value).toContain('role_panel.cupid_done');
    } else if (roleKey === 'thief') {
      // After thief phase (which it is during DAY), shows regular day context
      expect(ctx.value).toContain('role_panel.day_rest');
    } else {
      expect(ctx.value).toContain('role_panel.day_rest');
    }
  });

  test.each(roleKeys)('%s panel shows game ended during ENDED', (roleKey) => {
    const game = createTestGame({ phase: PHASES.ENDED });
    const embed = buildRolePanel(roleKey, game, NO_TIMER, 'g1');
    const ctx = getFieldByName(embed, 'gui.context');
    expect(ctx).toBeDefined();
    // Cupid and thief have special done states but ENDED overrides all
    expect(ctx.value).toContain('role_panel.game_ended');
  });
});
