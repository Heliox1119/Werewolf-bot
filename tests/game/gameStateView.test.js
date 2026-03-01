/**
 * Tests for game/gameStateView.js — Pure read-only GUI embed builders.
 *
 * Validates:
 * - Embed structure correctness for all 3 views (status, player, spectator)
 * - Timer display / absence
 * - Role-activation context logic ("your turn" vs "waiting for")
 * - Spectator view does NOT leak roles
 * - Helper functions (formatTime, progressBar, emojis, colors)
 */

const PHASES = require('../../game/phases');
const ROLES = require('../../game/roles');

// Mock i18n — return key name with param substitution
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
  buildStatusEmbed,
  buildPlayerEmbed,
  buildSpectatorEmbed,
  getPhaseEmoji,
  getSubPhaseEmoji,
  getPhaseColor,
  formatTimeRemaining,
  buildProgressBar,
  SUB_PHASE_ACTIVE_ROLES,
} = require('../../game/gameStateView');

// ─── Test helpers ─────────────────────────────────────────────────

function createTestGame(overrides = {}) {
  return {
    mainChannelId: 'ch123',
    guildId: 'g123',
    phase: PHASES.NIGHT,
    subPhase: PHASES.LOUPS,
    dayCount: 2,
    captainId: 'p1',
    spectatorChannelId: 'spec-ch',
    players: [
      { id: 'p1', username: 'Alice', role: ROLES.WEREWOLF, alive: true, inLove: false },
      { id: 'p2', username: 'Bob', role: ROLES.SEER, alive: true, inLove: false },
      { id: 'p3', username: 'Charlie', role: ROLES.VILLAGER, alive: false, inLove: false },
      { id: 'p4', username: 'Diana', role: ROLES.WITCH, alive: true, inLove: true },
    ],
    dead: [
      { id: 'p3', username: 'Charlie', role: ROLES.VILLAGER },
    ],
    ...overrides,
  };
}

function embedFields(embed) {
  return embed.toJSON().fields || [];
}

function findField(embed, namePattern) {
  return embedFields(embed).find(f => f.name.includes(namePattern));
}

// ─── formatTimeRemaining ──────────────────────────────────────────

describe('formatTimeRemaining', () => {
  test('formats 0 as 0:00', () => {
    expect(formatTimeRemaining(0)).toBe('0:00');
  });

  test('formats negative as 0:00', () => {
    expect(formatTimeRemaining(-5000)).toBe('0:00');
  });

  test('formats null as 0:00', () => {
    expect(formatTimeRemaining(null)).toBe('0:00');
  });

  test('formats undefined as 0:00', () => {
    expect(formatTimeRemaining(undefined)).toBe('0:00');
  });

  test('formats 90 seconds as 1:30', () => {
    expect(formatTimeRemaining(90_000)).toBe('1:30');
  });

  test('formats 5 seconds as 0:05', () => {
    expect(formatTimeRemaining(5000)).toBe('0:05');
  });

  test('formats 300 seconds as 5:00', () => {
    expect(formatTimeRemaining(300_000)).toBe('5:00');
  });

  test('formats 1 second as 0:01', () => {
    expect(formatTimeRemaining(1000)).toBe('0:01');
  });

  test('rounds up partial seconds', () => {
    expect(formatTimeRemaining(1500)).toBe('0:02');
  });
});

// ─── buildProgressBar ─────────────────────────────────────────────

describe('buildProgressBar', () => {
  test('full bar', () => {
    expect(buildProgressBar(10, 10, 10)).toBe('▓▓▓▓▓▓▓▓▓▓');
  });

  test('empty bar', () => {
    expect(buildProgressBar(0, 10, 10)).toBe('░░░░░░░░░░');
  });

  test('half bar', () => {
    expect(buildProgressBar(5, 10, 10)).toBe('▓▓▓▓▓░░░░░');
  });

  test('zero total returns empty bar', () => {
    expect(buildProgressBar(5, 0, 10)).toBe('░░░░░░░░░░');
  });

  test('negative total returns empty bar', () => {
    expect(buildProgressBar(5, -1, 10)).toBe('░░░░░░░░░░');
  });

  test('clamps ratio above 1', () => {
    expect(buildProgressBar(15, 10, 10)).toBe('▓▓▓▓▓▓▓▓▓▓');
  });

  test('clamps ratio below 0', () => {
    expect(buildProgressBar(-5, 10, 10)).toBe('░░░░░░░░░░');
  });

  test('custom length', () => {
    expect(buildProgressBar(3, 6, 6)).toBe('▓▓▓░░░');
  });
});

