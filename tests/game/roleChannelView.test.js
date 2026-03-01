/**
 * Tests for game/roleChannelView.js — Persistent role channel GUI panels.
 *
 * Validates:
 * - Each of the 7 role panel builders (wolves, seer, witch, cupid, salvateur, white_wolf, thief)
 * - Description-first layout: context + timer + action hint in description
 * - Only role-specific data uses fields (pack_members, potions, wolf_victim, etc.)
 * - Timer display / absence in description
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
  ROLE_KEY_IMAGES,
  getRoleChannels,
  getRoleKeyImage,
  buildRolePanel,
  buildRolePanelComponents,
  buildThiefButtons,
  buildWolvesComponents,
  buildWhiteWolfComponents,
  buildSeerComponents,
  buildSalvateurComponents,
  buildWitchComponents,
  buildCupidComponents,
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
    wolvesVoteState: { round: 1, votes: new Map(), resolved: false },
    ...overrides,
  };
}

const TIMER = { type: 'night-afk:Loups', remainingMs: 60000, totalMs: 120000 };
const NO_TIMER = null;

function getDescription(embed) {
  return embed.toJSON().description || '';
}

function getFooter(embed) {
  const f = embed.toJSON().footer;
  return f ? f.text : '';
}

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

// ─── getRoleKeyImage ───────────────────────────────────────────

describe('getRoleKeyImage', () => {
  test('returns correct image for each role key', () => {
    expect(getRoleKeyImage('wolves')).toBe('loupSimple.webp');
    expect(getRoleKeyImage('seer')).toBe('voyante.webp');
    expect(getRoleKeyImage('witch')).toBe('sorciere.png');
    expect(getRoleKeyImage('cupid')).toBe('cupidon.webp');
    expect(getRoleKeyImage('salvateur')).toBe('salvateur.webp');
    expect(getRoleKeyImage('white_wolf')).toBe('loupBlanc.webp');
    expect(getRoleKeyImage('thief')).toBe('voleur.webp');
  });

  test('returns null for unknown role key', () => {
    expect(getRoleKeyImage('unknown')).toBeNull();
  });
});

// ─── Thumbnail in role panels ───────────────────────────────────

describe('buildRolePanel — thumbnail', () => {
  test('all 7 role panels have a thumbnail set', () => {
    const game = createTestGame();
    for (const roleKey of Object.keys(PANEL_BUILDERS)) {
      const embed = buildRolePanel(roleKey, game, TIMER, 'g1');
      const json = embed.toJSON();
      expect(json.thumbnail).toBeDefined();
      expect(json.thumbnail.url).toContain('attachment://');
    }
  });

  test('wolves panel thumbnail is loupSimple.webp', () => {
    const embed = buildRolePanel('wolves', createTestGame(), NO_TIMER, 'g1');
    expect(embed.toJSON().thumbnail.url).toBe('attachment://loupSimple.webp');
  });

  test('seer panel thumbnail is voyante.webp', () => {
    const embed = buildRolePanel('seer', createTestGame(), NO_TIMER, 'g1');
    expect(embed.toJSON().thumbnail.url).toBe('attachment://voyante.webp');
  });

  test('witch panel thumbnail is sorciere.png', () => {
    const embed = buildRolePanel('witch', createTestGame(), NO_TIMER, 'g1');
    expect(embed.toJSON().thumbnail.url).toBe('attachment://sorciere.png');
  });

  test('cupid panel thumbnail is cupidon.webp', () => {
    const embed = buildRolePanel('cupid', createTestGame(), NO_TIMER, 'g1');
    expect(embed.toJSON().thumbnail.url).toBe('attachment://cupidon.webp');
  });

  test('salvateur panel thumbnail is salvateur.webp', () => {
    const embed = buildRolePanel('salvateur', createTestGame(), NO_TIMER, 'g1');
    expect(embed.toJSON().thumbnail.url).toBe('attachment://salvateur.webp');
  });

  test('white_wolf panel thumbnail is loupBlanc.webp', () => {
    const embed = buildRolePanel('white_wolf', createTestGame(), NO_TIMER, 'g1');
    expect(embed.toJSON().thumbnail.url).toBe('attachment://loupBlanc.webp');
  });

  test('thief panel thumbnail is voleur.webp', () => {
    const embed = buildRolePanel('thief', createTestGame(), NO_TIMER, 'g1');
    expect(embed.toJSON().thumbnail.url).toBe('attachment://voleur.webp');
  });

  test('ROLE_KEY_IMAGES covers all panel builders', () => {
    for (const roleKey of Object.keys(PANEL_BUILDERS)) {
      expect(ROLE_KEY_IMAGES[roleKey]).toBeDefined();
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

  test('description contains context (your turn during LOUPS)', () => {
    const game = createTestGame({ subPhase: PHASES.LOUPS });
    const embed = buildWolvesPanel(game, NO_TIMER, 'g1');
    expect(getDescription(embed)).toContain('gui.your_turn');
  });

  test('description contains waiting when not wolves turn', () => {
    const game = createTestGame({ subPhase: PHASES.VOYANTE });
    const embed = buildWolvesPanel(game, NO_TIMER, 'g1');
    expect(getDescription(embed)).toContain('gui.waiting_for');
  });

  test('shows timer in description when active', () => {
    const embed = buildWolvesPanel(createTestGame(), TIMER, 'g1');
    const desc = getDescription(embed);
    expect(desc).toContain('1:00');
    expect(desc).toContain('⏱');
  });

  test('no timer in description when no timer', () => {
    const embed = buildWolvesPanel(createTestGame(), NO_TIMER, 'g1');
    expect(getDescription(embed)).not.toContain('⏱');
  });

  test('shows action hint in description when wolves turn', () => {
    const game = createTestGame({ subPhase: PHASES.LOUPS });
    const embed = buildWolvesPanel(game, NO_TIMER, 'g1');
    expect(getDescription(embed)).toContain('role_panel.wolves_action_hint');
  });

  test('no action hint when not wolves turn', () => {
    const game = createTestGame({ subPhase: PHASES.VOYANTE });
    const embed = buildWolvesPanel(game, NO_TIMER, 'g1');
    expect(getDescription(embed)).not.toContain('role_panel.wolves_action_hint');
  });

  test('has NO gui.phase/gui.sub_phase/gui.day fields (description-only)', () => {
    const embed = buildWolvesPanel(createTestGame(), TIMER, 'g1');
    expect(getFieldByName(embed, 'gui.phase')).toBeUndefined();
    expect(getFieldByName(embed, 'gui.sub_phase')).toBeUndefined();
    expect(getFieldByName(embed, 'gui.day')).toBeUndefined();
  });
});

// ─── Seer Panel ───────────────────────────────────────────────────

describe('buildSeerPanel', () => {
  test('description contains context during seer turn', () => {
    const game = createTestGame({ subPhase: PHASES.VOYANTE });
    const embed = buildSeerPanel(game, NO_TIMER, 'g1');
    expect(getDescription(embed)).toContain('gui.your_turn');
  });

  test('description contains waiting when not seer turn', () => {
    const game = createTestGame({ subPhase: PHASES.LOUPS });
    const embed = buildSeerPanel(game, NO_TIMER, 'g1');
    expect(getDescription(embed)).toContain('gui.waiting_for');
  });

  test('shows action hint in description when seer turn', () => {
    const game = createTestGame({ subPhase: PHASES.VOYANTE });
    const embed = buildSeerPanel(game, NO_TIMER, 'g1');
    expect(getDescription(embed)).toContain('role_panel.seer_action_hint');
  });

  test('no action hint when not seer turn', () => {
    const game = createTestGame({ subPhase: PHASES.LOUPS });
    const embed = buildSeerPanel(game, NO_TIMER, 'g1');
    expect(getDescription(embed)).not.toContain('role_panel.seer_action_hint');
  });

  test('has no fields (seer has no role-specific data)', () => {
    const embed = buildSeerPanel(createTestGame(), NO_TIMER, 'g1');
    expect(getEmbedFields(embed)).toHaveLength(0);
  });
});

// ─── Witch Panel ──────────────────────────────────────────────────

describe('buildWitchPanel', () => {
  test('shows potion status field', () => {
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

  test('shows action hint in description during witch turn', () => {
    const game = createTestGame({ subPhase: PHASES.SORCIERE });
    const embed = buildWitchPanel(game, NO_TIMER, 'g1');
    expect(getDescription(embed)).toContain('role_panel.witch_action_hint');
  });

  test('no action hint when not witch turn', () => {
    const game = createTestGame({ subPhase: PHASES.LOUPS });
    const embed = buildWitchPanel(game, NO_TIMER, 'g1');
    expect(getDescription(embed)).not.toContain('role_panel.witch_action_hint');
  });
});

// ─── Cupid Panel ──────────────────────────────────────────────────

describe('buildCupidPanel', () => {
  test('shows "your turn" in description when cupid phase and no lovers', () => {
    const game = createTestGame({ subPhase: PHASES.CUPIDON, lovers: [] });
    const embed = buildCupidPanel(game, NO_TIMER, 'g1');
    expect(getDescription(embed)).toContain('gui.your_turn');
  });

  test('shows "done" in description when lovers are chosen', () => {
    const game = createTestGame({ subPhase: PHASES.CUPIDON, lovers: ['p1', 'p2'] });
    const embed = buildCupidPanel(game, NO_TIMER, 'g1');
    expect(getDescription(embed)).toContain('role_panel.cupid_done');
  });

  test('shows lover names as field when done', () => {
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

  test('shows action hint in description during cupid turn', () => {
    const game = createTestGame({ subPhase: PHASES.CUPIDON, lovers: [] });
    const embed = buildCupidPanel(game, NO_TIMER, 'g1');
    expect(getDescription(embed)).toContain('role_panel.cupid_action_hint');
  });

  test('no action hint when lovers already chosen (done state)', () => {
    const game = createTestGame({ subPhase: PHASES.CUPIDON, lovers: ['p1', 'p2'] });
    const embed = buildCupidPanel(game, NO_TIMER, 'g1');
    expect(getDescription(embed)).not.toContain('role_panel.cupid_action_hint');
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

  test('shows action hint in description during salvateur turn', () => {
    const game = createTestGame({ subPhase: PHASES.SALVATEUR });
    const embed = buildSalvateurPanel(game, NO_TIMER, 'g1');
    expect(getDescription(embed)).toContain('role_panel.salvateur_action_hint');
  });

  test('no action hint when not salvateur turn', () => {
    const game = createTestGame({ subPhase: PHASES.LOUPS });
    const embed = buildSalvateurPanel(game, NO_TIMER, 'g1');
    expect(getDescription(embed)).not.toContain('role_panel.salvateur_action_hint');
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

  test('shows action hint in description during white wolf turn', () => {
    const game = createTestGame({ subPhase: PHASES.LOUP_BLANC });
    const embed = buildWhiteWolfPanel(game, NO_TIMER, 'g1');
    expect(getDescription(embed)).toContain('role_panel.white_wolf_action_hint');
  });

  test('no action hint when not white wolf turn', () => {
    const game = createTestGame({ subPhase: PHASES.LOUPS });
    const embed = buildWhiteWolfPanel(game, NO_TIMER, 'g1');
    expect(getDescription(embed)).not.toContain('role_panel.white_wolf_action_hint');
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

  test('shows "done" in description after thief phase during NIGHT', () => {
    const game = createTestGame({ subPhase: PHASES.LOUPS, thiefExtraRoles: [] });
    const embed = buildThiefPanel(game, NO_TIMER, 'g1');
    expect(getDescription(embed)).toContain('role_panel.thief_done');
  });

  test('shows action hint in description during thief turn with cards', () => {
    const game = createTestGame({ subPhase: PHASES.VOLEUR, thiefExtraRoles: [ROLES.SEER, ROLES.HUNTER] });
    const embed = buildThiefPanel(game, NO_TIMER, 'g1');
    expect(getDescription(embed)).toContain('role_panel.thief_action_hint');
  });

  test('no action hint when no cards even during thief turn', () => {
    const game = createTestGame({ subPhase: PHASES.VOLEUR, thiefExtraRoles: [] });
    const embed = buildThiefPanel(game, NO_TIMER, 'g1');
    expect(getDescription(embed)).not.toContain('role_panel.thief_action_hint');
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

  test.each(roleKeys)('%s panel has NO gui.phase/gui.sub_phase/gui.day fields', (roleKey) => {
    const game = createTestGame();
    const embed = buildRolePanel(roleKey, game, TIMER, 'g1');
    expect(getFieldByName(embed, 'gui.phase')).toBeUndefined();
    expect(getFieldByName(embed, 'gui.sub_phase')).toBeUndefined();
    expect(getFieldByName(embed, 'gui.day')).toBeUndefined();
  });
});

// ─── Day & Ended state across all panels ──────────────────────────

describe('Day state across panels', () => {
  const roleKeys = Object.keys(PANEL_BUILDERS);

  test.each(roleKeys)('%s panel shows day rest in description during DAY', (roleKey) => {
    const game = createTestGame({ phase: PHASES.DAY, subPhase: PHASES.DELIBERATION });
    const embed = buildRolePanel(roleKey, game, NO_TIMER, 'g1');
    const desc = getDescription(embed);
    // Cupid with lovers shows "done", thief during DAY might show regular context
    if (roleKey === 'cupid' && game.lovers.length >= 2) {
      expect(desc).toContain('role_panel.cupid_done');
    } else {
      expect(desc).toContain('role_panel.day_rest');
    }
  });

  test.each(roleKeys)('%s panel shows game ended in description during ENDED', (roleKey) => {
    const game = createTestGame({ phase: PHASES.ENDED });
    const embed = buildRolePanel(roleKey, game, NO_TIMER, 'g1');
    const desc = getDescription(embed);
    // Cupid with lovers: cupid_done override. Thief: thief_done override when thiefPhaseOver && NIGHT.
    // During ENDED, phase is ENDED not NIGHT so thief goes through buildRoleDescription which shows game_ended.
    // Cupid: loversDone check runs first, but lovers is empty in test game, so falls through to buildRoleDescription.
    expect(desc).toContain('role_panel.game_ended');
  });
});

// ─── Timer in description across all panels ───────────────────────

describe('Timer in description across panels', () => {
  // Thief has a "done" override during NIGHT when subPhase !== VOLEUR,
  // which skips the timer. So we exclude thief from the generic test
  // and test it separately.
  const roleKeysExceptThief = Object.keys(PANEL_BUILDERS).filter(k => k !== 'thief');

  test.each(roleKeysExceptThief)('%s panel shows timer when provided', (roleKey) => {
    const game = createTestGame();
    const embed = buildRolePanel(roleKey, game, TIMER, 'g1');
    const desc = getDescription(embed);
    expect(desc).toContain('⏱');
    expect(desc).toContain('1:00');
  });

  test('thief panel shows timer during VOLEUR subPhase', () => {
    const game = createTestGame({ subPhase: PHASES.VOLEUR, thiefExtraRoles: [ROLES.SEER, ROLES.HUNTER] });
    const embed = buildThiefPanel(game, TIMER, 'g1');
    const desc = getDescription(embed);
    expect(desc).toContain('⏱');
    expect(desc).toContain('1:00');
  });

  test('thief panel omits timer during done state', () => {
    // Default game: NIGHT + LOUPS subphase → thief is "done"
    const game = createTestGame();
    const embed = buildThiefPanel(game, TIMER, 'g1');
    expect(getDescription(embed)).not.toContain('⏱');
  });

  const roleKeys = Object.keys(PANEL_BUILDERS);

  test.each(roleKeys)('%s panel omits timer when null', (roleKey) => {
    // Use VOLEUR subPhase so thief doesn't enter done override
    const game = createTestGame({ subPhase: PHASES.VOLEUR });
    const embed = buildRolePanel(roleKey, game, NO_TIMER, 'g1');
    const desc = getDescription(embed);
    expect(desc).not.toContain('⏱');
  });
});

// ─── Thief Buttons ─────────────────────────────────────────────────

describe('buildThiefButtons', () => {

  test('returns action row with 3 buttons during VOLEUR subPhase', () => {
    const game = createTestGame({
      subPhase: PHASES.VOLEUR,
      thiefExtraRoles: [ROLES.SEER, ROLES.WITCH],
    });
    const rows = buildThiefButtons(game, 'g1');
    expect(rows).toHaveLength(1);
    expect(rows[0].components).toHaveLength(3);
  });

  test('button labels include translated card role names', () => {
    const game = createTestGame({
      subPhase: PHASES.VOLEUR,
      thiefExtraRoles: [ROLES.SEER, ROLES.WITCH],
    });
    const rows = buildThiefButtons(game, 'g1');
    const labels = rows[0].components.map(c => c.data.label);
    // translateRole returns role key as-is in test mock
    expect(labels[0]).toContain(ROLES.SEER);
    expect(labels[1]).toContain(ROLES.WITCH);
  });

  test('button customIds are thief_steal:1, thief_steal:2, thief_skip', () => {
    const game = createTestGame({
      subPhase: PHASES.VOLEUR,
      thiefExtraRoles: [ROLES.SEER, ROLES.WITCH],
    });
    const rows = buildThiefButtons(game, 'g1');
    // discord.js v14 stores customId as custom_id in raw data
    const ids = rows[0].components.map(c => c.data.custom_id || c.data.customId);
    expect(ids).toEqual(['thief_steal:1', 'thief_steal:2', 'thief_skip']);
  });

  test('skip button is disabled when both cards are wolves', () => {
    const game = createTestGame({
      subPhase: PHASES.VOLEUR,
      thiefExtraRoles: [ROLES.WEREWOLF, ROLES.WHITE_WOLF],
    });
    const rows = buildThiefButtons(game, 'g1');
    const skipBtn = rows[0].components[2];
    expect(skipBtn.data.disabled).toBe(true);
  });

  test('skip button is enabled when cards are not both wolves', () => {
    const game = createTestGame({
      subPhase: PHASES.VOLEUR,
      thiefExtraRoles: [ROLES.SEER, ROLES.WEREWOLF],
    });
    const rows = buildThiefButtons(game, 'g1');
    const skipBtn = rows[0].components[2];
    expect(skipBtn.data.disabled).toBe(false);
  });

  test('returns empty array when phase is DAY', () => {
    const game = createTestGame({
      phase: PHASES.DAY,
      subPhase: PHASES.VOLEUR,
      thiefExtraRoles: [ROLES.SEER, ROLES.WITCH],
    });
    const rows = buildThiefButtons(game, 'g1');
    expect(rows).toEqual([]);
  });

  test('returns empty array when subPhase is not VOLEUR', () => {
    const game = createTestGame({
      subPhase: PHASES.LOUPS,
      thiefExtraRoles: [ROLES.SEER, ROLES.WITCH],
    });
    const rows = buildThiefButtons(game, 'g1');
    expect(rows).toEqual([]);
  });

  test('returns empty array when no thief cards', () => {
    const game = createTestGame({
      subPhase: PHASES.VOLEUR,
      thiefExtraRoles: [],
    });
    const rows = buildThiefButtons(game, 'g1');
    expect(rows).toEqual([]);
  });
});

// ─── buildRolePanelComponents ──────────────────────────────────────

describe('buildRolePanelComponents', () => {

  test('returns thief buttons for roleKey "thief"', () => {
    const game = createTestGame({
      subPhase: PHASES.VOLEUR,
      thiefExtraRoles: [ROLES.SEER, ROLES.WITCH],
    });
    const components = buildRolePanelComponents('thief', game, 'g1');
    expect(components).toHaveLength(1);
  });

  test('returns wolves select menu during LOUPS', () => {
    const game = createTestGame({ subPhase: PHASES.LOUPS });
    const components = buildRolePanelComponents('wolves', game, 'g1');
    expect(components.length).toBeGreaterThan(0);
  });

  test('returns seer select + skip during VOYANTE', () => {
    const game = createTestGame({ subPhase: PHASES.VOYANTE });
    const components = buildRolePanelComponents('seer', game, 'g1');
    expect(components.length).toBe(2); // select + skip
  });

  test('returns witch buttons during SORCIERE', () => {
    const game = createTestGame({ subPhase: PHASES.SORCIERE });
    const components = buildRolePanelComponents('witch', game, 'g1');
    expect(components.length).toBeGreaterThan(0);
  });

  test('returns empty array for wolves when subPhase is not LOUPS', () => {
    const game = createTestGame({ subPhase: PHASES.VOYANTE });
    expect(buildRolePanelComponents('wolves', game, 'g1')).toEqual([]);
  });

  test('returns empty array for seer when subPhase is not VOYANTE', () => {
    const game = createTestGame({ subPhase: PHASES.LOUPS });
    expect(buildRolePanelComponents('seer', game, 'g1')).toEqual([]);
  });

  test('returns empty array for thief when subPhase is past VOLEUR', () => {
    const game = createTestGame({
      subPhase: PHASES.LOUPS,
      thiefExtraRoles: [ROLES.SEER, ROLES.WITCH],
    });
    const components = buildRolePanelComponents('thief', game, 'g1');
    expect(components).toEqual([]);
  });
});

// ─── Wolves Components ─────────────────────────────────────────────

describe('buildWolvesComponents', () => {

  test('returns select menu with non-wolf alive targets during LOUPS', () => {
    const game = createTestGame({ subPhase: PHASES.LOUPS });
    const rows = buildWolvesComponents(game, 'g1');
    expect(rows).toHaveLength(1);
    const menu = rows[0].components[0];
    expect(menu.data.custom_id).toBe('wolves_kill');
    // Should include alive non-wolves only
    const ids = menu.options.map(o => o.data.value);
    expect(ids).not.toContain('p1'); // werewolf
    expect(ids).not.toContain('p7'); // white wolf
    expect(ids).toContain('p2');     // seer
    expect(ids).toContain('p4');     // villager
  });

  test('returns empty when not NIGHT', () => {
    const game = createTestGame({ phase: PHASES.DAY, subPhase: PHASES.LOUPS });
    expect(buildWolvesComponents(game, 'g1')).toEqual([]);
  });

  test('returns empty when subPhase is not LOUPS', () => {
    const game = createTestGame({ subPhase: PHASES.VOYANTE });
    expect(buildWolvesComponents(game, 'g1')).toEqual([]);
  });

  test('returns empty when no non-wolf targets', () => {
    const game = createTestGame({
      subPhase: PHASES.LOUPS,
      players: [
        { id: 'w1', username: 'W1', role: ROLES.WEREWOLF, alive: true },
        { id: 'w2', username: 'W2', role: ROLES.WHITE_WOLF, alive: true },
      ],
    });
    expect(buildWolvesComponents(game, 'g1')).toEqual([]);
  });

  test('returns empty when wolves vote is resolved', () => {
    const game = createTestGame({
      subPhase: PHASES.LOUPS,
      wolvesVoteState: { round: 1, votes: new Map(), resolved: true },
    });
    expect(buildWolvesComponents(game, 'g1')).toEqual([]);
  });
});

// ─── White Wolf Components ─────────────────────────────────────────

describe('buildWhiteWolfComponents', () => {

  test('returns select menu with regular wolves during LOUP_BLANC', () => {
    const game = createTestGame({ subPhase: PHASES.LOUP_BLANC });
    const rows = buildWhiteWolfComponents(game, 'g1');
    expect(rows.length).toBe(2); // select + skip
    const menu = rows[0].components[0];
    expect(menu.data.custom_id).toBe('ww_kill');
    const ids = menu.options.map(o => o.data.value);
    expect(ids).toContain('p1'); // werewolf
    expect(ids).not.toContain('p7'); // white wolf (self)
  });

  test('shows skip button', () => {
    const game = createTestGame({ subPhase: PHASES.LOUP_BLANC });
    const rows = buildWhiteWolfComponents(game, 'g1');
    const skipBtn = rows[rows.length - 1].components[0];
    expect(skipBtn.data.customId || skipBtn.data.custom_id).toBe('ww_skip');
  });

  test('returns only skip when no regular wolves alive', () => {
    const game = createTestGame({
      subPhase: PHASES.LOUP_BLANC,
      players: [
        { id: 'p7', username: 'Grace', role: ROLES.WHITE_WOLF, alive: true },
        { id: 'p2', username: 'Bob', role: ROLES.SEER, alive: true },
      ],
    });
    const rows = buildWhiteWolfComponents(game, 'g1');
    expect(rows).toHaveLength(1); // only skip button
  });

  test('returns empty when not in LOUP_BLANC subPhase', () => {
    const game = createTestGame({ subPhase: PHASES.LOUPS });
    expect(buildWhiteWolfComponents(game, 'g1')).toEqual([]);
  });
});

// ─── Seer Components ───────────────────────────────────────────────

describe('buildSeerComponents', () => {

  test('returns select menu + skip during VOYANTE', () => {
    const game = createTestGame({ subPhase: PHASES.VOYANTE });
    const rows = buildSeerComponents(game, 'g1');
    expect(rows).toHaveLength(2);
    expect(rows[0].components[0].data.custom_id).toBe('seer_see');
    expect(rows[1].components[0].data.customId || rows[1].components[0].data.custom_id).toBe('seer_skip');
  });

  test('select lists all alive players', () => {
    const game = createTestGame({ subPhase: PHASES.VOYANTE });
    const rows = buildSeerComponents(game, 'g1');
    const alivePlayers = game.players.filter(p => p.alive);
    expect(rows[0].components[0].options).toHaveLength(alivePlayers.length);
  });

  test('returns empty when not VOYANTE', () => {
    const game = createTestGame({ subPhase: PHASES.LOUPS });
    expect(buildSeerComponents(game, 'g1')).toEqual([]);
  });
});

// ─── Salvateur Components ──────────────────────────────────────────

describe('buildSalvateurComponents', () => {

  test('returns select menu + skip during SALVATEUR', () => {
    const game = createTestGame({ subPhase: PHASES.SALVATEUR });
    const rows = buildSalvateurComponents(game, 'g1');
    expect(rows).toHaveLength(2);
    expect(rows[0].components[0].data.custom_id).toBe('salvateur_protect');
  });

  test('excludes self from targets', () => {
    const game = createTestGame({ subPhase: PHASES.SALVATEUR });
    const rows = buildSalvateurComponents(game, 'g1');
    const ids = rows[0].components[0].options.map(o => o.data.value);
    expect(ids).not.toContain('p6'); // salvateur
  });

  test('excludes lastProtectedPlayerId from targets', () => {
    const game = createTestGame({
      subPhase: PHASES.SALVATEUR,
      lastProtectedPlayerId: 'p2',
    });
    const rows = buildSalvateurComponents(game, 'g1');
    const ids = rows[0].components[0].options.map(o => o.data.value);
    expect(ids).not.toContain('p2');
    expect(ids).not.toContain('p6'); // self
  });

  test('returns empty when not SALVATEUR subPhase', () => {
    const game = createTestGame({ subPhase: PHASES.LOUPS });
    expect(buildSalvateurComponents(game, 'g1')).toEqual([]);
  });
});

// ─── Witch Components ──────────────────────────────────────────────

describe('buildWitchComponents', () => {

  test('returns button row + death select during SORCIERE', () => {
    const game = createTestGame({
      subPhase: PHASES.SORCIERE,
      witchPotions: { life: true, death: true },
      nightVictim: 'p4',
    });
    const rows = buildWitchComponents(game, 'g1');
    expect(rows.length).toBe(2); // buttons + death select
    const btnRow = rows[0];
    const ids = btnRow.components.map(c => c.data.customId || c.data.custom_id);
    expect(ids).toContain('witch_life');
    expect(ids).toContain('witch_skip');
  });

  test('save button is disabled when no life potion', () => {
    const game = createTestGame({
      subPhase: PHASES.SORCIERE,
      witchPotions: { life: false, death: true },
    });
    const rows = buildWitchComponents(game, 'g1');
    const saveBtn = rows[0].components.find(c =>
      (c.data.customId || c.data.custom_id) === 'witch_life'
    );
    expect(saveBtn.data.disabled).toBe(true);
  });

  test('save button is disabled when no nightVictim', () => {
    const game = createTestGame({
      subPhase: PHASES.SORCIERE,
      witchPotions: { life: true, death: true },
      nightVictim: null,
    });
    const rows = buildWitchComponents(game, 'g1');
    const saveBtn = rows[0].components.find(c =>
      (c.data.customId || c.data.custom_id) === 'witch_life'
    );
    expect(saveBtn.data.disabled).toBe(true);
  });

  test('no death select menu when death potion used', () => {
    const game = createTestGame({
      subPhase: PHASES.SORCIERE,
      witchPotions: { life: true, death: false },
    });
    const rows = buildWitchComponents(game, 'g1');
    expect(rows).toHaveLength(1); // only button row
  });

  test('death select excludes witch from options', () => {
    const game = createTestGame({
      subPhase: PHASES.SORCIERE,
      witchPotions: { life: true, death: true },
    });
    const rows = buildWitchComponents(game, 'g1');
    // death select is the second row
    const deathMenu = rows[1].components[0];
    const ids = deathMenu.options.map(o => o.data.value);
    expect(ids).not.toContain('p3'); // witch
  });

  test('returns empty when not SORCIERE', () => {
    const game = createTestGame({ subPhase: PHASES.LOUPS });
    expect(buildWitchComponents(game, 'g1')).toEqual([]);
  });
});

// ─── Cupid Components ──────────────────────────────────────────────

describe('buildCupidComponents', () => {

  test('returns multi-select + skip during CUPIDON', () => {
    const game = createTestGame({ subPhase: PHASES.CUPIDON, lovers: [] });
    const rows = buildCupidComponents(game, 'g1');
    expect(rows).toHaveLength(2);
    const menu = rows[0].components[0];
    expect(menu.data.custom_id).toBe('cupid_love');
    expect(menu.data.min_values).toBe(2);
    expect(menu.data.max_values).toBe(2);
  });

  test('lists all alive players', () => {
    const game = createTestGame({ subPhase: PHASES.CUPIDON, lovers: [] });
    const rows = buildCupidComponents(game, 'g1');
    const aliveCount = game.players.filter(p => p.alive).length;
    expect(rows[0].components[0].options).toHaveLength(aliveCount);
  });

  test('returns empty when lovers already chosen', () => {
    const game = createTestGame({
      subPhase: PHASES.CUPIDON,
      lovers: [['p1', 'p2']],
    });
    expect(buildCupidComponents(game, 'g1')).toEqual([]);
  });

  test('returns empty when not CUPIDON', () => {
    const game = createTestGame({ subPhase: PHASES.LOUPS, lovers: [] });
    expect(buildCupidComponents(game, 'g1')).toEqual([]);
  });

  test('returns empty when fewer than 2 alive players', () => {
    const game = createTestGame({
      subPhase: PHASES.CUPIDON,
      lovers: [],
      players: [{ id: 'p1', username: 'Only', role: ROLES.CUPID, alive: true }],
    });
    expect(buildCupidComponents(game, 'g1')).toEqual([]);
  });
});
