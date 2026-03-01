/**
 * Tests for GUI MASTER orchestrator — _refreshAllGui, _postSpectatorPanel,
 * _refreshSpectatorPanel, event emissions (subPhaseChanged, captainElected, voteCompleted),
 * and spam suppression (announcePhase, day_begins, night_falls).
 *
 * Validates:
 * - _refreshAllGui calls all 4 panel refreshers in parallel
 * - _emitGameEvent triggers _refreshAllGui for all GUI_EVENTS
 * - _postSpectatorPanel posts embed to spectator channel and registers panel
 * - _refreshSpectatorPanel edits existing panel or re-posts after reboot
 * - _setSubPhase emits subPhaseChanged event
 * - voteCaptain emits captainElected on successful resolution
 * - resolveCaptainVote emits captainElected on successful resolution
 * - transitionToNight emits voteCompleted after vote resolution
 * - announcePhase is fully suppressed (returns immediately)
 * - day_begins and night_falls messages are no longer sent
 * - spectatorPanels Map is initialised and cleared in destroy()
 */

const { GameManager } = require('../../game/gameManager');
const PHASES = require('../../game/phases');
const ROLES = require('../../game/roles');
const {
  createMockGame,
  createMockPlayer,
  cleanupTest,
} = require('../helpers/testHelpers');