// ─── Emoji helpers ────────────────────────────────────────────────

describe('getPhaseEmoji', () => {
  test('night → 🌙', () => expect(getPhaseEmoji(PHASES.NIGHT)).toBe('🌙'));
  test('day → ☀️', () => expect(getPhaseEmoji(PHASES.DAY)).toBe('☀️'));
  test('ended → 🏁', () => expect(getPhaseEmoji(PHASES.ENDED)).toBe('🏁'));
  test('unknown → ❓', () => expect(getPhaseEmoji('xyz')).toBe('❓'));
});

describe('getSubPhaseEmoji', () => {
  test('loups → 🐺', () => expect(getSubPhaseEmoji(PHASES.LOUPS)).toBe('🐺'));
  test('voyante → 🔮', () => expect(getSubPhaseEmoji(PHASES.VOYANTE)).toBe('🔮'));
  test('vote → 🗳️', () => expect(getSubPhaseEmoji(PHASES.VOTE)).toBe('🗳️'));
  test('deliberation → 💬', () => expect(getSubPhaseEmoji(PHASES.DELIBERATION)).toBe('💬'));
  test('unknown → 🔄', () => expect(getSubPhaseEmoji('xyz')).toBe('🔄'));
});

// ─── getPhaseColor ────────────────────────────────────────────────

describe('getPhaseColor', () => {
  test('night → dark', () => expect(getPhaseColor(PHASES.NIGHT)).toBe(0x2C2F33));
  test('day → yellow', () => expect(getPhaseColor(PHASES.DAY)).toBe(0xF9A825));
  test('ended → red', () => expect(getPhaseColor(PHASES.ENDED)).toBe(0xED4245));
  test('unknown → blurple fallback', () => expect(getPhaseColor('xyz')).toBe(0x5865F2));
});

// ─── SUB_PHASE_ACTIVE_ROLES ──────────────────────────────────────

describe('SUB_PHASE_ACTIVE_ROLES', () => {
  test('LOUPS activates Werewolf + White Wolf', () => {
    expect(SUB_PHASE_ACTIVE_ROLES[PHASES.LOUPS]).toContain(ROLES.WEREWOLF);
    expect(SUB_PHASE_ACTIVE_ROLES[PHASES.LOUPS]).toContain(ROLES.WHITE_WOLF);
  });

  test('VOYANTE activates Seer only', () => {
    expect(SUB_PHASE_ACTIVE_ROLES[PHASES.VOYANTE]).toEqual([ROLES.SEER]);
  });

  test('SORCIERE activates Witch only', () => {
    expect(SUB_PHASE_ACTIVE_ROLES[PHASES.SORCIERE]).toEqual([ROLES.WITCH]);
  });

  test('VOTE is null (all alive players)', () => {
    expect(SUB_PHASE_ACTIVE_ROLES[PHASES.VOTE]).toBeNull();
  });

  test('DELIBERATION is null (all alive players)', () => {
    expect(SUB_PHASE_ACTIVE_ROLES[PHASES.DELIBERATION]).toBeNull();
  });

  test('VOTE_CAPITAINE is null (all alive players)', () => {
    expect(SUB_PHASE_ACTIVE_ROLES[PHASES.VOTE_CAPITAINE]).toBeNull();
  });

  test('REVEIL is empty (transition)', () => {
    expect(SUB_PHASE_ACTIVE_ROLES[PHASES.REVEIL]).toEqual([]);
  });

  test('all subPhases are mapped', () => {
    for (const sp of PHASES.SUB_PHASES) {
      expect(SUB_PHASE_ACTIVE_ROLES).toHaveProperty(sp);
    }
  });
});

