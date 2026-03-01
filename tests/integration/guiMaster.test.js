/**
 * Integration test: GUI_MASTER architecture.
 *
 * Validates the core invariant:
 *   "The GUI is the SOLE visual source of truth.
 *    No phase, subPhase, timer, or player-status information
 *    may be displayed outside a persistent GUI panel."
 *
 * Simulates a complete NIGHT → DAY cycle:
 *   LOUPS → SORCIERE → VOYANTE → REVEIL → DAY
 *   (captain vote → deliberation → vote → night transition)
 *
 * Asserts:
 *   - Zero text sends outside GUI (sendLogged blocks narrative types)
 *   - Village master panel edited N times (never recreated)
 *   - /status creates NO public messages (refresh-only, ephemeral)
 *   - game.uiMode === 'GUI_MASTER' on every game
 *   - ALLOWED_SEND_TYPES whitelist is enforced
 */

const { GameManager } = require('../../game/gameManager');
const PHASES = require('../../game/phases');
const ROLES = require('../../game/roles');
const { cleanupTest } = require('../helpers/testHelpers');

// ─── Mocks ────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────

function makeGM() {
  const gm = new GameManager({ testMode: true });
  const noop = jest.fn();
  gm.db = {
    addVoteIfChanged: noop,
    clearVotes: noop,
    getStats: jest.fn(() => null),
    saveGame: noop,
    saveAllGames: noop,
    getGames: jest.fn(() => []),
    close: noop,
    updateGame: noop,
    updatePlayers: noop,
    getPlayers: jest.fn(() => []),
    addPlayer: noop,
    updatePlayer: noop,
    removePlayer: noop,
    transaction: jest.fn((fn) => fn),
    createGame: jest.fn(() => 1),
    initWitchPotions: noop,
  };
  return gm;
}

function makeGame(overrides = {}) {
  return {
    mainChannelId: 'ch1',
    guildId: 'g1',
    phase: PHASES.NIGHT,
    subPhase: PHASES.LOUPS,
    dayCount: 1,
    captainId: null,
    villageChannelId: 'vc1',
    wolvesChannelId: 'wc1',
    seerChannelId: 'sc1',
    witchChannelId: 'wic1',
    cupidChannelId: null,
    spectatorChannelId: 'spec1',
    lobbyHostId: 'host1',
    lobbyMessageId: null,
    voiceChannelId: null,
    captainVotes: new Map(),
    captainVoters: new Map(),
    lovers: [],
    players: [
      { id: 'p1', username: 'Alice', role: ROLES.WEREWOLF, alive: true },
      { id: 'p2', username: 'Bob', role: ROLES.SEER, alive: true },
      { id: 'p3', username: 'Charlie', role: ROLES.VILLAGER, alive: true },
      { id: 'p4', username: 'Diana', role: ROLES.WITCH, alive: true },
      { id: 'p5', username: 'Eve', role: ROLES.VILLAGER, alive: true },
    ],
    dead: [],
    votes: new Map(),
    voteVoters: new Map(),
    wolfVoters: new Map(),
    wolvesVoteState: { round: 1, votes: new Map(), resolved: false },
    killTarget: null,
    nightVictim: null,
    seerTarget: null,
    witchSave: null,
    witchKill: null,
    witchKillTarget: null,
    hunterTarget: null,
    petiteFilleSpy: null,
    hasUsedLifePotion: false,
    hasUsedDeathPotion: false,
    protectedPlayerId: null,
    lastProtectedPlayerId: null,
    villageRolesPowerless: false,
    rules: { minPlayers: 5, maxPlayers: 10 },
    history: [],
    actionLog: [],
    _atomicActive: false,
    _lastMutationAt: Date.now(),
    stuckStatus: 'OK',
    uiMode: 'GUI_MASTER',
    ...overrides,
  };
}

