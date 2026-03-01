/**
 * Tests for game/villageStatusPanel.js — Persistent master GUI panel for #village.
 *
 * Validates:
 * - buildFocusMessage for every phase/subPhase (night, day, ended)
 * - buildVillageMasterEmbed structure (title, phase fields, timer, focus, counts, players, footer)
 * - No secret information leaks (no roles in embed fields)
 * - Timer presence / absence
 * - Captain display
 * - Alive / dead player lists
 * - Progression bar (only when there are dead players)
 * - Edge cases (empty players, no captain, no dead)
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
  buildVillageMasterEmbed,
  buildFocusMessage,
} = require('../../game/villageStatusPanel');

// ─── Helpers ──────────────────────────────────────────────────────

function createTestGame(overrides = {}) {
  return {
    mainChannelId: 'ch123',
    guildId: 'g123',
    phase: PHASES.NIGHT,
    subPhase: PHASES.LOUPS,
    dayCount: 2,
    captainId: 'p1',
    villageChannelId: 'vc1',
    players: [
      { id: 'p1', username: 'Alice', role: ROLES.WEREWOLF, alive: true },
      { id: 'p2', username: 'Bob', role: ROLES.SEER, alive: true },
      { id: 'p3', username: 'Charlie', role: ROLES.VILLAGER, alive: false },
      { id: 'p4', username: 'Diana', role: ROLES.WITCH, alive: true },
    ],
    ...overrides,
  };
}

const TIMER = { type: 'night-afk:Loups', remainingMs: 60000, totalMs: 120000 };
const NO_TIMER = null;

function getFields(embed) {
  return embed.toJSON().fields || [];
}

function findField(embed, nameIncludes) {
  return getFields(embed).find(f => f.name.includes(nameIncludes));
}

// ─── buildFocusMessage ────────────────────────────────────────────

describe('buildFocusMessage', () => {
  // Ended
  test('shows ended when game is ENDED', () => {
    const game = createTestGame({ phase: PHASES.ENDED });
    expect(buildFocusMessage(game, 'g1')).toContain('village_panel.focus_ended');
  });

  // Day sub-phases
  test('shows deliberation during DELIBERATION', () => {
    const game = createTestGame({ phase: PHASES.DAY, subPhase: PHASES.DELIBERATION });
    expect(buildFocusMessage(game, 'g1')).toContain('village_panel.focus_deliberation');
  });

  test('shows vote during VOTE', () => {
    const game = createTestGame({ phase: PHASES.DAY, subPhase: PHASES.VOTE });
    expect(buildFocusMessage(game, 'g1')).toContain('village_panel.focus_vote');
  });

  test('shows captain vote during VOTE_CAPITAINE', () => {
    const game = createTestGame({ phase: PHASES.DAY, subPhase: PHASES.VOTE_CAPITAINE });
    expect(buildFocusMessage(game, 'g1')).toContain('village_panel.focus_captain_vote');
  });

  test('shows day default for unknown day sub-phase', () => {
    const game = createTestGame({ phase: PHASES.DAY, subPhase: 'unknown' });
    expect(buildFocusMessage(game, 'g1')).toContain('village_panel.focus_day');
  });

  // Night sub-phases
  test('shows thief during VOLEUR', () => {
    const game = createTestGame({ subPhase: PHASES.VOLEUR });
    expect(buildFocusMessage(game, 'g1')).toContain('village_panel.focus_thief');
  });

  test('shows cupid during CUPIDON', () => {
    const game = createTestGame({ subPhase: PHASES.CUPIDON });
    expect(buildFocusMessage(game, 'g1')).toContain('village_panel.focus_cupid');
  });

  test('shows salvateur during SALVATEUR', () => {
    const game = createTestGame({ subPhase: PHASES.SALVATEUR });
    expect(buildFocusMessage(game, 'g1')).toContain('village_panel.focus_salvateur');
  });

  test('shows wolves during LOUPS', () => {
    const game = createTestGame({ subPhase: PHASES.LOUPS });
    expect(buildFocusMessage(game, 'g1')).toContain('village_panel.focus_wolves');
  });

  test('shows white wolf during LOUP_BLANC', () => {
    const game = createTestGame({ subPhase: PHASES.LOUP_BLANC });
    expect(buildFocusMessage(game, 'g1')).toContain('village_panel.focus_white_wolf');
  });

  test('shows witch during SORCIERE', () => {
    const game = createTestGame({ subPhase: PHASES.SORCIERE });
    expect(buildFocusMessage(game, 'g1')).toContain('village_panel.focus_witch');
  });

  test('shows seer during VOYANTE', () => {
    const game = createTestGame({ subPhase: PHASES.VOYANTE });
    expect(buildFocusMessage(game, 'g1')).toContain('village_panel.focus_seer');
  });

  test('shows wakeup during REVEIL', () => {
    const game = createTestGame({ subPhase: PHASES.REVEIL });
    expect(buildFocusMessage(game, 'g1')).toContain('village_panel.focus_wakeup');
  });

  test('shows waiting for unknown sub-phase', () => {
    const game = createTestGame({ subPhase: 'mystery' });
    expect(buildFocusMessage(game, 'g1')).toContain('village_panel.focus_waiting');
  });

  // Emoji correctness
  test('ended focus has 🏁 emoji', () => {
    const game = createTestGame({ phase: PHASES.ENDED });
    expect(buildFocusMessage(game, 'g1')).toMatch(/🏁/);
  });

  test('wolves focus has wolf emoji', () => {
    const game = createTestGame({ subPhase: PHASES.LOUPS });
    expect(buildFocusMessage(game, 'g1')).toMatch(/🐺/);
  });

  test('vote focus has ballot emoji', () => {
    const game = createTestGame({ phase: PHASES.DAY, subPhase: PHASES.VOTE });
    expect(buildFocusMessage(game, 'g1')).toMatch(/🗳️/);
  });
});

// ─── buildVillageMasterEmbed — structure ──────────────────────────

describe('buildVillageMasterEmbed — structure', () => {
  test('has title with phase emoji', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), TIMER, 'g1');
    const json = embed.toJSON();
    expect(json.title).toContain('🌙');
    expect(json.title).toContain('village_panel.title');
  });

  test('has color', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    expect(embed.toJSON().color).toBeDefined();
  });

  test('has timestamp', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    expect(embed.toJSON().timestamp).toBeDefined();
  });

  test('has footer', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    const json = embed.toJSON();
    expect(json.footer).toBeDefined();
    expect(json.footer.text).toContain('village_panel.footer');
  });

  test('has phase field', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    expect(findField(embed, 'gui.phase')).toBeDefined();
  });

  test('has sub_phase field', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    expect(findField(embed, 'gui.sub_phase')).toBeDefined();
  });

  test('has day field', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    expect(findField(embed, 'gui.day')).toBeDefined();
    expect(findField(embed, 'gui.day').value).toContain('2');
  });

  test('has focus header field', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    expect(findField(embed, 'village_panel.focus_header')).toBeDefined();
  });
});

// ─── Timer ────────────────────────────────────────────────────────

describe('buildVillageMasterEmbed — timer', () => {
  test('shows timer when active', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), TIMER, 'g1');
    const timerField = findField(embed, 'gui.timer');
    expect(timerField).toBeDefined();
    expect(timerField.value).toContain('1:00'); // 60000ms = 1:00
  });

  test('no timer field when no timer', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    expect(findField(embed, 'gui.timer')).toBeUndefined();
  });

  test('no timer field when remainingMs is 0', () => {
    const expired = { type: 'night', remainingMs: 0, totalMs: 120000 };
    const embed = buildVillageMasterEmbed(createTestGame(), expired, 'g1');
    expect(findField(embed, 'gui.timer')).toBeUndefined();
  });

  test('timer has progress bar', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), TIMER, 'g1');
    const timerField = findField(embed, 'gui.timer');
    expect(timerField.value).toMatch(/[▓░]/);
  });
});

// ─── Focus section ────────────────────────────────────────────────

describe('buildVillageMasterEmbed — focus section', () => {
  test('shows wolves focus during LOUPS', () => {
    const embed = buildVillageMasterEmbed(createTestGame({ subPhase: PHASES.LOUPS }), NO_TIMER, 'g1');
    const focus = findField(embed, 'village_panel.focus_header');
    expect(focus.value).toContain('village_panel.focus_wolves');
  });

  test('shows vote focus during VOTE', () => {
    const game = createTestGame({ phase: PHASES.DAY, subPhase: PHASES.VOTE });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    const focus = findField(embed, 'village_panel.focus_header');
    expect(focus.value).toContain('village_panel.focus_vote');
  });

  test('shows ended focus during ENDED', () => {
    const game = createTestGame({ phase: PHASES.ENDED });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    const focus = findField(embed, 'village_panel.focus_header');
    expect(focus.value).toContain('village_panel.focus_ended');
  });

  test('shows seer focus during VOYANTE', () => {
    const game = createTestGame({ subPhase: PHASES.VOYANTE });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    const focus = findField(embed, 'village_panel.focus_header');
    expect(focus.value).toContain('village_panel.focus_seer');
  });
});

// ─── Counts & Captain ─────────────────────────────────────────────

describe('buildVillageMasterEmbed — counts & captain', () => {
  test('shows alive count', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    const field = findField(embed, 'gui.alive');
    expect(field).toBeDefined();
    expect(field.value).toContain('3'); // 3 alive
  });

  test('shows dead count', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    const field = findField(embed, 'gui.dead');
    expect(field).toBeDefined();
    expect(field.value).toContain('1'); // 1 dead
  });

  test('shows captain name', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    const field = findField(embed, 'gui.captain');
    expect(field.value).toContain('Alice');
  });

  test('shows dash when no captain', () => {
    const game = createTestGame({ captainId: null });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    const field = findField(embed, 'gui.captain');
    expect(field.value).toContain('—');
  });
});

// ─── Player lists ─────────────────────────────────────────────────

describe('buildVillageMasterEmbed — player lists', () => {
  test('shows alive players', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    const field = findField(embed, 'gui.alive_list');
    expect(field).toBeDefined();
    expect(field.value).toContain('Alice');
    expect(field.value).toContain('Bob');
    expect(field.value).toContain('Diana');
  });

  test('shows captain badge on captain in alive list', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    const field = findField(embed, 'gui.alive_list');
    expect(field.value).toContain('Alice 👑');
  });

  test('shows dead players', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    const field = findField(embed, 'gui.dead_list');
    expect(field).toBeDefined();
    expect(field.value).toContain('Charlie');
  });

  test('no dead list when no dead players', () => {
    const game = createTestGame({
      players: [
        { id: 'p1', username: 'Alice', role: ROLES.WEREWOLF, alive: true },
        { id: 'p2', username: 'Bob', role: ROLES.SEER, alive: true },
      ],
    });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    expect(findField(embed, 'gui.dead_list')).toBeUndefined();
  });

  test('no alive list when no alive players', () => {
    const game = createTestGame({
      players: [
        { id: 'p3', username: 'Charlie', role: ROLES.VILLAGER, alive: false },
      ],
    });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    expect(findField(embed, 'gui.alive_list')).toBeUndefined();
  });
});

// ─── Progression ──────────────────────────────────────────────────

describe('buildVillageMasterEmbed — progression', () => {
  test('shows progression bar when there are dead players', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    const field = findField(embed, 'gui.progression');
    expect(field).toBeDefined();
    expect(field.value).toMatch(/[▓░]/);
    expect(field.value).toContain('gui.eliminated');
  });

  test('shows correct percentage', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    const field = findField(embed, 'gui.progression');
    // 1 dead / 4 total = 25%
    expect(field.value).toContain('25%');
  });

  test('no progression when no dead players', () => {
    const game = createTestGame({
      players: [
        { id: 'p1', username: 'Alice', role: ROLES.WEREWOLF, alive: true },
        { id: 'p2', username: 'Bob', role: ROLES.SEER, alive: true },
      ],
    });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    expect(findField(embed, 'gui.progression')).toBeUndefined();
  });
});

// ─── No secrets leaked ───────────────────────────────────────────

describe('buildVillageMasterEmbed — no secrets', () => {
  test('does not contain any role name in player lists', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    const json = JSON.stringify(embed.toJSON());
    // The embed should not contain any role identifiers
    expect(json).not.toContain(ROLES.WEREWOLF);
    expect(json).not.toContain(ROLES.SEER);
    expect(json).not.toContain(ROLES.WITCH);
    expect(json).not.toContain(ROLES.VILLAGER);
  });
});

// ─── Phase color adaptation ──────────────────────────────────────

describe('buildVillageMasterEmbed — phase colors', () => {
  test('night color', () => {
    const embed = buildVillageMasterEmbed(createTestGame({ phase: PHASES.NIGHT }), NO_TIMER, 'g1');
    expect(embed.toJSON().color).toBe(0x2C2F33);
  });

  test('day color', () => {
    const game = createTestGame({ phase: PHASES.DAY, subPhase: PHASES.DELIBERATION });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    expect(embed.toJSON().color).toBe(0xF9A825);
  });

  test('ended color', () => {
    const game = createTestGame({ phase: PHASES.ENDED });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    expect(embed.toJSON().color).toBe(0xED4245);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────

describe('buildVillageMasterEmbed — edge cases', () => {
  test('handles empty players array', () => {
    const game = createTestGame({ players: [] });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    expect(embed).toBeDefined();
    expect(embed.toJSON().title).toBeDefined();
  });

  test('handles missing dayCount', () => {
    const game = createTestGame({ dayCount: undefined });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    const dayField = findField(embed, 'gui.day');
    expect(dayField.value).toContain('0');
  });

  test('handles null captainId', () => {
    const game = createTestGame({ captainId: null });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    expect(findField(embed, 'gui.captain').value).toContain('—');
  });

  test('handles captainId not found in players', () => {
    const game = createTestGame({ captainId: 'nonexistent' });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    expect(findField(embed, 'gui.captain').value).toContain('—');
  });

  test('title changes with phase emoji (day)', () => {
    const game = createTestGame({ phase: PHASES.DAY, subPhase: PHASES.DELIBERATION });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    expect(embed.toJSON().title).toContain('☀️');
  });

  test('title changes with phase emoji (ended)', () => {
    const game = createTestGame({ phase: PHASES.ENDED });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    expect(embed.toJSON().title).toContain('🏁');
  });
});

// ─── Integration: gameManager village panel methods ───────────────

describe('gameManager village panel integration', () => {
  let gameManager;

  beforeEach(() => {
    jest.resetModules();
    // Re-mock after resetModules
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
      translateRoleDesc: (r) => r,
      tips: () => '',
    }));
    jest.mock('../../utils/theme', () => ({
      getColor: () => 0x5865F2,
    }));
    jest.mock('../../database/db', () => {
      return class MockDB {
        constructor() {}
        getGames() { return []; }
        updateGame() {}
        updatePlayer() {}
        deleteGame() {}
        close() {}
      };
    });
    gameManager = require('../../game/gameManager');
  });

  afterEach(() => {
    try { gameManager.destroy(); } catch (_) {}
  });

  test('villagePanels Map is initialized', () => {
    expect(gameManager.villagePanels).toBeInstanceOf(Map);
    expect(gameManager.villagePanels.size).toBe(0);
  });

  test('_villagePanelTimers Map is initialized', () => {
    expect(gameManager._villagePanelTimers).toBeInstanceOf(Map);
    expect(gameManager._villagePanelTimers.size).toBe(0);
  });

  test('_startVillagePanelTick does not create duplicate intervals', () => {
    gameManager._startVillagePanelTick('ch1');
    expect(gameManager._villagePanelTimers.has('ch1')).toBe(true);
    const first = gameManager._villagePanelTimers.get('ch1');
    gameManager._startVillagePanelTick('ch1');
    expect(gameManager._villagePanelTimers.get('ch1')).toBe(first); // same interval
    gameManager._stopVillagePanelTick('ch1');
  });

  test('_stopVillagePanelTick clears interval', () => {
    gameManager._startVillagePanelTick('ch1');
    expect(gameManager._villagePanelTimers.has('ch1')).toBe(true);
    gameManager._stopVillagePanelTick('ch1');
    expect(gameManager._villagePanelTimers.has('ch1')).toBe(false);
  });

  test('_refreshVillageMasterPanel returns silently for unknown game', async () => {
    // Should not throw
    await gameManager._refreshVillageMasterPanel('nonexistent');
  });

  test('_refreshVillageMasterPanel stops tick on ENDED game', async () => {
    gameManager.games.set('ch1', { phase: PHASES.ENDED, mainChannelId: 'ch1', guildId: 'g1', players: [] });
    gameManager._startVillagePanelTick('ch1');
    expect(gameManager._villagePanelTimers.has('ch1')).toBe(true);
    await gameManager._refreshVillageMasterPanel('ch1');
    expect(gameManager._villagePanelTimers.has('ch1')).toBe(false);
  });

  test('_refreshVillageMasterPanel edits existing panel message', async () => {
    const game = {
      phase: PHASES.NIGHT, subPhase: PHASES.LOUPS, dayCount: 1,
      mainChannelId: 'ch1', guildId: 'g1', captainId: null,
      players: [{ id: 'p1', username: 'Alice', role: ROLES.WEREWOLF, alive: true }],
    };
    gameManager.games.set('ch1', game);
    const mockMsg = { edit: jest.fn().mockResolvedValue(true) };
    gameManager.villagePanels.set('ch1', mockMsg);

    await gameManager._refreshVillageMasterPanel('ch1');
    expect(mockMsg.edit).toHaveBeenCalledTimes(1);
    expect(mockMsg.edit).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array),
    }));
  });

  test('_refreshVillageMasterPanel removes panel reference on edit failure', async () => {
    const game = {
      phase: PHASES.NIGHT, subPhase: PHASES.LOUPS, dayCount: 1,
      mainChannelId: 'ch1', guildId: 'g1', captainId: null,
      players: [{ id: 'p1', username: 'Alice', role: ROLES.WEREWOLF, alive: true }],
    };
    gameManager.games.set('ch1', game);
    const mockMsg = { edit: jest.fn().mockRejectedValue(new Error('Unknown Message')) };
    gameManager.villagePanels.set('ch1', mockMsg);
    gameManager._startVillagePanelTick('ch1');

    await gameManager._refreshVillageMasterPanel('ch1');
    expect(gameManager.villagePanels.has('ch1')).toBe(false);
    expect(gameManager._villagePanelTimers.has('ch1')).toBe(false);
  });

  test('destroy clears village panels and timers', () => {
    gameManager._startVillagePanelTick('ch1');
    gameManager.villagePanels.set('ch1', {});
    gameManager.destroy();
    expect(gameManager.villagePanels.size).toBe(0);
    expect(gameManager._villagePanelTimers.size).toBe(0);
  });
});