// ─── buildStatusEmbed ─────────────────────────────────────────────

describe('buildStatusEmbed', () => {
  test('returns an embed with phase, subPhase, day fields', () => {
    const game = createTestGame();
    const embed = buildStatusEmbed(game, null, 'g123');
    const json = embed.toJSON();

    expect(json.title).toContain('gui.panel_title');

    const phaseField = findField(embed, 'gui.phase');
    expect(phaseField).toBeDefined();
    expect(phaseField.value).toContain(PHASES.NIGHT);

    const subField = findField(embed, 'gui.sub_phase');
    expect(subField).toBeDefined();
    expect(subField.value).toContain(PHASES.LOUPS);

    const dayField = findField(embed, 'gui.day');
    expect(dayField).toBeDefined();
    expect(dayField.value).toContain('2');
  });

  test('shows timer when provided', () => {
    const game = createTestGame();
    const timerInfo = { type: 'night-afk', remainingMs: 90_000, totalMs: 120_000 };
    const embed = buildStatusEmbed(game, timerInfo, 'g123');

    const timerField = findField(embed, 'gui.timer');
    expect(timerField).toBeDefined();
    expect(timerField.value).toContain('1:30');
    expect(timerField.value).toContain('▓'); // progress bar
  });

  test('does not show timer when null', () => {
    const game = createTestGame();
    const embed = buildStatusEmbed(game, null, 'g123');

    const timerField = findField(embed, 'gui.timer');
    expect(timerField).toBeUndefined();
  });

  test('does not show timer when remainingMs is 0', () => {
    const game = createTestGame();
    const embed = buildStatusEmbed(game, { type: 'x', remainingMs: 0, totalMs: 120_000 }, 'g123');

    const timerField = findField(embed, 'gui.timer');
    expect(timerField).toBeUndefined();
  });

  test('shows correct alive/dead counts', () => {
    const game = createTestGame();
    const embed = buildStatusEmbed(game, null, 'g123');

    // 3 alive players, 1 dead
    const aliveField = embedFields(embed).find(f => f.name.includes('gui.alive') && f.inline === true && f.value.includes('3'));
    expect(aliveField).toBeDefined();
  });

  test('shows captain name', () => {
    const game = createTestGame();
    const embed = buildStatusEmbed(game, null, 'g123');

    const captainField = findField(embed, 'gui.captain');
    expect(captainField).toBeDefined();
    expect(captainField.value).toContain('Alice');
  });

  test('shows — when no captain', () => {
    const game = createTestGame({ captainId: null });
    const embed = buildStatusEmbed(game, null, 'g123');

    const captainField = findField(embed, 'gui.captain');
    expect(captainField.value).toBe('—');
  });

  test('shows alive player list with captain badge', () => {
    const game = createTestGame();
    const embed = buildStatusEmbed(game, null, 'g123');

    const listField = findField(embed, 'gui.alive_list');
    expect(listField).toBeDefined();
    expect(listField.value).toContain('Alice');
    expect(listField.value).toContain('👑'); // captain badge
    expect(listField.value).toContain('Bob');
  });

  test('shows dead player list with strikethrough', () => {
    const game = createTestGame();
    const embed = buildStatusEmbed(game, null, 'g123');

    const deadField = findField(embed, 'gui.dead_list');
    expect(deadField).toBeDefined();
    expect(deadField.value).toContain('~~Charlie~~');
  });

  test('uses NIGHT color', () => {
    const game = createTestGame({ phase: PHASES.NIGHT });
    const embed = buildStatusEmbed(game, null, 'g123');
    expect(embed.toJSON().color).toBe(0x2C2F33);
  });

  test('uses DAY color', () => {
    const game = createTestGame({ phase: PHASES.DAY, subPhase: PHASES.DELIBERATION });
    const embed = buildStatusEmbed(game, null, 'g123');
    expect(embed.toJSON().color).toBe(0xF9A825);
  });

  test('uses ENDED color', () => {
    const game = createTestGame({ phase: PHASES.ENDED });
    const embed = buildStatusEmbed(game, null, 'g123');
    expect(embed.toJSON().color).toBe(0xED4245);
  });

  test('has auto-update footer', () => {
    const game = createTestGame();
    const embed = buildStatusEmbed(game, null, 'g123');
    expect(embed.toJSON().footer.text).toContain('gui.footer');
  });

  test('handles empty players array', () => {
    const game = createTestGame({ players: [], dead: [] });
    const embed = buildStatusEmbed(game, null, 'g123');
    expect(embed).toBeDefined();
    // No alive/dead list fields
    const listField = findField(embed, 'gui.alive_list');
    expect(listField).toBeUndefined();
  });
});

