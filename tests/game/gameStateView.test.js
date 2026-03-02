/**
 * Tests for game/gameStateView.js — Pure read-only GUI embed builders.
 *
 * Validates:
 * - Embed structure correctness for all 3 views (status, player, spectator)
 * - Description-first layout: phase/timer in description, player lists in fields
 * - Timer display / absence
 * - Role-activation context logic ("your turn" vs "waiting for")
 * - Spectator view does NOT leak roles
 * - Helper functions (formatTime, progressBar, emojis, colors)
 * - Animation helpers
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
  // Animation helpers
  getAnimationFrame,
  buildAnimatedTimerBar,
  getAnimatedSubPhaseEmoji,
  getTransitionEmoji,
  getTransitionColor,
  TRANSITION_DURATION_MS,
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

function getDescription(embed) {
  return embed.toJSON().description || '';
}

function getFooter(embed) {
  const f = embed.toJSON().footer;
  return f ? f.text : '';
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
  test('returns an embed with title containing panel_title and day count', () => {
    const game = createTestGame();
    const embed = buildStatusEmbed(game, null, 'g123');
    const json = embed.toJSON();
    expect(json.title).toContain('gui.panel_title');
    expect(json.title).toContain('gui.day');
    expect(json.title).toContain('2');
  });

  test('description contains phase and sub-phase names', () => {
    const game = createTestGame();
    const embed = buildStatusEmbed(game, null, 'g123');
    const desc = getDescription(embed);
    expect(desc).toContain(PHASES.NIGHT);
    expect(desc).toContain(PHASES.LOUPS);
  });

  test('shows timer in description when provided', () => {
    const game = createTestGame();
    const timerInfo = { type: 'night-afk', remainingMs: 90_000, totalMs: 120_000 };
    const embed = buildStatusEmbed(game, timerInfo, 'g123');
    const desc = getDescription(embed);
    expect(desc).toContain('1:30');
    expect(desc).toContain('▓'); // progress bar
  });

  test('does not show timer when null', () => {
    const game = createTestGame();
    const embed = buildStatusEmbed(game, null, 'g123');
    const desc = getDescription(embed);
    expect(desc).not.toContain('⏱');
  });

  test('does not show timer when remainingMs is 0', () => {
    const game = createTestGame();
    const embed = buildStatusEmbed(game, { type: 'x', remainingMs: 0, totalMs: 120_000 }, 'g123');
    const desc = getDescription(embed);
    expect(desc).not.toContain('⏱');
  });

  test('shows alive player list as a field', () => {
    const game = createTestGame();
    const embed = buildStatusEmbed(game, null, 'g123');
    const aliveField = findField(embed, 'gui.alive');
    expect(aliveField).toBeDefined();
    expect(aliveField.value).toContain('Alice');
    expect(aliveField.value).toContain('👑'); // captain badge
    expect(aliveField.value).toContain('Bob');
  });

  test('shows dead player list with strikethrough', () => {
    const game = createTestGame();
    const embed = buildStatusEmbed(game, null, 'g123');
    const deadField = findField(embed, 'gui.dead');
    expect(deadField).toBeDefined();
    expect(deadField.value).toContain('~~Charlie~~');
  });

  test('shows captain name in footer', () => {
    const game = createTestGame();
    const embed = buildStatusEmbed(game, null, 'g123');
    const footer = getFooter(embed);
    expect(footer).toContain('gui.captain');
    expect(footer).toContain('Alice');
  });

  test('shows — when no captain', () => {
    const game = createTestGame({ captainId: null });
    const embed = buildStatusEmbed(game, null, 'g123');
    const footer = getFooter(embed);
    expect(footer).toContain('—');
  });

  test('uses NIGHT color', () => {
    const game = createTestGame({ phase: PHASES.NIGHT });
    const embed = buildStatusEmbed(game, null, 'g123');
    expect(embed.toJSON().color).toBe(0x2C2F33);
  });

  test('uses DAY color', () => {
    const game = createTestGame({ phase: PHASES.DAY, subPhase: PHASES.VOTE });
  });

  test('uses ENDED color', () => {
    const game = createTestGame({ phase: PHASES.ENDED });
    const embed = buildStatusEmbed(game, null, 'g123');
    expect(embed.toJSON().color).toBe(0xED4245);
  });

  test('handles empty players array', () => {
    const game = createTestGame({ players: [], dead: [] });
    const embed = buildStatusEmbed(game, null, 'g123');
    expect(embed).toBeDefined();
    const listField = findField(embed, 'gui.alive');
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

  test('description shows role for known player', () => {
    const game = createTestGame();
    const embed = buildPlayerEmbed(game, 'p1', null, 'g123');
    const desc = getDescription(embed);
    expect(desc).toContain(ROLES.WEREWOLF);
  });

  test('shows alive status with green color', () => {
    const game = createTestGame();
    const embed = buildPlayerEmbed(game, 'p1', null, 'g123');
    expect(embed.toJSON().color).toBe(0x57F287);
    expect(getDescription(embed)).toContain('gui.alive_status');
  });

  test('shows dead status with red color', () => {
    const game = createTestGame();
    const embed = buildPlayerEmbed(game, 'p3', null, 'g123');
    expect(embed.toJSON().color).toBe(0xED4245);
    expect(getDescription(embed)).toContain('gui.dead_status');
  });

  test('shows "your turn" for wolf during LOUPS phase', () => {
    const game = createTestGame({ phase: PHASES.NIGHT, subPhase: PHASES.LOUPS });
    const embed = buildPlayerEmbed(game, 'p1', null, 'g123');
    expect(getDescription(embed)).toContain('gui.your_turn');
  });

  test('shows "waiting" for seer during LOUPS phase', () => {
    const game = createTestGame({ phase: PHASES.NIGHT, subPhase: PHASES.LOUPS });
    const embed = buildPlayerEmbed(game, 'p2', null, 'g123');
    expect(getDescription(embed)).toContain('gui.waiting_for');
  });

  test('shows "your turn" for seer during VOYANTE phase', () => {
    const game = createTestGame({ phase: PHASES.NIGHT, subPhase: PHASES.VOYANTE });
    const embed = buildPlayerEmbed(game, 'p2', null, 'g123');
    expect(getDescription(embed)).toContain('gui.your_turn');
  });

  test('shows "your turn" for all alive during VOTE', () => {
    const game = createTestGame({ phase: PHASES.DAY, subPhase: PHASES.VOTE });
    const embed = buildPlayerEmbed(game, 'p2', null, 'g123');
    expect(getDescription(embed)).toContain('gui.your_turn');
  });

  test('shows "your turn" for all alive during VOTE_CAPITAINE', () => {
    const game = createTestGame({ phase: PHASES.DAY, subPhase: PHASES.VOTE_CAPITAINE });
    const embed = buildPlayerEmbed(game, 'p1', null, 'g123');
    expect(getDescription(embed)).toContain('gui.your_turn');
  });

  test('shows "waiting" during REVEIL (empty = transition)', () => {
    const game = createTestGame({ phase: PHASES.NIGHT, subPhase: PHASES.REVEIL });
    const embed = buildPlayerEmbed(game, 'p1', null, 'g123');
    expect(getDescription(embed)).toContain('gui.waiting_for');
  });

  test('no context for dead player', () => {
    const game = createTestGame();
    const embed = buildPlayerEmbed(game, 'p3', null, 'g123');
    expect(getDescription(embed)).not.toContain('gui.your_turn');
    expect(getDescription(embed)).not.toContain('gui.waiting_for');
  });

  test('no context for ENDED phase', () => {
    const game = createTestGame({ phase: PHASES.ENDED });
    const embed = buildPlayerEmbed(game, 'p1', null, 'g123');
    expect(getDescription(embed)).not.toContain('gui.your_turn');
    expect(getDescription(embed)).not.toContain('gui.waiting_for');
  });

  test('shows timer in description when provided and player is alive', () => {
    const game = createTestGame();
    const timerInfo = { type: 'night-afk', remainingMs: 60_000, totalMs: 120_000 };
    const embed = buildPlayerEmbed(game, 'p1', timerInfo, 'g123');
    expect(getDescription(embed)).toContain('1:00');
  });

  test('no timer for dead player', () => {
    const game = createTestGame();
    const timerInfo = { type: 'night-afk', remainingMs: 60_000, totalMs: 120_000 };
    const embed = buildPlayerEmbed(game, 'p3', timerInfo, 'g123');
    expect(getDescription(embed)).not.toContain('⏱');
  });

  test('shows love indicator for in-love player', () => {
    const game = createTestGame();
    const embed = buildPlayerEmbed(game, 'p4', null, 'g123');
    expect(getDescription(embed)).toContain('gui.in_love');
    expect(getDescription(embed)).toContain('💘');
  });

  test('no love indicator for non-in-love player', () => {
    const game = createTestGame();
    const embed = buildPlayerEmbed(game, 'p1', null, 'g123');
    expect(getDescription(embed)).not.toContain('gui.in_love');
  });

  test('has private footer', () => {
    const game = createTestGame();
    const embed = buildPlayerEmbed(game, 'p1', null, 'g123');
    expect(getFooter(embed)).toContain('gui.player_footer');
  });
});

// ─── buildSpectatorEmbed ──────────────────────────────────────────

describe('buildSpectatorEmbed', () => {
  test('does NOT contain any role names', () => {
    const game = createTestGame();
    const embed = buildSpectatorEmbed(game, null, 'g123');
    const allText = JSON.stringify(embed.toJSON());
    expect(allText).not.toContain(ROLES.WEREWOLF);
    expect(allText).not.toContain(ROLES.SEER);
    expect(allText).not.toContain(ROLES.VILLAGER);
    expect(allText).not.toContain(ROLES.WITCH);
  });

  test('shows player names in fields', () => {
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
    const deadField = findField(embed, 'gui.dead');
    expect(deadField).toBeDefined();
    expect(deadField.value).toContain('~~Charlie~~');
  });

  test('shows captain badge on alive list', () => {
    const game = createTestGame();
    const embed = buildSpectatorEmbed(game, null, 'g123');
    const aliveField = findField(embed, 'gui.alive');
    expect(aliveField).toBeDefined();
    expect(aliveField.value).toContain('👑');
  });

  test('description has phase and sub-phase', () => {
    const game = createTestGame();
    const embed = buildSpectatorEmbed(game, null, 'g123');
    const desc = getDescription(embed);
    expect(desc).toContain(PHASES.NIGHT);
    expect(desc).toContain(PHASES.LOUPS);
  });

  test('description has day count', () => {
    const game = createTestGame();
    const embed = buildSpectatorEmbed(game, null, 'g123');
    const desc = getDescription(embed);
    expect(desc).toContain('gui.day');
    expect(desc).toContain('2');
  });

  test('shows timer in description when provided', () => {
    const game = createTestGame();
    const timerInfo = { type: 'night-afk', remainingMs: 45_000, totalMs: 120_000 };
    const embed = buildSpectatorEmbed(game, timerInfo, 'g123');
    const desc = getDescription(embed);
    expect(desc).toContain('0:45');
  });

  test('no timer when null', () => {
    const game = createTestGame();
    const embed = buildSpectatorEmbed(game, null, 'g123');
    const desc = getDescription(embed);
    expect(desc).not.toContain('⏱');
  });

  test('has spectator footer', () => {
    const game = createTestGame();
    const embed = buildSpectatorEmbed(game, null, 'g123');
    expect(getFooter(embed)).toContain('gui.spectator_footer');
  });

  test('uses night color', () => {
    const game = createTestGame({ phase: PHASES.NIGHT });
    const embed = buildSpectatorEmbed(game, null, 'g123');
    expect(embed.toJSON().color).toBe(0x2C2F33);
  });

  test('handles no players', () => {
    const game = createTestGame({ players: [] });
    const embed = buildSpectatorEmbed(game, null, 'g123');
    expect(embed).toBeDefined();
    const aliveField = findField(embed, 'gui.alive');
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

// ─── Animation Helpers ────────────────────────────────────────────

describe('getAnimationFrame', () => {
  test('returns integer 0-5', () => {
    const frame = getAnimationFrame(0);
    expect(Number.isInteger(frame)).toBe(true);
    expect(frame).toBeGreaterThanOrEqual(0);
    expect(frame).toBeLessThanOrEqual(5);
  });

  test('cycles every 5 seconds', () => {
    const f0 = getAnimationFrame(0);
    const f1 = getAnimationFrame(5000);
    const f2 = getAnimationFrame(10000);
    expect(f0).not.toBe(f1);
    expect(f1).not.toBe(f2);
  });

  test('wraps around after 6 frames (30 s)', () => {
    const f0 = getAnimationFrame(0);
    const fWrap = getAnimationFrame(30_000);
    expect(f0).toBe(fWrap);
  });
});

describe('buildAnimatedTimerBar', () => {
  test('returns all empty when totalMs is 0', () => {
    expect(buildAnimatedTimerBar(0, 0, 10)).toBe('░'.repeat(10));
  });

  test('returns all empty when remainingMs is 0', () => {
    expect(buildAnimatedTimerBar(0, 60000, 10)).toBe('░'.repeat(10));
  });

  test('full bar contains one shimmer character', () => {
    const bar = buildAnimatedTimerBar(60000, 60000, 10, 0);
    expect(bar).toHaveLength(10);
    const shimmerCount = (bar.match(/▓/g) || []).length;
    const fillCount = (bar.match(/█/g) || []).length;
    expect(shimmerCount).toBe(1);
    expect(fillCount).toBe(9);
  });

  test('shimmer position changes with different frames', () => {
    const bar1 = buildAnimatedTimerBar(60000, 60000, 10, 0);
    const bar2 = buildAnimatedTimerBar(60000, 60000, 10, 5000);
    expect(bar1).not.toBe(bar2);
  });

  test('partial bar has correct filled/empty ratio', () => {
    const bar = buildAnimatedTimerBar(30000, 60000, 10, 0);
    const filled = (bar.match(/[█▓]/g) || []).length;
    const empty = (bar.match(/░/g) || []).length;
    expect(filled).toBe(5);
    expect(empty).toBe(5);
  });

  test('bar length matches requested length', () => {
    expect(buildAnimatedTimerBar(60000, 60000, 16, 0)).toHaveLength(16);
    expect(buildAnimatedTimerBar(30000, 60000, 8, 0)).toHaveLength(8);
  });
});

describe('getAnimatedSubPhaseEmoji', () => {
  test('returns base emoji on even frames', () => {
    const emoji = getAnimatedSubPhaseEmoji(PHASES.LOUPS, 0);
    expect(emoji).toBe('🐺');
    expect(emoji).not.toContain('✨');
  });

  test('returns emoji + sparkle on odd frames', () => {
    const emoji = getAnimatedSubPhaseEmoji(PHASES.LOUPS, 5000);
    expect(emoji).toContain('🐺');
    expect(emoji).toContain('✨');
  });

  test('alternates between frames', () => {
    const even = getAnimatedSubPhaseEmoji(PHASES.VOYANTE, 0);
    const odd = getAnimatedSubPhaseEmoji(PHASES.VOYANTE, 5000);
    expect(even).not.toBe(odd);
  });

  test('works for all known sub-phases', () => {
    for (const sp of PHASES.SUB_PHASES) {
      const emoji = getAnimatedSubPhaseEmoji(sp, 0);
      expect(typeof emoji).toBe('string');
      expect(emoji.length).toBeGreaterThan(0);
    }
  });
});

describe('getTransitionEmoji', () => {
  test('returns sunrise 🌅 during DAY transition window', () => {
    const now = 10_000;
    const lastChange = 5_000;
    expect(getTransitionEmoji(PHASES.DAY, lastChange, now)).toBe('🌅');
  });

  test('returns new moon 🌑 during NIGHT transition window', () => {
    const now = 10_000;
    const lastChange = 5_000;
    expect(getTransitionEmoji(PHASES.NIGHT, lastChange, now)).toBe('🌑');
  });

  test('returns normal emoji after transition window expires', () => {
    const now = 100_000;
    const lastChange = 10_000;
    expect(getTransitionEmoji(PHASES.DAY, lastChange, now)).toBe('☀️');
    expect(getTransitionEmoji(PHASES.NIGHT, lastChange, now)).toBe('🌙');
  });

  test('returns normal emoji when lastPhaseChangeAt is null', () => {
    expect(getTransitionEmoji(PHASES.DAY, null, 10_000)).toBe('☀️');
    expect(getTransitionEmoji(PHASES.NIGHT, null, 10_000)).toBe('🌙');
  });

  test('ENDED always returns flag', () => {
    expect(getTransitionEmoji(PHASES.ENDED, Date.now(), Date.now())).toBe('🏁');
  });
});

describe('getTransitionColor', () => {
  test('returns sunrise orange during DAY transition', () => {
    const now = 10_000;
    expect(getTransitionColor(PHASES.DAY, 5_000, 'g1', now)).toBe(0xFF8C00);
  });

  test('returns sunset navy during NIGHT transition', () => {
    const now = 10_000;
    expect(getTransitionColor(PHASES.NIGHT, 5_000, 'g1', now)).toBe(0x1A1A2E);
  });

  test('returns normal color after transition window', () => {
    const now = 100_000;
    expect(getTransitionColor(PHASES.DAY, 10_000, 'g1', now)).toBe(0xF9A825);
    expect(getTransitionColor(PHASES.NIGHT, 10_000, 'g1', now)).toBe(0x2C2F33);
  });

  test('returns normal color when lastPhaseChangeAt is null', () => {
    expect(getTransitionColor(PHASES.DAY, null, 'g1', 10_000)).toBe(0xF9A825);
  });
});

describe('TRANSITION_DURATION_MS', () => {
  test('is 30 seconds', () => {
    expect(TRANSITION_DURATION_MS).toBe(30_000);
  });
});
