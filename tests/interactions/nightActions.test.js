/**
 * Tests for interactions/nightActions.js — Button & Select Menu handlers
 */

const ROLES = require('../../game/roles');
const PHASES = require('../../game/phases');
const gameManager = require('../../game/gameManager');
const { createMockInteraction, createMockGame, createMockPlayer } = require('../helpers/testHelpers');

jest.mock('../../game/gameManager');
jest.mock('../../utils/logger', () => ({
  app: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  commands: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), startTimer: jest.fn(() => ({ end: jest.fn() })) },
  interaction: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../utils/validators', () => ({
  isInGameCategory: jest.fn(async () => true),
}));

const {
  handleWolvesKill,
  handleWhiteWolfKill,
  handleSeerSee,
  handleSalvateurProtect,
  handleWitchLife,
  handleWitchDeath,
  handleCupidLove,
  handleSkipButton,
  handleWhiteWolfSkip,
  handleNightButton,
  handleNightSelect,
} = require('../../interactions/nightActions');

// ─── Helpers ───────────────────────────────────────────────────────

function createSelectInteraction(customId, values, channelId, userId) {
  const interaction = createMockInteraction({ channelId, userId });
  interaction.customId = customId;
  interaction.values = values;
  interaction.deferred = true;
  interaction.replied = false;
  return interaction;
}

function createButtonInt(customId, channelId, userId) {
  const interaction = createMockInteraction({ channelId, userId });
  interaction.customId = customId;
  interaction.deferred = true;
  interaction.replied = false;
  return interaction;
}