// ─── buildPlayerEmbed ─────────────────────────────────────────────

describe('buildPlayerEmbed', () => {
  test('returns null for unknown player', () => {
    const game = createTestGame();
    const embed = buildPlayerEmbed(game, 'unknown_id', null, 'g123');
    expect(embed).toBeNull();
  });

  test('shows role for known player', () => {
    const game = createTestGame();
    const embed = buildPlayerEmbed(game, 'p1', null, 'g123');

    const roleField = findField(embed, 'gui.your_role');
    expect(roleField).toBeDefined();
    expect(roleField.value).toContain(ROLES.WEREWOLF);
  });

  test('shows alive status with green color', () => {
    const game = createTestGame();
    const embed = buildPlayerEmbed(game, 'p1', null, 'g123');
    const json = embed.toJSON();

    expect(json.color).toBe(0x57F287);
    const statusField = findField(embed, 'gui.your_status');
    expect(statusField.value).toContain('gui.alive_status');
  });

  test('shows dead status with red color', () => {
    const game = createTestGame();
    const embed = buildPlayerEmbed(game, 'p3', null, 'g123');
    const json = embed.toJSON();

    expect(json.color).toBe(0xED4245);
    const statusField = findField(embed, 'gui.your_status');
    expect(statusField.value).toContain('gui.dead_status');
  });

  test('shows "your turn" for wolf during LOUPS phase', () => {
    const game = createTestGame({ phase: PHASES.NIGHT, subPhase: PHASES.LOUPS });
    const embed = buildPlayerEmbed(game, 'p1', null, 'g123');

    const contextField = findField(embed, 'gui.context');
    expect(contextField).toBeDefined();
    expect(contextField.value).toContain('gui.your_turn');
  });

  test('shows "waiting" for seer during LOUPS phase', () => {
    const game = createTestGame({ phase: PHASES.NIGHT, subPhase: PHASES.LOUPS });
    const embed = buildPlayerEmbed(game, 'p2', null, 'g123');

    const contextField = findField(embed, 'gui.context');
    expect(contextField).toBeDefined();
    expect(contextField.value).toContain('gui.waiting_for');
  });

  test('shows "your turn" for seer during VOYANTE phase', () => {
    const game = createTestGame({ phase: PHASES.NIGHT, subPhase: PHASES.VOYANTE });
    const embed = buildPlayerEmbed(game, 'p2', null, 'g123');

    const contextField = findField(embed, 'gui.context');
    expect(contextField.value).toContain('gui.your_turn');
  });

  test('shows "your turn" for all alive during VOTE', () => {
    const game = createTestGame({ phase: PHASES.DAY, subPhase: PHASES.VOTE });
    // Bob (seer, alive) should be active during village-wide vote
    const embed = buildPlayerEmbed(game, 'p2', null, 'g123');

    const contextField = findField(embed, 'gui.context');
    expect(contextField.value).toContain('gui.your_turn');
  });

  test('shows "your turn" for all alive during DELIBERATION', () => {
    const game = createTestGame({ phase: PHASES.DAY, subPhase: PHASES.DELIBERATION });
    const embed = buildPlayerEmbed(game, 'p4', null, 'g123');

    const contextField = findField(embed, 'gui.context');
    expect(contextField.value).toContain('gui.your_turn');
  });

  test('shows "your turn" for all alive during VOTE_CAPITAINE', () => {
    const game = createTestGame({ phase: PHASES.DAY, subPhase: PHASES.VOTE_CAPITAINE });
    const embed = buildPlayerEmbed(game, 'p1', null, 'g123');

    const contextField = findField(embed, 'gui.context');
    expect(contextField.value).toContain('gui.your_turn');
  });

  test('shows "waiting" during REVEIL (empty = transition)', () => {
    const game = createTestGame({ phase: PHASES.NIGHT, subPhase: PHASES.REVEIL });
    const embed = buildPlayerEmbed(game, 'p1', null, 'g123');

    const contextField = findField(embed, 'gui.context');
    expect(contextField.value).toContain('gui.waiting_for');
  });

  test('no context for dead player', () => {
    const game = createTestGame();
    const embed = buildPlayerEmbed(game, 'p3', null, 'g123');

    const contextField = findField(embed, 'gui.context');
    expect(contextField).toBeUndefined();
  });

  test('no context for ENDED phase', () => {
    const game = createTestGame({ phase: PHASES.ENDED });
    const embed = buildPlayerEmbed(game, 'p1', null, 'g123');

    const contextField = findField(embed, 'gui.context');
    expect(contextField).toBeUndefined();
  });

  test('shows timer when provided and player is alive', () => {
    const game = createTestGame();
    const timerInfo = { type: 'night-afk', remainingMs: 60_000, totalMs: 120_000 };
    const embed = buildPlayerEmbed(game, 'p1', timerInfo, 'g123');

    const timerField = findField(embed, 'gui.timer');
    expect(timerField).toBeDefined();
    expect(timerField.value).toContain('1:00');
  });

  test('no timer for dead player', () => {
    const game = createTestGame();
    const timerInfo = { type: 'night-afk', remainingMs: 60_000, totalMs: 120_000 };
    const embed = buildPlayerEmbed(game, 'p3', timerInfo, 'g123');

    const timerField = findField(embed, 'gui.timer');
    expect(timerField).toBeUndefined();
  });

  test('shows love indicator for in-love player', () => {
    const game = createTestGame();
    const embed = buildPlayerEmbed(game, 'p4', null, 'g123');

    const loveField = findField(embed, '💘');
    expect(loveField).toBeDefined();
    expect(loveField.value).toContain('gui.in_love');
  });

  test('no love indicator for non-in-love player', () => {
    const game = createTestGame();
    const embed = buildPlayerEmbed(game, 'p1', null, 'g123');

    const loveField = findField(embed, '💘');
    expect(loveField).toBeUndefined();
  });

  test('has private footer', () => {
    const game = createTestGame();
    const embed = buildPlayerEmbed(game, 'p1', null, 'g123');
    expect(embed.toJSON().footer.text).toContain('gui.player_footer');
  });
});