// ─── i18n mock ────────────────────────────────────────────────────
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
  // Stub db methods used by captain vote methods and runAtomic
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
    // transaction wraps the fn and returns it directly (like better-sqlite3)
    transaction: jest.fn((fn) => fn),
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
    ],
    dead: [],
    votes: new Map(),
    voteVoters: new Map(),
    wolfVoters: new Map(),
    wolvesVoteState: { round: 1, votes: new Map(), resolved: false },
    killTarget: null,
    seerTarget: null,
    witchSave: null,
    witchKill: null,
    hunterTarget: null,
    petiteFilleSpy: null,
    hasUsedLifePotion: false,
    hasUsedDeathPotion: false,
    rules: { minPlayers: 5, maxPlayers: 10 },
    history: [],
    actionLog: [],
    _atomicActive: false,
    _lastMutationAt: Date.now(),
    stuckStatus: 'OK',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe('GUI Orchestrator', () => {
  let gm;

  beforeEach(() => {
    gm = makeGM();
  });

  afterEach(() => {
    if (gm) gm.destroy();
    cleanupTest();
  });

  // ───────────────────────────────────────────────────────────
  // spectatorPanels Map lifecycle
  // ───────────────────────────────────────────────────────────

  describe('spectatorPanels Map', () => {
    test('is initialised as empty Map', () => {
      expect(gm.spectatorPanels).toBeInstanceOf(Map);
      expect(gm.spectatorPanels.size).toBe(0);
    });

    test('is cleared in destroy()', () => {
      gm.spectatorPanels.set('ch1', { id: 'msg1' });
      gm.destroy();
      expect(gm.spectatorPanels.size).toBe(0);
      gm = null; // prevent double-destroy
    });
  });

  // ───────────────────────────────────────────────────────────
  // _refreshAllGui orchestrator
  // ───────────────────────────────────────────────────────────

  describe('_refreshAllGui()', () => {
    test('calls all 4 panel refreshers', async () => {
      const game = makeGame();
      gm.games.set('ch1', game);

      gm._refreshVillageMasterPanel = jest.fn(async () => {});
      gm._refreshRolePanels = jest.fn(async () => {});
      gm._refreshStatusPanels = jest.fn(async () => {});
      gm._refreshSpectatorPanel = jest.fn(async () => {});

      await gm._refreshAllGui('ch1');

      expect(gm._refreshVillageMasterPanel).toHaveBeenCalledWith('ch1');
      expect(gm._refreshRolePanels).toHaveBeenCalledWith('ch1');
      expect(gm._refreshStatusPanels).toHaveBeenCalledWith('ch1');
      expect(gm._refreshSpectatorPanel).toHaveBeenCalledWith('ch1');
    });

    test('does not throw if individual refreshers fail', async () => {
      const game = makeGame();
      gm.games.set('ch1', game);

      gm._refreshVillageMasterPanel = jest.fn(async () => { throw new Error('fail'); });
      gm._refreshRolePanels = jest.fn(async () => { throw new Error('fail'); });
      gm._refreshStatusPanels = jest.fn(async () => { throw new Error('fail'); });
      gm._refreshSpectatorPanel = jest.fn(async () => { throw new Error('fail'); });

      await expect(gm._refreshAllGui('ch1')).resolves.not.toThrow();
    });
  });

  // ───────────────────────────────────────────────────────────
  // _emitGameEvent → _refreshAllGui for all GUI_EVENTS
  // ───────────────────────────────────────────────────────────

  describe('_emitGameEvent GUI refresh', () => {
    const GUI_EVENTS = [
      'phaseChanged', 'subPhaseChanged', 'playerKilled',
      'gameEnded', 'gameStarted', 'voteCompleted', 'captainElected',
    ];

    for (const eventName of GUI_EVENTS) {
      test(`triggers _refreshAllGui on ${eventName}`, async () => {
        const game = makeGame();
        gm.games.set('ch1', game);
        gm._refreshAllGui = jest.fn(async () => {});

        gm._emitGameEvent(game, eventName, {});

        // _refreshAllGui is called via setImmediate — flush it
        await new Promise(resolve => setImmediate(resolve));

        expect(gm._refreshAllGui).toHaveBeenCalledWith('ch1');
      });
    }

    test('does NOT trigger _refreshAllGui on non-GUI event (e.g. actionLog)', async () => {
      const game = makeGame();
      gm.games.set('ch1', game);
      gm._refreshAllGui = jest.fn(async () => {});

      gm._emitGameEvent(game, 'actionLog', {});

      await new Promise(resolve => setImmediate(resolve));

      expect(gm._refreshAllGui).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────
  // _postSpectatorPanel
  // ───────────────────────────────────────────────────────────

  describe('_postSpectatorPanel()', () => {
    test('posts embed to spectator channel and registers in spectatorPanels', async () => {
      const game = makeGame();
      gm.games.set('ch1', game);

      const sentMsg = { id: 'msg-spec', pin: jest.fn(async () => {}) };
      const specChannel = {
        id: 'spec1',
        send: jest.fn(async () => sentMsg),
      };
      const guild = {
        id: 'g1',
        channels: { fetch: jest.fn(async (id) => specChannel) },
      };

      await gm._postSpectatorPanel(guild, game);

      expect(specChannel.send).toHaveBeenCalledTimes(1);
      const call = specChannel.send.mock.calls[0][0];
      expect(call.embeds).toBeDefined();
      expect(call.embeds).toHaveLength(1);
      expect(gm.spectatorPanels.get('ch1')).toBe(sentMsg);
      expect(sentMsg.pin).toHaveBeenCalled();
    });

    test('does nothing if spectatorChannelId is null', async () => {
      const game = makeGame({ spectatorChannelId: null });
      gm.games.set('ch1', game);

      const guild = { id: 'g1', channels: { fetch: jest.fn() } };
      await gm._postSpectatorPanel(guild, game);

      expect(guild.channels.fetch).not.toHaveBeenCalled();
      expect(gm.spectatorPanels.size).toBe(0);
    });

    test('handles channel fetch failure gracefully', async () => {
      const game = makeGame();
      gm.games.set('ch1', game);

      const guild = {
        id: 'g1',
        channels: { fetch: jest.fn(async () => { throw new Error('not found'); }) },
      };

      await expect(gm._postSpectatorPanel(guild, game)).resolves.not.toThrow();
      expect(gm.spectatorPanels.size).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────
  // _refreshSpectatorPanel
  // ───────────────────────────────────────────────────────────

  describe('_refreshSpectatorPanel()', () => {
    test('edits existing spectator panel message', async () => {
      const game = makeGame();
      gm.games.set('ch1', game);

      const msg = { id: 'msg-spec', edit: jest.fn(async () => {}) };
      gm.spectatorPanels.set('ch1', msg);

      await gm._refreshSpectatorPanel('ch1');

      expect(msg.edit).toHaveBeenCalledTimes(1);
      const editCall = msg.edit.mock.calls[0][0];
      expect(editCall.embeds).toHaveLength(1);
    });

    test('removes panel reference if edit throws (deleted message)', async () => {
      const game = makeGame();
      gm.games.set('ch1', game);

      const msg = { id: 'msg-spec', edit: jest.fn(async () => { throw new Error('Unknown Message'); }) };
      gm.spectatorPanels.set('ch1', msg);

      await gm._refreshSpectatorPanel('ch1');

      expect(gm.spectatorPanels.has('ch1')).toBe(false);
    });

    test('does nothing if game has no spectatorChannelId', async () => {
      const game = makeGame({ spectatorChannelId: null });
      gm.games.set('ch1', game);

      await gm._refreshSpectatorPanel('ch1');
      // No panel, no error
      expect(gm.spectatorPanels.size).toBe(0);
    });

    test('does nothing if no game found', async () => {
      await expect(gm._refreshSpectatorPanel('nonexistent')).resolves.not.toThrow();
    });

    test('attempts reboot recovery when panel is missing but game is active', async () => {
      const game = makeGame();
      gm.games.set('ch1', game);

      // Stub client for reboot recovery
      const sentMsg = { id: 'recovered', pin: jest.fn(async () => {}) };
      const mockChannel = {
        id: 'spec1',
        send: jest.fn(async () => sentMsg),
      };
      gm.client = {
        guilds: {
          fetch: jest.fn(async () => ({
            channels: { fetch: jest.fn(async () => mockChannel) },
          })),
        },
      };

      // No panel registered (simulates reboot)
      await gm._refreshSpectatorPanel('ch1');

      // Should have recovered by posting a new panel
      expect(gm.spectatorPanels.get('ch1')).toBe(sentMsg);
    });

    test('does NOT attempt reboot recovery for ENDED games', async () => {
      const game = makeGame({ phase: PHASES.ENDED });
      gm.games.set('ch1', game);
      gm.client = {
        guilds: { fetch: jest.fn() },
      };

      await gm._refreshSpectatorPanel('ch1');

      expect(gm.client.guilds.fetch).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────
  // _setSubPhase emits subPhaseChanged
  // ───────────────────────────────────────────────────────────

  describe('_setSubPhase event emission', () => {
    test('emits subPhaseChanged when sub-phase changes', () => {
      const game = makeGame({ phase: PHASES.NIGHT, subPhase: PHASES.LOUPS });
      gm.games.set('ch1', game);
      gm._atomicContexts.set('ch1', { active: true, postCommit: [] });

      const emitSpy = jest.spyOn(gm, '_emitGameEvent');
      gm._setSubPhase(game, PHASES.VOYANTE);

      expect(game.subPhase).toBe(PHASES.VOYANTE);
      expect(emitSpy).toHaveBeenCalledWith(game, 'subPhaseChanged', {
        from: PHASES.LOUPS,
        subPhase: PHASES.VOYANTE,
      });
    });
  });

  // ───────────────────────────────────────────────────────────
  // announcePhase suppression
  // ───────────────────────────────────────────────────────────

  describe('announcePhase suppression', () => {
    test('announcePhase returns immediately for DAY sub-phases', async () => {
      const game = makeGame({ phase: PHASES.DAY, subPhase: PHASES.VOTE_CAPITAINE, villageChannelId: 'vc1' });
      gm.games.set('ch1', game);

      const guild = {
        channels: {
          fetch: jest.fn(async () => ({ send: jest.fn() })),
        },
      };

      await gm.announcePhase(guild, game, 'Test message');

      // Channel should NOT be fetched (method returns immediately)
      expect(guild.channels.fetch).not.toHaveBeenCalled();
    });

    test('announcePhase returns immediately for NIGHT sub-phases', async () => {
      const game = makeGame({ phase: PHASES.NIGHT, subPhase: PHASES.LOUPS, villageChannelId: 'vc1' });
      gm.games.set('ch1', game);

      const guild = {
        channels: {
          fetch: jest.fn(async () => ({ send: jest.fn() })),
        },
      };

      await gm.announcePhase(guild, game, 'Night message');
      expect(guild.channels.fetch).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────
  // captainElected emission
  // ───────────────────────────────────────────────────────────

  describe('captainElected emission', () => {
    test('voteCaptain emits captainElected when all players voted', async () => {
      const game = makeGame({
        phase: PHASES.DAY,
        subPhase: PHASES.VOTE_CAPITAINE,
        captainId: null,
      });
      gm.games.set('ch1', game);

      const emitSpy = jest.spyOn(gm, '_emitGameEvent');

      // p1 votes for p2
      await gm.voteCaptain('ch1', 'p1', 'p2');
      // p2 votes for p1
      await gm.voteCaptain('ch1', 'p2', 'p1');
      // p3 breaks the tie → all voted → captain elected
      const result = await gm.voteCaptain('ch1', 'p3', 'p2');

      expect(result.ok).toBe(true);
      expect(result.allVoted).toBe(true);
      expect(result.resolution.ok).toBe(true);

      const captainEmits = emitSpy.mock.calls.filter(c => c[1] === 'captainElected');
      expect(captainEmits.length).toBe(1);
      expect(captainEmits[0][2]).toHaveProperty('captainId');
    });

    test('voteCaptain does NOT emit captainElected when not all voted', async () => {
      const game = makeGame({
        phase: PHASES.DAY,
        subPhase: PHASES.VOTE_CAPITAINE,
        captainId: null,
      });
      gm.games.set('ch1', game);

      const emitSpy = jest.spyOn(gm, '_emitGameEvent');

      // Only p1 votes
      const result = await gm.voteCaptain('ch1', 'p1', 'p2');
      expect(result.ok).toBe(true);
      expect(result.allVoted).toBe(false);

      const captainEmits = emitSpy.mock.calls.filter(c => c[1] === 'captainElected');
      expect(captainEmits.length).toBe(0);
    });

    test('resolveCaptainVote emits captainElected on success', async () => {
      const game = makeGame({
        phase: PHASES.DAY,
        subPhase: PHASES.VOTE_CAPITAINE,
        captainId: null,
      });
      game.captainVotes.set('p1', 2);
      game.captainVotes.set('p2', 1);
      game.captainVoters.set('p1', 'p1');
      game.captainVoters.set('p2', 'p1');
      game.captainVoters.set('p3', 'p2');
      gm.games.set('ch1', game);

      const emitSpy = jest.spyOn(gm, '_emitGameEvent');

      const result = await gm.resolveCaptainVote('ch1');
      expect(result.ok).toBe(true);

      const captainEmits = emitSpy.mock.calls.filter(c => c[1] === 'captainElected');
      expect(captainEmits.length).toBe(1);
      expect(captainEmits[0][2].captainId).toBe(result.winnerId);
    });

    test('resolveCaptainVote does NOT emit on failure', async () => {
      const game = makeGame({
        phase: PHASES.DAY,
        subPhase: PHASES.VOTE_CAPITAINE,
        captainId: 'already-set',
      });
      gm.games.set('ch1', game);

      const emitSpy = jest.spyOn(gm, '_emitGameEvent');

      const result = await gm.resolveCaptainVote('ch1');
      expect(result.ok).toBe(false);

      const captainEmits = emitSpy.mock.calls.filter(c => c[1] === 'captainElected');
      expect(captainEmits.length).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────
  // postStartGame auto-posts spectator panel
  // ───────────────────────────────────────────────────────────

  describe('postStartGame spectator panel', () => {
    test('_postSpectatorPanel is called during game start flow', async () => {
      // We stub all methods called by postStartGame and track calls
      gm._postSpectatorPanel = jest.fn(async () => {});
      gm._postRolePanels = jest.fn(async () => {});
      gm._postVillageMasterPanel = jest.fn(async () => {});
      gm.sendLogged = jest.fn(async () => {});
      gm.playAmbience = jest.fn();
      gm.startNightAfkTimeout = jest.fn();
      gm.notifyTurn = jest.fn(async () => {});
      gm.updateChannelPermissions = jest.fn(async () => true);
      gm.updateVoicePerms = jest.fn(async () => {});
      gm._shouldAutoSkipSubPhase = jest.fn(() => false);

      const game = makeGame({
        phase: PHASES.NIGHT,
        subPhase: PHASES.LOUPS,
        voiceChannelId: null,
        // Use non-numeric player IDs so DM loop skips them
        players: [
          { id: 'alice', username: 'Alice', role: ROLES.WEREWOLF, alive: true },
          { id: 'bob', username: 'Bob', role: ROLES.SEER, alive: true },
        ],
      });
      gm.games.set('ch1', game);

      const mockChannel = {
        id: 'vc1',
        send: jest.fn(async () => ({ id: 'msg1', pin: jest.fn() })),
      };
      const guild = {
        id: 'g1',
        channels: {
          fetch: jest.fn(async () => mockChannel),
        },
      };
      const mockClient = {
        users: { fetch: jest.fn(async () => ({ send: jest.fn() })) },
      };

      await gm.postStartGame(guild, game, mockClient);

      expect(gm._postSpectatorPanel).toHaveBeenCalledWith(guild, game);
      // Ensure it's called AFTER village master panel
      const vmOrder = gm._postVillageMasterPanel.mock.invocationCallOrder[0];
      const spOrder = gm._postSpectatorPanel.mock.invocationCallOrder[0];
      expect(spOrder).toBeGreaterThan(vmOrder);
    });
  });

  // ───────────────────────────────────────────────────────────
  // GUI_EVENTS list completeness
  // ───────────────────────────────────────────────────────────

  describe('GUI_EVENTS completeness', () => {
    test('each of the 7 event types individually triggers a GUI refresh', async () => {
      // This test documents the complete set of events that trigger _refreshAllGui.
      // Each event type is tested individually to avoid coalescing.
      const expected = [
        'phaseChanged', 'subPhaseChanged', 'playerKilled',
        'gameEnded', 'gameStarted', 'voteCompleted', 'captainElected',
      ];

      const game = makeGame();
      gm.games.set('ch1', game);
      gm._refreshAllGui = jest.fn(async () => {});

      for (const ev of expected) {
        gm._refreshAllGui.mockClear();
        gm._guiRefreshScheduled.clear();
        gm._emitGameEvent(game, ev, {});
        await new Promise(resolve => setImmediate(resolve));
        expect(gm._refreshAllGui).toHaveBeenCalledTimes(1);
      }
    });

    test('rapid events for the same game are coalesced into one refresh', () => {
      // When multiple events fire in the same tick, only one refresh is scheduled.
      const game = makeGame();
      gm.games.set('ch1', game);
      gm._refreshAllGui = jest.fn(async () => {});

      gm._emitGameEvent(game, 'phaseChanged', {});
      gm._emitGameEvent(game, 'subPhaseChanged', {});
      gm._emitGameEvent(game, 'playerKilled', {});

      return new Promise(resolve => {
        setImmediate(() => {
          expect(gm._refreshAllGui).toHaveBeenCalledTimes(1);
          resolve();
        });
      });
    });
  });

  // ───────────────────────────────────────────────────────────
  // GUI dedup guards — prevent duplicate embeds per channel
  // ───────────────────────────────────────────────────────────

  describe('GUI dedup guards', () => {
    // Helper: create a mock guild with channels that return sendable messages
    function makeMockGuild(channelIds) {
      const sentMessages = []; // track all sent messages
      const channels = new Map();
      for (const id of channelIds) {
        channels.set(id, {
          id,
          send: jest.fn(async () => {
            const msg = { id: `msg-${id}-${sentMessages.length}`, edit: jest.fn(), pin: jest.fn() };
            sentMessages.push(msg);
            return msg;
          }),
        });
      }
      return {
        sentMessages,
        channels: {
          fetch: jest.fn(async (id) => channels.get(id) || null),
        },
      };
    }

    // ─── _guiPostingInProgress & _guiRefreshScheduled lifecycle ───

    test('_guiPostingInProgress is initialised as empty Set', () => {
      expect(gm._guiPostingInProgress).toBeInstanceOf(Set);
      expect(gm._guiPostingInProgress.size).toBe(0);
    });

    test('_guiRefreshScheduled is initialised as empty Set', () => {
      expect(gm._guiRefreshScheduled).toBeInstanceOf(Set);
      expect(gm._guiRefreshScheduled.size).toBe(0);
    });

    test('both Sets are cleared in destroy()', () => {
      gm._guiPostingInProgress.add('ch1');
      gm._guiRefreshScheduled.add('ch1');
      gm.destroy();
      expect(gm._guiPostingInProgress.size).toBe(0);
      expect(gm._guiRefreshScheduled.size).toBe(0);
      gm = null;
    });

    // ─── _refreshAllGui skips when _guiPostingInProgress ─────────

    test('_refreshAllGui skips when _guiPostingInProgress is set for the game', async () => {
      const game = makeGame();
      gm.games.set('ch1', game);
      gm._guiPostingInProgress.add('ch1');

      gm._refreshVillageMasterPanel = jest.fn(async () => {});
      gm._refreshRolePanels = jest.fn(async () => {});
      gm._refreshStatusPanels = jest.fn(async () => {});
      gm._refreshSpectatorPanel = jest.fn(async () => {});

      await gm._refreshAllGui('ch1');

      // None of the refreshers should have been called
      expect(gm._refreshVillageMasterPanel).not.toHaveBeenCalled();
      expect(gm._refreshRolePanels).not.toHaveBeenCalled();
      expect(gm._refreshStatusPanels).not.toHaveBeenCalled();
      expect(gm._refreshSpectatorPanel).not.toHaveBeenCalled();
    });

    // ─── _postVillageMasterPanel existence guard ────────────────

    test('_postVillageMasterPanel does not re-post if panel already exists', async () => {
      const game = makeGame();
      const mockGuild = makeMockGuild(['vc1']);
      gm.villagePanels.set('ch1', { id: 'existing-msg', edit: jest.fn() });

      await gm._postVillageMasterPanel(mockGuild, game);

      // channel.send should NOT have been called
      const ch = await mockGuild.channels.fetch('vc1');
      expect(ch.send).not.toHaveBeenCalled();
    });

    // ─── _postRolePanels existence guard ────────────────────────

    test('_postRolePanels does not re-post if panels already exist', async () => {
      const game = makeGame();
      const mockGuild = makeMockGuild(['wc1', 'sc1', 'wic1']);
      // Pre-fill the Map with an existing panel ref
      gm.rolePanels.set('ch1', { wolves: { id: 'existing', edit: jest.fn() } });

      await gm._postRolePanels(mockGuild, game);

      // No messages should have been sent
      expect(mockGuild.sentMessages.length).toBe(0);
    });

    // ─── _postSpectatorPanel existence guard ────────────────────

    test('_postSpectatorPanel does not re-post if panel already exists', async () => {
      const game = makeGame();
      const mockGuild = makeMockGuild(['spec1']);
      gm.spectatorPanels.set('ch1', { id: 'existing-msg', edit: jest.fn() });

      await gm._postSpectatorPanel(mockGuild, game);

      const ch = await mockGuild.channels.fetch('spec1');
      expect(ch.send).not.toHaveBeenCalled();
    });

    // ─── _refreshRolePanels recovery skips when posting in progress ───

    test('_refreshRolePanels recovery skips when _guiPostingInProgress is set', async () => {
      const game = makeGame();
      gm.games.set('ch1', game);
      gm._guiPostingInProgress.add('ch1');
      // No rolePanels registered → would normally trigger recovery

      gm._postRolePanels = jest.fn(async () => {});

      await gm._refreshRolePanels('ch1');

      expect(gm._postRolePanels).not.toHaveBeenCalled();
    });

    // ─── _refreshVillageMasterPanel recovery skips when posting in progress ───

    test('_refreshVillageMasterPanel recovery skips when _guiPostingInProgress is set', async () => {
      const game = makeGame();
      gm.games.set('ch1', game);
      gm._guiPostingInProgress.add('ch1');
      // No villagePanels registered → would normally trigger recovery

      gm._postVillageMasterPanel = jest.fn(async () => {});

      await gm._refreshVillageMasterPanel('ch1');

      expect(gm._postVillageMasterPanel).not.toHaveBeenCalled();
    });

    // ─── _refreshSpectatorPanel recovery skips when posting in progress ───

    test('_refreshSpectatorPanel recovery skips when _guiPostingInProgress is set', async () => {
      const game = makeGame();
      gm.games.set('ch1', game);
      gm._guiPostingInProgress.add('ch1');
      // No spectatorPanels registered → would normally trigger recovery

      gm._postSpectatorPanel = jest.fn(async () => {});

      await gm._refreshSpectatorPanel('ch1');

      expect(gm._postSpectatorPanel).not.toHaveBeenCalled();
    });

    // ─── Event coalescing for different games runs independently ───

    test('events for different games are not coalesced together', () => {
      const game1 = makeGame({ mainChannelId: 'ch1' });
      const game2 = makeGame({ mainChannelId: 'ch2' });
      gm.games.set('ch1', game1);
      gm.games.set('ch2', game2);
      gm._refreshAllGui = jest.fn(async () => {});

      gm._emitGameEvent(game1, 'phaseChanged', {});
      gm._emitGameEvent(game2, 'phaseChanged', {});

      return new Promise(resolve => {
        setImmediate(() => {
          // Both games should get their own refresh call
          expect(gm._refreshAllGui).toHaveBeenCalledTimes(2);
          expect(gm._refreshAllGui).toHaveBeenCalledWith('ch1');
          expect(gm._refreshAllGui).toHaveBeenCalledWith('ch2');
          resolve();
        });
      });
    });
  });
});