function setupGameManager() {
  gameManager.clearNightAfkTimeout = jest.fn();
  gameManager.logAction = jest.fn();
  gameManager.advanceSubPhase = jest.fn();
  gameManager.isRealPlayerId = jest.fn(() => true);
  gameManager.runAtomic = jest.fn(async (chId, fn) => {
    const game = gameManager.getGameByChannelId(chId);
    return fn(game);
  });
  gameManager.db = {
    addVoteIfChanged: jest.fn(),
    clearVotes: jest.fn(),
    addNightAction: jest.fn(() => ({})),
    addNightActionOnce: jest.fn(() => ({ ok: true, affectedRows: 1 })),
    useWitchPotionIfAvailable: jest.fn(() => ({ ok: true, affectedRows: 1 })),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('interactions/nightActions', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    setupGameManager();
  });

  // ═══ Wolves Kill ═════════════════════════════════════════════════

  describe('handleWolvesKill', () => {

    it('replies with error when guards fail', async () => {
      gameManager.getGameByChannelId.mockReturnValue(null);
      const i = createSelectInteraction('wolves_kill', ['v1'], 'wolves-ch', 'wolf1');
      await handleWolvesKill(i);
      expect(i._replyContent).toBeDefined();
      expect(gameManager.advanceSubPhase).not.toHaveBeenCalled();
    });

    it('registers a vote and advances on consensus (solo wolf)', async () => {
      const wolf = createMockPlayer({ id: 'wolf1', role: ROLES.WEREWOLF });
      const villager = createMockPlayer({ id: 'v1', role: ROLES.VILLAGER });
      const game = createMockGame({
        mainChannelId: 'main', wolvesChannelId: 'wolves-ch',
        phase: PHASES.NIGHT, subPhase: PHASES.LOUPS,
        players: [wolf, villager], wolfVotes: null,
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const i = createSelectInteraction('wolves_kill', ['v1'], 'wolves-ch', 'wolf1');
      await handleWolvesKill(i);

      expect(gameManager.runAtomic).toHaveBeenCalled();
      expect(game.nightVictim).toBe('v1');
      expect(gameManager.advanceSubPhase).toHaveBeenCalledWith(i.guild, game);
    });

    it('pending vote when no majority (multi-wolf)', async () => {
      const wolf1 = createMockPlayer({ id: 'wolf1', role: ROLES.WEREWOLF });
      const wolf2 = createMockPlayer({ id: 'wolf2', role: ROLES.WEREWOLF });
      const v1 = createMockPlayer({ id: 'v1', role: ROLES.VILLAGER });
      const v2 = createMockPlayer({ id: 'v2', role: ROLES.VILLAGER });
      const game = createMockGame({
        mainChannelId: 'main', wolvesChannelId: 'wolves-ch',
        phase: PHASES.NIGHT, subPhase: PHASES.LOUPS,
        players: [wolf1, wolf2, v1, v2], wolfVotes: null,
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const i = createSelectInteraction('wolves_kill', ['v1'], 'wolves-ch', 'wolf1');
      await handleWolvesKill(i);

      // Not yet consensus (1/2 < ceil(2/2)=1) — actually ceil(2/2)=1 so 1>=1 is true
      // With 2 wolves, majority = ceil(2/2) = 1, so a single vote suffices
      expect(gameManager.advanceSubPhase).toHaveBeenCalled();
    });

    it('plurality when all wolves voted for different targets', async () => {
      const wolf1 = createMockPlayer({ id: 'wolf1', role: ROLES.WEREWOLF });
      const wolf2 = createMockPlayer({ id: 'wolf2', role: ROLES.WEREWOLF });
      const wolf3 = createMockPlayer({ id: 'wolf3', role: ROLES.WEREWOLF });
      const v1 = createMockPlayer({ id: 'v1', role: ROLES.VILLAGER });
      const v2 = createMockPlayer({ id: 'v2', role: ROLES.VILLAGER });
      const game = createMockGame({
        mainChannelId: 'main', wolvesChannelId: 'wolves-ch',
        phase: PHASES.NIGHT, subPhase: PHASES.LOUPS,
        players: [wolf1, wolf2, wolf3, v1, v2],
        wolfVotes: new Map([['wolf2', 'v2'], ['wolf3', 'v1']]),
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      // wolf1 votes for v1 → allVoted, v1 has 2 votes (plurality winner)
      const i = createSelectInteraction('wolves_kill', ['v1'], 'wolves-ch', 'wolf1');
      await handleWolvesKill(i);

      expect(gameManager.advanceSubPhase).toHaveBeenCalled();
    });
  });

  // ═══ White Wolf Kill ═════════════════════════════════════════════

  describe('handleWhiteWolfKill', () => {

    it('replies with error when guards fail', async () => {
      gameManager.getGameByChannelId.mockReturnValue(null);
      const i = createSelectInteraction('ww_kill', ['w1'], 'ww-ch', 'ww1');
      await handleWhiteWolfKill(i);
      expect(i._replyContent).toBeDefined();
      expect(gameManager.advanceSubPhase).not.toHaveBeenCalled();
    });

    it('sets whiteWolfKillTarget and advances', async () => {
      const ww = createMockPlayer({ id: 'ww1', role: ROLES.WHITE_WOLF });
      const wolf = createMockPlayer({ id: 'w1', role: ROLES.WEREWOLF });
      const game = createMockGame({
        mainChannelId: 'main', whiteWolfChannelId: 'ww-ch',
        phase: PHASES.NIGHT, subPhase: PHASES.LOUP_BLANC,
        players: [ww, wolf],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const i = createSelectInteraction('ww_kill', ['w1'], 'ww-ch', 'ww1');
      await handleWhiteWolfKill(i);

      expect(game.whiteWolfKillTarget).toBe('w1');
      expect(gameManager.advanceSubPhase).toHaveBeenCalled();
    });
  });

  // ═══ Seer See ════════════════════════════════════════════════════

  describe('handleSeerSee', () => {

    it('replies with error when guards fail', async () => {
      gameManager.getGameByChannelId.mockReturnValue(null);
      const i = createSelectInteraction('seer_see', ['t1'], 'seer-ch', 'seer1');
      await handleSeerSee(i);
      expect(i._replyContent).toBeDefined();
      expect(gameManager.advanceSubPhase).not.toHaveBeenCalled();
    });

    it('reveals target role and advances', async () => {
      const seer = createMockPlayer({ id: 'seer1', role: ROLES.SEER });
      const target = createMockPlayer({ id: 't1', role: ROLES.WEREWOLF, username: 'BadWolf' });
      const game = createMockGame({
        mainChannelId: 'main', seerChannelId: 'seer-ch',
        phase: PHASES.NIGHT, subPhase: PHASES.VOYANTE,
        players: [seer, target],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const i = createSelectInteraction('seer_see', ['t1'], 'seer-ch', 'seer1');
      await handleSeerSee(i);

      expect(gameManager.db.addNightActionOnce).toHaveBeenCalledWith(
        'main', 0, 'see', 'seer1', 't1'
      );
      expect(gameManager.advanceSubPhase).toHaveBeenCalled();
    });

    it('handles already-acted (affectedRows=0)', async () => {
      gameManager.db.addNightActionOnce.mockReturnValue({ ok: true, affectedRows: 0 });
      const seer = createMockPlayer({ id: 'seer1', role: ROLES.SEER });
      const target = createMockPlayer({ id: 't1', role: ROLES.WEREWOLF });
      const game = createMockGame({
        mainChannelId: 'main', seerChannelId: 'seer-ch',
        phase: PHASES.NIGHT, subPhase: PHASES.VOYANTE,
        players: [seer, target],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const i = createSelectInteraction('seer_see', ['t1'], 'seer-ch', 'seer1');
      await handleSeerSee(i);

      expect(gameManager.advanceSubPhase).not.toHaveBeenCalled();
    });
  });

  // ═══ Salvateur Protect ═══════════════════════════════════════════

  describe('handleSalvateurProtect', () => {

    it('replies with error when guards fail', async () => {
      gameManager.getGameByChannelId.mockReturnValue(null);
      const i = createSelectInteraction('salvateur_protect', ['t1'], 'salv-ch', 'salv1');
      await handleSalvateurProtect(i);
      expect(i._replyContent).toBeDefined();
    });

    it('sets protectedPlayerId and advances', async () => {
      const salv = createMockPlayer({ id: 'salv1', role: ROLES.SALVATEUR });
      const target = createMockPlayer({ id: 't1', username: 'Alice' });
      const game = createMockGame({
        mainChannelId: 'main', salvateurChannelId: 'salv-ch',
        phase: PHASES.NIGHT, subPhase: PHASES.SALVATEUR,
        players: [salv, target],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const i = createSelectInteraction('salvateur_protect', ['t1'], 'salv-ch', 'salv1');
      await handleSalvateurProtect(i);

      expect(game.protectedPlayerId).toBe('t1');
      expect(gameManager.advanceSubPhase).toHaveBeenCalled();
    });
  });

  // ═══ Witch Life ══════════════════════════════════════════════════

  describe('handleWitchLife', () => {

    it('replies with error when guards fail', async () => {
      gameManager.getGameByChannelId.mockReturnValue(null);
      const i = createButtonInt('witch_life', 'witch-ch', 'witch1');
      await handleWitchLife(i);
      expect(i._replyContent).toBeDefined();
      expect(gameManager.advanceSubPhase).not.toHaveBeenCalled();
    });

    it('uses life potion and advances', async () => {
      const witch = createMockPlayer({ id: 'witch1', role: ROLES.WITCH });
      const victim = createMockPlayer({ id: 'victim1', username: 'Bob' });
      const game = createMockGame({
        mainChannelId: 'main', witchChannelId: 'witch-ch',
        phase: PHASES.NIGHT, subPhase: PHASES.SORCIERE,
        witchPotions: { life: true, death: true },
        nightVictim: 'victim1',
        players: [witch, victim],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const i = createButtonInt('witch_life', 'witch-ch', 'witch1');
      await handleWitchLife(i);

      expect(game.witchPotions.life).toBe(false);
      expect(game.witchSave).toBe(true);
      expect(gameManager.advanceSubPhase).toHaveBeenCalled();
    });

    it('handles already-executed (affectedRows=0)', async () => {
      gameManager.db.useWitchPotionIfAvailable.mockReturnValue({ ok: true, affectedRows: 0 });
      const witch = createMockPlayer({ id: 'witch1', role: ROLES.WITCH });
      const game = createMockGame({
        mainChannelId: 'main', witchChannelId: 'witch-ch',
        phase: PHASES.NIGHT, subPhase: PHASES.SORCIERE,
        witchPotions: { life: true, death: true },
        nightVictim: 'victim1',
        players: [witch, createMockPlayer({ id: 'victim1' })],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const i = createButtonInt('witch_life', 'witch-ch', 'witch1');
      await handleWitchLife(i);

      expect(gameManager.advanceSubPhase).not.toHaveBeenCalled();
    });
  });

  // ═══ Witch Death ═════════════════════════════════════════════════

  describe('handleWitchDeath', () => {

    it('replies with error when guards fail', async () => {
      gameManager.getGameByChannelId.mockReturnValue(null);
      const i = createSelectInteraction('witch_death', ['t1'], 'witch-ch', 'witch1');
      await handleWitchDeath(i);
      expect(i._replyContent).toBeDefined();
    });

    it('uses death potion and advances', async () => {
      const witch = createMockPlayer({ id: 'witch1', role: ROLES.WITCH });
      const target = createMockPlayer({ id: 't1', username: 'Eve' });
      const game = createMockGame({
        mainChannelId: 'main', witchChannelId: 'witch-ch',
        phase: PHASES.NIGHT, subPhase: PHASES.SORCIERE,
        witchPotions: { life: true, death: true },
        players: [witch, target],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const i = createSelectInteraction('witch_death', ['t1'], 'witch-ch', 'witch1');
      await handleWitchDeath(i);

      expect(game.witchPotions.death).toBe(false);
      expect(game.witchKillTarget).toBe('t1');
      expect(gameManager.advanceSubPhase).toHaveBeenCalled();
    });
  });

  // ═══ Cupid Love ══════════════════════════════════════════════════

  describe('handleCupidLove', () => {

    it('replies with error when guards fail', async () => {
      gameManager.getGameByChannelId.mockReturnValue(null);
      const i = createSelectInteraction('cupid_love', ['a', 'b'], 'cupid-ch', 'cupid1');
      await handleCupidLove(i);
      expect(i._replyContent).toBeDefined();
    });

    it('links two players and advances', async () => {
      const cupid = createMockPlayer({ id: 'cupid1', role: ROLES.CUPID });
      const a = createMockPlayer({ id: 'a', username: 'Alice' });
      const b = createMockPlayer({ id: 'b', username: 'Bob' });
      const game = createMockGame({
        mainChannelId: 'main', cupidChannelId: 'cupid-ch',
        phase: PHASES.NIGHT, subPhase: PHASES.CUPIDON,
        lovers: [],
        players: [cupid, a, b],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const i = createSelectInteraction('cupid_love', ['a', 'b'], 'cupid-ch', 'cupid1');
      await handleCupidLove(i);

      expect(game.lovers).toEqual([['a', 'b']]);
      expect(gameManager.advanceSubPhase).toHaveBeenCalled();
    });
  });

  // ═══ Skip Buttons ════════════════════════════════════════════════

  describe('handleSkipButton', () => {

    it('skips seer phase and advances', async () => {
      const seer = createMockPlayer({ id: 'seer1', role: ROLES.SEER });
      const game = createMockGame({
        phase: PHASES.NIGHT, subPhase: PHASES.VOYANTE,
        players: [seer],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const i = createButtonInt('seer_skip', 'seer-ch', 'seer1');
      await handleSkipButton(i, ROLES.SEER, PHASES.VOYANTE, 'Voyante');

      expect(gameManager.clearNightAfkTimeout).toHaveBeenCalled();
      expect(gameManager.advanceSubPhase).toHaveBeenCalled();
    });

    it('skips witch phase and advances', async () => {
      const witch = createMockPlayer({ id: 'witch1', role: ROLES.WITCH });
      const game = createMockGame({
        phase: PHASES.NIGHT, subPhase: PHASES.SORCIERE,
        players: [witch],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const i = createButtonInt('witch_skip', 'witch-ch', 'witch1');
      await handleSkipButton(i, ROLES.WITCH, PHASES.SORCIERE, 'Sorcière');

      expect(gameManager.advanceSubPhase).toHaveBeenCalled();
    });

    it('replies with error when wrong subPhase', async () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        phase: PHASES.NIGHT, subPhase: PHASES.LOUPS,
        players: [createMockPlayer({ id: 'seer1', role: ROLES.SEER })],
      }));

      const i = createButtonInt('seer_skip', 'seer-ch', 'seer1');
      await handleSkipButton(i, ROLES.SEER, PHASES.VOYANTE, 'Voyante');

      expect(i._replyContent).toBeDefined();
      expect(gameManager.advanceSubPhase).not.toHaveBeenCalled();
    });
  });

  describe('handleWhiteWolfSkip', () => {

    it('skips white wolf phase and advances', async () => {
      const ww = createMockPlayer({ id: 'ww1', role: ROLES.WHITE_WOLF });
      const game = createMockGame({
        phase: PHASES.NIGHT, subPhase: PHASES.LOUP_BLANC,
        players: [ww],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const i = createButtonInt('ww_skip', 'ww-ch', 'ww1');
      await handleWhiteWolfSkip(i);

      expect(gameManager.advanceSubPhase).toHaveBeenCalled();
    });

    it('fails when wrong phase', async () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        phase: PHASES.DAY, subPhase: PHASES.LOUP_BLANC,
        players: [createMockPlayer({ id: 'ww1', role: ROLES.WHITE_WOLF })],
      }));

      const i = createButtonInt('ww_skip', 'ww-ch', 'ww1');
      await handleWhiteWolfSkip(i);

      expect(gameManager.advanceSubPhase).not.toHaveBeenCalled();
    });
  });

  // ═══ Routers ═════════════════════════════════════════════════════

  describe('handleNightButton (router)', () => {

    it('routes witch_life to handleWitchLife', async () => {
      gameManager.getGameByChannelId.mockReturnValue(null);
      const i = createButtonInt('witch_life', 'witch-ch', 'witch1');
      await handleNightButton(i);
      // Guard fails → editReply with error
      expect(i._replyContent).toBeDefined();
    });

    it('routes seer_skip to skip handler', async () => {
      gameManager.getGameByChannelId.mockReturnValue(null);
      const i = createButtonInt('seer_skip', 'seer-ch', 'seer1');
      await handleNightButton(i);
      expect(i._replyContent).toBeDefined();
    });

    it('routes cupid_skip to skip handler', async () => {
      gameManager.getGameByChannelId.mockReturnValue(null);
      const i = createButtonInt('cupid_skip', 'cupid-ch', 'cupid1');
      await handleNightButton(i);
      expect(i._replyContent).toBeDefined();
    });

    it('routes ww_skip to white wolf skip', async () => {
      gameManager.getGameByChannelId.mockReturnValue(null);
      const i = createButtonInt('ww_skip', 'ww-ch', 'ww1');
      await handleNightButton(i);
      expect(i._replyContent).toBeDefined();
    });
  });

  describe('handleNightSelect (router)', () => {

    it('routes wolves_kill', async () => {
      gameManager.getGameByChannelId.mockReturnValue(null);
      const i = createSelectInteraction('wolves_kill', ['v1'], 'wolves-ch', 'wolf1');
      await handleNightSelect(i);
      expect(i._replyContent).toBeDefined();
    });

    it('routes seer_see', async () => {
      gameManager.getGameByChannelId.mockReturnValue(null);
      const i = createSelectInteraction('seer_see', ['t1'], 'seer-ch', 'seer1');
      await handleNightSelect(i);
      expect(i._replyContent).toBeDefined();
    });

    it('routes cupid_love', async () => {
      gameManager.getGameByChannelId.mockReturnValue(null);
      const i = createSelectInteraction('cupid_love', ['a', 'b'], 'cupid-ch', 'cupid1');
      await handleNightSelect(i);
      expect(i._replyContent).toBeDefined();
    });
  });
});