// ─── buildSpectatorEmbed ──────────────────────────────────────────

describe('buildSpectatorEmbed', () => {
  test('does NOT contain any role names', () => {
    const game = createTestGame();
    const embed = buildSpectatorEmbed(game, null, 'g123');
    const json = embed.toJSON();

    const allText = JSON.stringify(json);
    expect(allText).not.toContain(ROLES.WEREWOLF);
    expect(allText).not.toContain(ROLES.SEER);
    expect(allText).not.toContain(ROLES.VILLAGER);
    expect(allText).not.toContain(ROLES.WITCH);
  });

  test('shows player names', () => {
    const game = createTestGame();
    const embed = buildSpectatorEmbed(game, null, 'g123');
    const allText = JSON.stringify(embed.toJSON());

    expect(allText).toContain('Alice');
    expect(allText).toContain('Bob');
    expect(allText).toContain('Charlie');
    expect(allText).toContain('Diana');
  });

  test('shows dead with strikethrough', () => {
    const game = createTestGame();
    const embed = buildSpectatorEmbed(game, null, 'g123');

    const deadField = embedFields(embed).find(f => f.name.includes('gui.dead'));
    expect(deadField).toBeDefined();
    expect(deadField.value).toContain('~~Charlie~~');
  });

  test('shows captain badge on alive list', () => {
    const game = createTestGame();
    const embed = buildSpectatorEmbed(game, null, 'g123');

    const aliveField = embedFields(embed).find(f => f.name.includes('gui.alive'));
    expect(aliveField).toBeDefined();
    expect(aliveField.value).toContain('👑');
  });

  test('shows phase/subPhase/day', () => {
    const game = createTestGame();
    const embed = buildSpectatorEmbed(game, null, 'g123');

    expect(findField(embed, 'gui.phase')).toBeDefined();
    expect(findField(embed, 'gui.sub_phase')).toBeDefined();
    expect(findField(embed, 'gui.day')).toBeDefined();
  });

  test('shows timer when provided', () => {
    const game = createTestGame();
    const timerInfo = { type: 'night-afk', remainingMs: 45_000, totalMs: 120_000 };
    const embed = buildSpectatorEmbed(game, timerInfo, 'g123');

    const timerField = findField(embed, 'gui.timer');
    expect(timerField).toBeDefined();
    expect(timerField.value).toContain('0:45');
  });

  test('no timer when null', () => {
    const game = createTestGame();
    const embed = buildSpectatorEmbed(game, null, 'g123');

    const timerField = findField(embed, 'gui.timer');
    expect(timerField).toBeUndefined();
  });

  test('shows progression bar', () => {
    const game = createTestGame();
    const embed = buildSpectatorEmbed(game, null, 'g123');

    const progField = findField(embed, 'gui.progression');
    expect(progField).toBeDefined();
    expect(progField.value).toContain('gui.eliminated');
    expect(progField.value).toContain('▓');
    expect(progField.value).toContain('25%'); // 1 dead out of 4
  });

  test('has spectator footer', () => {
    const game = createTestGame();
    const embed = buildSpectatorEmbed(game, null, 'g123');
    expect(embed.toJSON().footer.text).toContain('gui.spectator_footer');
  });

  test('uses night color', () => {
    const game = createTestGame({ phase: PHASES.NIGHT });
    const embed = buildSpectatorEmbed(game, null, 'g123');
    expect(embed.toJSON().color).toBe(0x2C2F33);
  });

  test('handles all dead (100% eliminated)', () => {
    const game = createTestGame({
      players: [
        { id: 'p1', username: 'Alice', role: ROLES.WEREWOLF, alive: false, inLove: false },
        { id: 'p2', username: 'Bob', role: ROLES.VILLAGER, alive: false, inLove: false },
      ],
    });
    const embed = buildSpectatorEmbed(game, null, 'g123');
    const progField = findField(embed, 'gui.progression');
    expect(progField.value).toContain('100%');
  });

  test('handles no players', () => {
    const game = createTestGame({ players: [] });
    const embed = buildSpectatorEmbed(game, null, 'g123');
    // Should not crash, no player list fields
    expect(embed).toBeDefined();
    const aliveField = embedFields(embed).find(f => f.name.includes('gui.alive'));
    expect(aliveField).toBeUndefined();
  });
});

