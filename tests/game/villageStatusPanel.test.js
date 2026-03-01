/**
 * Tests for game/villageStatusPanel.js — Definitive master GUI panel for #village.
 *
 * Validates:
 * - buildFocusMessage for every phase/subPhase (night, day, ended)
 * - buildNarrationLine for every phase/subPhase (atmospheric narrative)
 * - buildVillageMasterEmbed structure (title, description, fields, image, footer, timestamp)
 * - Definitive layout: narration + focus + timer in description, state + players in fields
 * - Image: phase-driven ambiance (villageNuit.png / villageJour.png)
 * - No secret information leaks (no roles in embed)
 * - Timer presence / absence in description
 * - Footer: simple auto-updating text
 * - Phase color adaptation & animation transitions
 * - Edge cases (empty players, no captain, no dead)
 * - getPhaseImage, buildPlayerList, buildGameState unit tests
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
  buildNarrationLine,
  buildPlayerList,
  buildGameState,
  getPhaseImage,
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

function getDescription(embed) {
  return embed.toJSON().description || '';
}

function getFooter(embed) {
  const f = embed.toJSON().footer;
  return f ? f.text : '';
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
});

// ─── buildNarrationLine ───────────────────────────────────────────

describe('buildNarrationLine', () => {
  test('returns ended narration for ENDED phase', () => {
    const game = createTestGame({ phase: PHASES.ENDED });
    expect(buildNarrationLine(game, 'g1')).toContain('village_panel.narration_ended');
  });

  // Day sub-phases
  test('returns captain vote narration during VOTE_CAPITAINE', () => {
    const game = createTestGame({ phase: PHASES.DAY, subPhase: PHASES.VOTE_CAPITAINE });
    expect(buildNarrationLine(game, 'g1')).toContain('village_panel.narration_captain_vote');
  });

  test('returns deliberation narration during DELIBERATION', () => {
    const game = createTestGame({ phase: PHASES.DAY, subPhase: PHASES.DELIBERATION });
    expect(buildNarrationLine(game, 'g1')).toContain('village_panel.narration_deliberation');
  });

  test('returns vote narration during VOTE', () => {
    const game = createTestGame({ phase: PHASES.DAY, subPhase: PHASES.VOTE });
    expect(buildNarrationLine(game, 'g1')).toContain('village_panel.narration_vote');
  });

  test('returns day narration for unknown day sub-phase', () => {
    const game = createTestGame({ phase: PHASES.DAY, subPhase: 'unknown' });
    expect(buildNarrationLine(game, 'g1')).toContain('village_panel.narration_day');
  });

  // Night sub-phases
  test('returns thief narration during VOLEUR', () => {
    const game = createTestGame({ subPhase: PHASES.VOLEUR });
    expect(buildNarrationLine(game, 'g1')).toContain('village_panel.narration_thief');
  });

  test('returns cupid narration during CUPIDON', () => {
    const game = createTestGame({ subPhase: PHASES.CUPIDON });
    expect(buildNarrationLine(game, 'g1')).toContain('village_panel.narration_cupid');
  });

  test('returns salvateur narration during SALVATEUR', () => {
    const game = createTestGame({ subPhase: PHASES.SALVATEUR });
    expect(buildNarrationLine(game, 'g1')).toContain('village_panel.narration_salvateur');
  });

  test('returns wolves narration during LOUPS', () => {
    const game = createTestGame({ subPhase: PHASES.LOUPS });
    expect(buildNarrationLine(game, 'g1')).toContain('village_panel.narration_wolves');
  });

  test('returns white wolf narration during LOUP_BLANC', () => {
    const game = createTestGame({ subPhase: PHASES.LOUP_BLANC });
    expect(buildNarrationLine(game, 'g1')).toContain('village_panel.narration_white_wolf');
  });

  test('returns witch narration during SORCIERE', () => {
    const game = createTestGame({ subPhase: PHASES.SORCIERE });
    expect(buildNarrationLine(game, 'g1')).toContain('village_panel.narration_witch');
  });

  test('returns seer narration during VOYANTE', () => {
    const game = createTestGame({ subPhase: PHASES.VOYANTE });
    expect(buildNarrationLine(game, 'g1')).toContain('village_panel.narration_seer');
  });

  test('returns wakeup narration during REVEIL', () => {
    const game = createTestGame({ subPhase: PHASES.REVEIL });
    expect(buildNarrationLine(game, 'g1')).toContain('village_panel.narration_wakeup');
  });

  test('returns generic night narration for unknown night sub-phase', () => {
    const game = createTestGame({ subPhase: 'mystery' });
    expect(buildNarrationLine(game, 'g1')).toContain('village_panel.narration_night');
  });
});

// ─── buildVillageMasterEmbed — structure ──────────────────────────

describe('buildVillageMasterEmbed — structure', () => {
  test('has title with phase emoji and day count', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), TIMER, 'g1');
    const json = embed.toJSON();
    expect(json.title).toContain('🌙');
    expect(json.title).toContain('gui.day');
    expect(json.title).toContain('2');
  });

  test('has title with ENDED text when game is over', () => {
    const game = createTestGame({ phase: PHASES.ENDED });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    expect(embed.toJSON().title).toContain('village_panel.title_ended');
  });

  test('has color', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    expect(embed.toJSON().color).toBeDefined();
  });

  test('has timestamp', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    expect(embed.toJSON().timestamp).toBeDefined();
  });

  test('has footer with auto-updating text', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    const footer = getFooter(embed);
    expect(footer).toContain('village_panel.footer');
  });

  test('has description with narration', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    const desc = getDescription(embed);
    expect(desc).toContain('village_panel.narration_wolves');
  });

  test('has description with focus', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    const desc = getDescription(embed);
    expect(desc).toContain('village_panel.focus_wolves');
  });

  test('narration is wrapped in italic markers', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    const desc = getDescription(embed);
    // Mock i18n returns key as-is; narration has no \n so single line
    expect(desc).toContain('*village_panel.narration_wolves*');
  });

  test('has 2 embed fields (state + players) for active game', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), TIMER, 'g1');
    const fields = embed.toJSON().fields || [];
    expect(fields).toHaveLength(2);
    expect(fields[0].name).toContain('village_panel.state_header');
    expect(fields[1].name).toContain('village_panel.players_header');
  });

  test('has only state field when no alive players', () => {
    const game = createTestGame({ players: [] });
    const embed = buildVillageMasterEmbed(game, TIMER, 'g1');
    const fields = embed.toJSON().fields || [];
    expect(fields).toHaveLength(1);
    expect(fields[0].name).toContain('village_panel.state_header');
  });

  test('title uses — em-dash separator between phase and day', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    const title = embed.toJSON().title;
    expect(title).toContain(' — ');
    expect(title).not.toContain(' · ');
  });

  test('sets image attachment for NIGHT phase', () => {
    const embed = buildVillageMasterEmbed(createTestGame({ phase: PHASES.NIGHT }), NO_TIMER, 'g1');
    const json = embed.toJSON();
    expect(json.image).toBeDefined();
    expect(json.image.url).toBe('attachment://villageNuit.png');
  });

  test('sets image attachment for DAY phase', () => {
    const game = createTestGame({ phase: PHASES.DAY, subPhase: PHASES.DELIBERATION });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    const json = embed.toJSON();
    expect(json.image).toBeDefined();
    expect(json.image.url).toBe('attachment://villageJour.png');
  });

  test('no image for ENDED phase', () => {
    const game = createTestGame({ phase: PHASES.ENDED });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    const json = embed.toJSON();
    expect(json.image).toBeUndefined();
  });
});

// ─── Timer ────────────────────────────────────────────────────────

describe('buildVillageMasterEmbed — timer', () => {
  test('shows timer in description when active', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), TIMER, 'g1');
    const desc = getDescription(embed);
    expect(desc).toContain('1:00'); // 60000ms = 1:00
    expect(desc).toContain('⏱');
  });

  test('no timer in description when no timer', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    const desc = getDescription(embed);
    expect(desc).not.toContain('⏱');
  });

  test('no timer in description when remainingMs is 0', () => {
    const expired = { type: 'night', remainingMs: 0, totalMs: 120000 };
    const embed = buildVillageMasterEmbed(createTestGame(), expired, 'g1');
    const desc = getDescription(embed);
    expect(desc).not.toContain('⏱');
  });

  test('timer uses blockquote format', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), TIMER, 'g1');
    const desc = getDescription(embed);
    expect(desc).toContain('> ⏱');
  });
});

// ─── Narration + Focus in description ────────────────────────────

describe('buildVillageMasterEmbed — narration + focus in description', () => {
  test('shows wolves focus during LOUPS', () => {
    const embed = buildVillageMasterEmbed(createTestGame({ subPhase: PHASES.LOUPS }), NO_TIMER, 'g1');
    expect(getDescription(embed)).toContain('village_panel.focus_wolves');
  });

  test('shows vote focus during VOTE', () => {
    const game = createTestGame({ phase: PHASES.DAY, subPhase: PHASES.VOTE });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    expect(getDescription(embed)).toContain('village_panel.focus_vote');
  });

  test('shows ended focus during ENDED', () => {
    const game = createTestGame({ phase: PHASES.ENDED });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    expect(getDescription(embed)).toContain('village_panel.focus_ended');
  });

  test('shows seer focus during VOYANTE', () => {
    const game = createTestGame({ subPhase: PHASES.VOYANTE });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    expect(getDescription(embed)).toContain('village_panel.focus_seer');
  });

  test('narration line is included in description', () => {
    const game = createTestGame({ subPhase: PHASES.LOUPS });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    expect(getDescription(embed)).toContain('village_panel.narration_wolves');
  });

  test('description contains separator', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    expect(getDescription(embed)).toContain('╌╌╌');
  });
});

// ─── Footer: simple auto-update text ──────────────────────────────

describe('buildVillageMasterEmbed — footer', () => {
  test('footer is simple auto-updating text', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    const footer = getFooter(embed);
    expect(footer).toContain('village_panel.footer');
  });

  test('footer does NOT contain alive/dead counts (moved to state field)', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    const footer = getFooter(embed);
    expect(footer).not.toContain('👥');
    expect(footer).not.toContain('💀');
  });

  test('footer does NOT contain captain info (moved to state field)', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    const footer = getFooter(embed);
    expect(footer).not.toContain('👑');
    expect(footer).not.toContain('Alice');
  });
});

// ─── No secrets leaked ───────────────────────────────────────────

describe('buildVillageMasterEmbed — no secrets', () => {
  test('does not contain any role name', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    const json = JSON.stringify(embed.toJSON());
    expect(json).not.toContain(ROLES.WEREWOLF);
    expect(json).not.toContain(ROLES.SEER);
    expect(json).not.toContain(ROLES.WITCH);
    expect(json).not.toContain(ROLES.VILLAGER);
  });

  test('player names appear in fields (player list), not in description', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    const desc = getDescription(embed);
    // Names must NOT be in description (narration/focus area)
    expect(desc).not.toContain('Alice');
    expect(desc).not.toContain('Bob');
    expect(desc).not.toContain('Diana');
    // But alive names MUST be in the players field
    const fields = embed.toJSON().fields || [];
    const playersField = fields.find(f => f.name.includes('village_panel.players_header'));
    expect(playersField).toBeDefined();
    expect(playersField.value).toContain('Alice');
    expect(playersField.value).toContain('Bob');
    expect(playersField.value).toContain('Diana');
    // Dead player must NOT appear
    expect(playersField.value).not.toContain('Charlie');
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
    expect(embed.toJSON().title).toContain('0');
  });

  test('handles null captainId', () => {
    const game = createTestGame({ captainId: null });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    // State field should show captain as '—'
    const fields = embed.toJSON().fields || [];
    const stateField = fields.find(f => f.name.includes('village_panel.state_header'));
    expect(stateField).toBeDefined();
    expect(stateField.value).toContain('—');
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

// ─── getPhaseImage ────────────────────────────────────────────────

describe('getPhaseImage', () => {
  test('returns villageNuit.png for NIGHT', () => {
    expect(getPhaseImage(PHASES.NIGHT)).toBe('villageNuit.png');
  });

  test('returns villageJour.png for DAY', () => {
    expect(getPhaseImage(PHASES.DAY)).toBe('villageJour.png');
  });

  test('returns null for ENDED', () => {
    expect(getPhaseImage(PHASES.ENDED)).toBeNull();
  });

  test('returns null for unknown phase', () => {
    expect(getPhaseImage('mystery')).toBeNull();
  });
});

// ─── buildPlayerList ──────────────────────────────────────────────

describe('buildPlayerList', () => {
  test('lists alive players with ✅ prefix', () => {
    const game = createTestGame();
    const list = buildPlayerList(game);
    expect(list).toContain('✅ Alice');
    expect(list).toContain('✅ Bob');
    expect(list).toContain('✅ Diana');
  });

  test('does not list dead players', () => {
    const game = createTestGame();
    const list = buildPlayerList(game);
    expect(list).not.toContain('Charlie');
  });

  test('shows captain badge 👑 next to captain', () => {
    const game = createTestGame(); // captainId = 'p1' = Alice
    const list = buildPlayerList(game);
    expect(list).toContain('Alice 👑');
  });

  test('no captain badge for non-captain players', () => {
    const game = createTestGame();
    const list = buildPlayerList(game);
    expect(list).not.toContain('Bob 👑');
    expect(list).not.toContain('Diana 👑');
  });

  test('returns em-dash for empty players', () => {
    const game = createTestGame({ players: [] });
    expect(buildPlayerList(game)).toBe('—');
  });

  test('returns em-dash when all players are dead', () => {
    const game = createTestGame({
      players: [
        { id: 'p1', username: 'Alice', role: ROLES.WEREWOLF, alive: false },
        { id: 'p2', username: 'Bob', role: ROLES.SEER, alive: false },
      ],
    });
    expect(buildPlayerList(game)).toBe('—');
  });
});

// ─── buildGameState ───────────────────────────────────────────────

describe('buildGameState', () => {
  test('shows alive count', () => {
    const state = buildGameState(createTestGame(), 'g1');
    expect(state).toContain('👥');
    expect(state).toContain('**3**'); // 3 alive
  });

  test('shows dead count', () => {
    const state = buildGameState(createTestGame(), 'g1');
    expect(state).toContain('☠️');
    expect(state).toContain('**1**'); // 1 dead
  });

  test('shows day count', () => {
    const state = buildGameState(createTestGame(), 'g1');
    expect(state).toContain('📅');
    expect(state).toContain('**2**'); // dayCount = 2
  });

  test('shows captain name', () => {
    const state = buildGameState(createTestGame(), 'g1');
    expect(state).toContain('👑');
    expect(state).toContain('**Alice**');
  });

  test('shows em-dash when no captain', () => {
    const state = buildGameState(createTestGame({ captainId: null }), 'g1');
    expect(state).toContain('👑');
    expect(state).toContain('**—**');
  });

  test('shows em-dash when captain not found in players', () => {
    const state = buildGameState(createTestGame({ captainId: 'nonexistent' }), 'g1');
    expect(state).toContain('👑');
    expect(state).toContain('**—**');
  });

  test('handles empty players', () => {
    const state = buildGameState(createTestGame({ players: [] }), 'g1');
    expect(state).toContain('**0**'); // 0 alive
  });
});

// ─── State + Players fields in embed ──────────────────────────────

describe('buildVillageMasterEmbed — state & players fields', () => {
  test('state field contains alive/dead/day/captain', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    const fields = embed.toJSON().fields || [];
    const stateField = fields.find(f => f.name.includes('village_panel.state_header'));
    expect(stateField).toBeDefined();
    expect(stateField.value).toContain('👥');
    expect(stateField.value).toContain('☠️');
    expect(stateField.value).toContain('📅');
    expect(stateField.value).toContain('👑');
    expect(stateField.inline).toBe(true);
  });

  test('players field shows alive players only', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    const fields = embed.toJSON().fields || [];
    const playersField = fields.find(f => f.name.includes('village_panel.players_header'));
    expect(playersField).toBeDefined();
    expect(playersField.value).toContain('Alice');
    expect(playersField.value).toContain('Bob');
    expect(playersField.value).toContain('Diana');
    expect(playersField.value).not.toContain('Charlie'); // dead
    expect(playersField.inline).toBe(true);
  });

  test('players field has captain badge', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    const fields = embed.toJSON().fields || [];
    const playersField = fields.find(f => f.name.includes('village_panel.players_header'));
    expect(playersField.value).toContain('Alice 👑');
  });
});

// ─── Integration: gameManager village panel methods ───────────────

describe('gameManager village panel integration', () => {
  let gameManager;

  beforeEach(() => {
    jest.resetModules();
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
    expect(gameManager._villagePanelTimers.get('ch1')).toBe(first);
    gameManager._stopVillagePanelTick('ch1');
  });

  test('_stopVillagePanelTick clears interval', () => {
    gameManager._startVillagePanelTick('ch1');
    expect(gameManager._villagePanelTimers.has('ch1')).toBe(true);
    gameManager._stopVillagePanelTick('ch1');
    expect(gameManager._villagePanelTimers.has('ch1')).toBe(false);
  });

  test('_refreshVillageMasterPanel returns silently for unknown game', async () => {
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

// ─── Animated embed features ─────────────────────────────────────

describe('buildVillageMasterEmbed — animation', () => {
  test('uses animated timer bar (contains █ shimmer character)', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), TIMER, 'g1');
    const desc = getDescription(embed);
    expect(desc).toMatch(/[█▓]/);
  });

  test('description contains sub-phase emoji (🐺 for LOUPS)', () => {
    const embed = buildVillageMasterEmbed(createTestGame(), NO_TIMER, 'g1');
    const desc = getDescription(embed);
    expect(desc).toContain('🐺');
  });

  test('title shows sunrise 🌅 during day transition window', () => {
    const game = createTestGame({
      phase: PHASES.DAY,
      subPhase: PHASES.DELIBERATION,
      _lastPhaseChangeAt: Date.now(),
    });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    expect(embed.toJSON().title).toContain('🌅');
  });

  test('title shows normal ☀️ after transition window', () => {
    const game = createTestGame({
      phase: PHASES.DAY,
      subPhase: PHASES.DELIBERATION,
      _lastPhaseChangeAt: Date.now() - 60_000,
    });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    expect(embed.toJSON().title).toContain('☀️');
  });

  test('color is sunrise orange during day transition', () => {
    const game = createTestGame({
      phase: PHASES.DAY,
      subPhase: PHASES.DELIBERATION,
      _lastPhaseChangeAt: Date.now(),
    });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    expect(embed.toJSON().color).toBe(0xFF8C00);
  });

  test('color is sunset navy during night transition', () => {
    const game = createTestGame({
      phase: PHASES.NIGHT,
      subPhase: PHASES.LOUPS,
      _lastPhaseChangeAt: Date.now(),
    });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    expect(embed.toJSON().color).toBe(0x1A1A2E);
  });

  test('color returns to normal after transition expires', () => {
    const game = createTestGame({
      phase: PHASES.NIGHT,
      subPhase: PHASES.LOUPS,
      _lastPhaseChangeAt: Date.now() - 60_000,
    });
    const embed = buildVillageMasterEmbed(game, NO_TIMER, 'g1');
    expect(embed.toJSON().color).toBe(0x2C2F33);
  });
});