function makeMockGuild(channelIds) {
  const channels = new Map();
  for (const id of channelIds) {
    channels.set(id, {
      id,
      send: jest.fn(async () => {
        const msg = { id: `msg-${id}`, edit: jest.fn(async () => {}), pin: jest.fn(async () => {}) };
        return msg;
      }),
    });
  }
  return {
    id: 'g1',
    channels: {
      fetch: jest.fn(async (id) => channels.get(id) || null),
      cache: new Map(),
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe('GUI_MASTER Architecture', () => {
  let gm;

  beforeEach(() => {
    gm = makeGM();
  });

  afterEach(() => {
    if (gm) gm.destroy();
    cleanupTest();
  });

  // ─── uiMode flag ─────────────────────────────────────────────

  describe('uiMode flag', () => {
    test('new games are created with uiMode = GUI_MASTER', () => {
      gm.create('test-ch', { guildId: 'g1', lobbyHostId: 'u1' });
      const game = gm.games.get('test-ch');
      expect(game.uiMode).toBe('GUI_MASTER');
    });
  });

  // ─── ALLOWED_SEND_TYPES whitelist ─────────────────────────────

  describe('ALLOWED_SEND_TYPES whitelist', () => {
    test('GameManager.ALLOWED_SEND_TYPES is a Set with known event types', () => {
      expect(GameManager.ALLOWED_SEND_TYPES).toBeInstanceOf(Set);
      expect(GameManager.ALLOWED_SEND_TYPES.has('nightVictim')).toBe(true);
      expect(GameManager.ALLOWED_SEND_TYPES.has('victory')).toBe(true);
      expect(GameManager.ALLOWED_SEND_TYPES.has('summary')).toBe(true);
      expect(GameManager.ALLOWED_SEND_TYPES.has('dayVoteResult')).toBe(true);
    });

    test('narrative types are NOT in the whitelist', () => {
      expect(GameManager.ALLOWED_SEND_TYPES.has('nightStart')).toBe(false);
      expect(GameManager.ALLOWED_SEND_TYPES.has('afkTimeout')).toBe(false);
      expect(GameManager.ALLOWED_SEND_TYPES.has('phaseAnnounce')).toBe(false);
    });
  });

  // ─── sendLogged blocks non-whitelisted types ──────────────────

  describe('sendLogged GUI_MASTER guard', () => {
    test('allows whitelisted event types', async () => {
      const mockChannel = { id: 'ch1', name: 'village', send: jest.fn(async () => ({ id: 'msg1' })) };
      const result = await gm.sendLogged(mockChannel, 'Alice was killed!', { type: 'nightVictim' });
      expect(mockChannel.send).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ id: 'msg1' });
    });

    test('blocks non-whitelisted types and returns null', async () => {
      const mockChannel = { id: 'ch1', name: 'village', send: jest.fn() };
      const result = await gm.sendLogged(mockChannel, 'Night falls!', { type: 'nightStart' });
      expect(mockChannel.send).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    test('blocks afkTimeout type', async () => {
      const mockChannel = { id: 'ch1', name: 'village', send: jest.fn() };
      const result = await gm.sendLogged(mockChannel, 'Time is up!', { type: 'afkTimeout' });
      expect(mockChannel.send).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    test('allows sends with no type (untagged)', async () => {
      const mockChannel = { id: 'ch1', name: 'village', send: jest.fn(async () => ({ id: 'msg2' })) };
      const result = await gm.sendLogged(mockChannel, 'generic message', {});
      expect(mockChannel.send).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ id: 'msg2' });
    });
  });

  // ─── Village master panel: one panel, N edits ─────────────────

  describe('Village master panel: one panel, N edits', () => {
    test('panel is posted once and edited multiple times across phase transitions', async () => {
      const game = makeGame();
      gm.games.set('ch1', game);
      const mockGuild = makeMockGuild(['vc1', 'wc1', 'sc1', 'wic1', 'spec1']);

      // Post the village panel once
      await gm._postVillageMasterPanel(mockGuild, game);
      const panelMsg = gm.villagePanels.get('ch1');
      expect(panelMsg).toBeDefined();
      expect(panelMsg.edit).toBeDefined();

      // Simulate multiple state transitions → each triggers a refresh (edit)
      const transitions = [
        { phase: PHASES.NIGHT, subPhase: PHASES.SORCIERE },
        { phase: PHASES.NIGHT, subPhase: PHASES.VOYANTE },
        { phase: PHASES.NIGHT, subPhase: PHASES.REVEIL },
        { phase: PHASES.DAY, subPhase: PHASES.VOTE_CAPITAINE },
        { phase: PHASES.DAY, subPhase: PHASES.DELIBERATION },
        { phase: PHASES.DAY, subPhase: PHASES.VOTE },
      ];

      for (const t of transitions) {
        game.phase = t.phase;
        game.subPhase = t.subPhase;
        await gm._refreshVillageMasterPanel('ch1');
      }

      // Panel message should have been edited once per transition
      expect(panelMsg.edit).toHaveBeenCalledTimes(transitions.length);
      // Still the same panel reference — never recreated
      expect(gm.villagePanels.get('ch1')).toBe(panelMsg);
    });
  });

  // ─── Full NIGHT → DAY cycle: zero text sends ─────────────────

  describe('Full NIGHT → DAY cycle: zero narrative sends', () => {
    test('complete cycle produces no narrative channel.send() calls', async () => {
      const game = makeGame();
      gm.games.set('ch1', game);

      // Track ALL sendLogged calls
      const sendLoggedSpy = jest.spyOn(gm, 'sendLogged');

      // Mock guild for panel posting
      const mockGuild = makeMockGuild(['vc1', 'wc1', 'sc1', 'wic1', 'spec1']);

      // Post initial panels (game start)
      gm._guiPostingInProgress.add('ch1');
      await gm._postVillageMasterPanel(mockGuild, game);
      await gm._postSpectatorPanel(mockGuild, game);
      gm._guiPostingInProgress.delete('ch1');

      // Night sub-phase transitions via _emitGameEvent + _refreshAllGui
      const nightSubPhases = [
        PHASES.LOUPS, PHASES.SORCIERE, PHASES.VOYANTE, PHASES.REVEIL,
      ];

      for (const sub of nightSubPhases) {
        game.subPhase = sub;
        gm._emitGameEvent(game, 'subPhaseChanged', { subPhase: sub });
        // Drain setImmediate queue
        await new Promise(resolve => setImmediate(resolve));
      }

      // Transition to day
      game.phase = PHASES.DAY;
      game.subPhase = PHASES.VOTE_CAPITAINE;
      gm._emitGameEvent(game, 'phaseChanged', { phase: PHASES.DAY });
      await new Promise(resolve => setImmediate(resolve));

      // Day sub-phase transitions
      game.subPhase = PHASES.DELIBERATION;
      gm._emitGameEvent(game, 'subPhaseChanged', { subPhase: PHASES.DELIBERATION });
      await new Promise(resolve => setImmediate(resolve));

      game.subPhase = PHASES.VOTE;
      gm._emitGameEvent(game, 'subPhaseChanged', { subPhase: PHASES.VOTE });
      await new Promise(resolve => setImmediate(resolve));

      // Assert: sendLogged was NEVER called with a narrative/status type
      // (all events trigger _refreshAllGui → .edit(), not sendLogged)
      const sendCalls = sendLoggedSpy.mock.calls;
      for (const call of sendCalls) {
        const ctx = call[2] || {};
        if (ctx.type) {
          // Every typed send must be in the whitelist
          expect(GameManager.ALLOWED_SEND_TYPES.has(ctx.type)).toBe(true);
        }
      }

      // The village panel must have been edited (not just posted)
      const panelMsg = gm.villagePanels.get('ch1');
      expect(panelMsg.edit.mock.calls.length).toBeGreaterThan(0);

      sendLoggedSpy.mockRestore();
    });
  });

  // ─── /status command: refresh-only, no new public messages ────

  describe('/status is refresh-only', () => {
    test('/status module does not import buildStatusEmbed or buildSpectatorEmbed', () => {
      // Verify the /status command file does not use public embed builders
      const statusCommand = require('../../commands/status');
      const source = require('fs').readFileSync(
        require('path').join(__dirname, '..', '..', 'commands', 'status.js'),
        'utf-8'
      );

      // Must NOT contain buildStatusEmbed or buildSpectatorEmbed imports
      expect(source).not.toContain('buildStatusEmbed');
      expect(source).not.toContain('buildSpectatorEmbed');

      // Must contain _refreshAllGui call
      expect(source).toContain('_refreshAllGui');

      // Must reply ephemeral
      expect(source).toContain('Ephemeral');
    });
  });

  // ─── Event types whitelist coverage ───────────────────────────

  describe('Whitelist coverage for remaining sendLogged calls', () => {
    test('every sendLogged type in gameManager.js is in ALLOWED_SEND_TYPES or blocked', () => {
      // Read the source and extract all { type: '...' } patterns
      const source = require('fs').readFileSync(
        require('path').join(__dirname, '..', '..', 'game', 'gameManager.js'),
        'utf-8'
      );
      const typeMatches = source.matchAll(/type:\s*'([^']+)'/g);
      const allTypes = new Set([...typeMatches].map(m => m[1]));

      // Known blocked types (narrative/status) — these are suppressed by the guard
      const KNOWN_BLOCKED = new Set([
        'nightStart', 'afkTimeout', 'phaseAnnounce',
      ]);

      for (const t of allTypes) {
        const isAllowed = GameManager.ALLOWED_SEND_TYPES.has(t);
        const isBlocked = KNOWN_BLOCKED.has(t);
        // Every type must be either allowed or known-blocked
        expect(isAllowed || isBlocked).toBe(true);
      }
    });
  });

  // ─── announcePhase is a no-op ─────────────────────────────────

  describe('announcePhase is fully suppressed', () => {
    test('announcePhase returns immediately (no channel.send)', async () => {
      const game = makeGame();
      gm.games.set('ch1', game);
      const mockGuild = makeMockGuild(['vc1']);

      // announcePhase should be a no-op
      await gm.announcePhase(mockGuild, game, 'This should not be sent');

      // Verify no channel.send was called
      const vc1 = await mockGuild.channels.fetch('vc1');
      expect(vc1.send).not.toHaveBeenCalled();
    });
  });
});