// ─── getTimerInfo integration (via gameManager) ───────────────────

describe('getTimerInfo (gameManager)', () => {
  let gameManager;

  beforeEach(() => {
    jest.resetModules();
    gameManager = require('../../game/gameManager');
  });

  afterEach(() => {
    try { gameManager.destroy(); } catch (_) {}
  });

  test('returns null when no game', () => {
    expect(gameManager.getTimerInfo('nonexistent')).toBeNull();
  });

  test('returns null when no active timer', () => {
    gameManager.create('ch-timer-test', { guildId: 'g1' });
    expect(gameManager.getTimerInfo('ch-timer-test')).toBeNull();
  });

  test('returns timer info after scheduling', () => {
    gameManager.create('ch-timer-test2', { guildId: 'g1' });
    const game = gameManager.games.get('ch-timer-test2');
    game._timerDeadline = Date.now() + 60_000;
    game._timerTotalMs = 120_000;
    game._activeTimerType = 'night-afk';

    const info = gameManager.getTimerInfo('ch-timer-test2');
    expect(info).not.toBeNull();
    expect(info.type).toBe('night-afk');
    expect(info.remainingMs).toBeGreaterThan(0);
    expect(info.remainingMs).toBeLessThanOrEqual(60_000);
    expect(info.totalMs).toBe(120_000);
  });
});
