/**
 * Integration tests: Captain Election via select menu (captain_elect).
 *
 * Validates:
 *   - Select menu appears during VOTE_CAPITAINE subPhase (first day + re-election)
 *   - Guard rejects invalid states (wrong phase, dead player, captain already elected)
 *   - Full vote pipeline: register → tally → elect → advance to VOTE
 *   - Re-election after captain death triggers the same flow
 *   - Interaction router recognises captain_elect customId
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
    addLog: noop,
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
    phase: PHASES.DAY,
    subPhase: PHASES.VOTE_CAPITAINE,
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

// ─── Tests ────────────────────────────────────────────────────────

describe('Captain Election via select menu', () => {
  let gm;

  beforeEach(() => {
    gm = makeGM();
  });

  afterEach(() => {
    if (gm) gm.destroy();
    cleanupTest();
  });

  // ─── _buildVillagePanelComponents ─────────────────────────────

  describe('_buildVillagePanelComponents — captain_elect menu', () => {
    test('shows captain_elect select menu during VOTE_CAPITAINE', () => {
      const game = makeGame();
      gm.games.set('ch1', game);

      const components = gm._buildVillagePanelComponents(game);

      // Should contain exactly one action row with a select menu
      expect(components.length).toBeGreaterThanOrEqual(1);
      const firstComp = components[0]?.components?.[0];
      expect(firstComp).toBeDefined();
      expect(firstComp.data.custom_id).toBe('captain_elect');
      // Options are stored in firstComp.options (discord.js builder)
      expect(firstComp.options?.length || firstComp.data.options?.length).toBe(5);
    });

    test('does NOT show captain_elect when captain already elected', () => {
      const game = makeGame({ captainId: 'p1' });
      gm.games.set('ch1', game);

      const components = gm._buildVillagePanelComponents(game);

      const hasCaptainElect = components.some(row =>
        row.components.some(c => c.data?.custom_id === 'captain_elect')
      );
      expect(hasCaptainElect).toBe(false);
    });

    test('does NOT show captain_elect during VOTE', () => {
      const game = makeGame({ subPhase: PHASES.VOTE });
      gm.games.set('ch1', game);

      const components = gm._buildVillagePanelComponents(game);

      const hasCaptainElect = components.some(row =>
        row.components.some(c => c.data?.custom_id === 'captain_elect')
      );
      expect(hasCaptainElect).toBe(false);
    });

    test('does NOT show captain_elect during NIGHT', () => {
      const game = makeGame({ phase: PHASES.NIGHT, subPhase: PHASES.LOUPS });
      gm.games.set('ch1', game);

      const components = gm._buildVillagePanelComponents(game);

      const hasCaptainElect = components.some(row =>
        row.components.some(c => c.data?.custom_id === 'captain_elect')
      );
      expect(hasCaptainElect).toBe(false);
    });

    test('shows village_vote during VOTE subPhase (not captain_elect)', () => {
      const game = makeGame({
        subPhase: PHASES.VOTE,
        captainId: 'p1',
        villageVoteState: {
          votes: new Map(),
          resolved: false,
          tiedCandidates: [],
        },
      });
      gm.games.set('ch1', game);

      const components = gm._buildVillagePanelComponents(game);

      const hasCaptainElect = components.some(row =>
        row.components.some(c => c.data?.custom_id === 'captain_elect')
      );
      expect(hasCaptainElect).toBe(false);

      const hasVillageVote = components.some(row =>
        row.components.some(c => c.data?.custom_id === 'village_vote')
      );
      expect(hasVillageVote).toBe(true);
    });
  });

  // ─── validateCaptainElect guard ───────────────────────────────

  describe('validateCaptainElect guard', () => {
    const { validateCaptainElect } = require('../../interactions/common/guards');
    const singletonGM = require('../../game/gameManager');

    function makeSelectInteraction(channelId, userId, values) {
      return {
        channelId,
        user: { id: userId },
        values,
        isStringSelectMenu: () => true,
      };
    }

    afterEach(() => {
      singletonGM.games.clear();
    });

    test('rejects when no game', () => {
      const interaction = makeSelectInteraction('no-game', 'p1', ['p2']);
      const result = validateCaptainElect(interaction, 'p2');
      expect(result.ok).toBe(false);
    });

    test('rejects during NIGHT phase', () => {
      const game = makeGame({ phase: PHASES.NIGHT, subPhase: PHASES.LOUPS });
      singletonGM.games.set('ch1', game);

      const interaction = makeSelectInteraction('ch1', 'p1', ['p2']);
      const result = validateCaptainElect(interaction, 'p2');
      expect(result.ok).toBe(false);
    });

    test('rejects during wrong subPhase (VOTE)', () => {
      const game = makeGame({ subPhase: PHASES.VOTE });
      singletonGM.games.set('ch1', game);

      const interaction = makeSelectInteraction('ch1', 'p1', ['p2']);
      const result = validateCaptainElect(interaction, 'p2');
      expect(result.ok).toBe(false);
    });

    test('rejects when captain already elected', () => {
      const game = makeGame({ captainId: 'p3' });
      singletonGM.games.set('ch1', game);

      const interaction = makeSelectInteraction('ch1', 'p1', ['p2']);
      const result = validateCaptainElect(interaction, 'p2');
      expect(result.ok).toBe(false);
    });

    test('rejects dead voter', () => {
      const game = makeGame();
      game.players[0].alive = false; // Alice is dead
      singletonGM.games.set('ch1', game);

      const interaction = makeSelectInteraction('ch1', 'p1', ['p2']);
      const result = validateCaptainElect(interaction, 'p2');
      expect(result.ok).toBe(false);
    });

    test('rejects dead target', () => {
      const game = makeGame();
      game.players[1].alive = false; // Bob is dead
      singletonGM.games.set('ch1', game);

      const interaction = makeSelectInteraction('ch1', 'p1', ['p2']);
      const result = validateCaptainElect(interaction, 'p2');
      expect(result.ok).toBe(false);
    });

    test('accepts valid vote during VOTE_CAPITAINE', () => {
      const game = makeGame();
      singletonGM.games.set(game.mainChannelId, game);

      const interaction = makeSelectInteraction(game.mainChannelId, 'p1', ['p2']);
      const result = validateCaptainElect(interaction, 'p2');
      expect(result.ok).toBe(true);
      expect(result.game).toBe(game);
      expect(result.player.id).toBe('p1');
      expect(result.target.id).toBe('p2');
    });
  });

  // ─── voteCaptain via select menu pipeline ─────────────────────

  describe('voteCaptain pipeline (game logic)', () => {
    test('registers a vote and returns partial result', async () => {
      const game = makeGame();
      gm.games.set('ch1', game);

      const res = await gm.voteCaptain('ch1', 'p1', 'p2');

      expect(res.ok).toBe(true);
      expect(res.allVoted).toBe(false);
      expect(res.voted).toBe(1);
      expect(res.total).toBe(5);
    });

    test('all players vote → captain elected', async () => {
      const game = makeGame();
      gm.games.set('ch1', game);

      // All 5 players vote for p2
      await gm.voteCaptain('ch1', 'p1', 'p2');
      await gm.voteCaptain('ch1', 'p2', 'p2');
      await gm.voteCaptain('ch1', 'p3', 'p2');
      await gm.voteCaptain('ch1', 'p4', 'p2');
      const finalRes = await gm.voteCaptain('ch1', 'p5', 'p2');

      expect(finalRes.ok).toBe(true);
      expect(finalRes.allVoted).toBe(true);
      expect(finalRes.resolution.ok).toBe(true);
      expect(finalRes.resolution.winnerId).toBe('p2');
      expect(finalRes.resolution.username).toBe('Bob');
      expect(game.captainId).toBe('p2');
    });

    test('tie is resolved by random pick', async () => {
      const game = makeGame();
      // Reduce to 4 players for easier tie scenario
      game.players = game.players.slice(0, 4);
      gm.games.set('ch1', game);

      // 2 votes for p1, 2 votes for p2 → tie
      await gm.voteCaptain('ch1', 'p1', 'p1');
      await gm.voteCaptain('ch1', 'p2', 'p2');
      await gm.voteCaptain('ch1', 'p3', 'p1');
      const finalRes = await gm.voteCaptain('ch1', 'p4', 'p2');

      expect(finalRes.ok).toBe(true);
      expect(finalRes.allVoted).toBe(true);
      expect(finalRes.resolution.ok).toBe(true);
      expect(finalRes.resolution.wasTie).toBe(true);
      expect(['p1', 'p2']).toContain(finalRes.resolution.winnerId);
    });

    test('rejects vote when captain already elected', async () => {
      const game = makeGame({ captainId: 'p3' });
      gm.games.set('ch1', game);

      const res = await gm.voteCaptain('ch1', 'p1', 'p2');
      expect(res.ok).toBe(false);
      expect(res.reason).toBe('captain_already');
    });

    test('rejects vote during wrong subPhase', async () => {
      const game = makeGame({ subPhase: PHASES.VOTE });
      gm.games.set('ch1', game);

      const res = await gm.voteCaptain('ch1', 'p1', 'p2');
      expect(res.ok).toBe(false);
      expect(res.reason).toBe('wrong_phase');
    });
  });

  // ─── Re-election after captain death ──────────────────────────

  describe('Re-election after captain death', () => {
    test('advanceSubPhase triggers VOTE_CAPITAINE when captain is dead', async () => {
      const game = makeGame({
        phase: PHASES.NIGHT,
        subPhase: PHASES.REVEIL,
        captainId: 'p3',  // Charlie (VILLAGER) is captain
        dayCount: 2,
      });
      game.players[2].alive = false; // Captain Charlie is dead (not a wolf, so no victory)
      gm.games.set('ch1', game);

      // Mock guild for announcePhase (which is a no-op in GUI_MASTER)
      const mockGuild = {
        id: 'g1',
        channels: {
          fetch: jest.fn(async () => ({
            id: 'vc1',
            send: jest.fn(async () => ({ id: 'msg1' })),
          })),
          cache: new Map(),
        },
        members: { fetch: jest.fn(async () => ({ voice: {} })) },
      };

      await gm.advanceSubPhase(mockGuild, game);

      // Should have moved to VOTE_CAPITAINE (captainId cleared)
      expect(game.subPhase).toBe(PHASES.VOTE_CAPITAINE);
      expect(game.captainId).toBeNull();
    });

    test('advanceSubPhase triggers VOTE when captain is alive', async () => {
      const game = makeGame({
        phase: PHASES.NIGHT,
        subPhase: PHASES.REVEIL,
        captainId: 'p1',
        dayCount: 2,
      });
      // Captain Alice is still alive
      gm.games.set('ch1', game);

      const mockGuild = {
        id: 'g1',
        channels: {
          fetch: jest.fn(async () => ({
            id: 'vc1',
            send: jest.fn(async () => ({ id: 'msg1' })),
          })),
          cache: new Map(),
        },
        members: { fetch: jest.fn(async () => ({ voice: {} })) },
      };

      await gm.advanceSubPhase(mockGuild, game);

      expect(game.subPhase).toBe(PHASES.VOTE);
      expect(game.captainId).toBe('p1');
    });

    test('select menu appears for re-election (dead captain, day 2)', () => {
      const game = makeGame({
        captainId: null, // Cleared after death
        dayCount: 2,
      });
      gm.games.set('ch1', game);

      const components = gm._buildVillagePanelComponents(game);

      const hasCaptainElect = components.some(row =>
        row.components.some(c => c.data?.custom_id === 'captain_elect')
      );
      expect(hasCaptainElect).toBe(true);
    });
  });

  // ─── Interaction routing ──────────────────────────────────────

  describe('Interaction routing', () => {
    test('captain_elect is in DAY_SELECT_IDS routing', () => {
      const indexSource = require('fs').readFileSync(
        require('path').join(__dirname, '..', '..', 'index.js'),
        'utf-8'
      );
      // Verify captain_elect is included in the DAY_SELECT_IDS array
      expect(indexSource).toContain("'captain_elect'");
      expect(indexSource).toContain('handleCaptainElect');
    });
  });

  // ─── Locale strings ──────────────────────────────────────────

  describe('Locale strings exist', () => {
    test('FR locale has captain_elect_ph', () => {
      const frSource = require('fs').readFileSync(
        require('path').join(__dirname, '..', '..', 'locales', 'fr.js'),
        'utf-8'
      );
      expect(frSource).toContain('captain_elect_ph');
    });

    test('EN locale has captain_elect_ph', () => {
      const enSource = require('fs').readFileSync(
        require('path').join(__dirname, '..', '..', 'locales', 'en.js'),
        'utf-8'
      );
      expect(enSource).toContain('captain_elect_ph');
    });
  });
});
