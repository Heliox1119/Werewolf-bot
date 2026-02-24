const { GameManager } = require('../../game/gameManager');
const PHASES = require('../../game/phases');

function createMinimalGame(manager, channelId = 'fsm-integrity') {
  manager.create(channelId);
  const game = manager.games.get(channelId);
  game.phase = PHASES.NIGHT;
  game.subPhase = PHASES.LOUPS;
  return game;
}

describe('FSM integrity', () => {
  let gameManager;

  beforeEach(() => {
    gameManager = new GameManager();
  });

  afterEach(() => {
    if (gameManager && typeof gameManager.destroy === 'function') {
      gameManager.destroy();
    }
  });

  test('accepts every declared subPhase transition path', async () => {
    const game = createMinimalGame(gameManager, 'fsm-valid-paths');

    for (const [from, targets] of Object.entries(PHASES.VALID_TRANSITIONS)) {
      game.subPhase = from;
      for (const to of targets) {
        await gameManager.runAtomic(game.mainChannelId, (state) => {
          gameManager._setSubPhase(state, to);
        });
        expect(game.subPhase).toBe(to);
        game.subPhase = from;
      }
    }
  });

  test('rejects illegal subPhase transitions', async () => {
    const game = createMinimalGame(gameManager, 'fsm-illegal-sub');

    game.subPhase = PHASES.VOYANTE;
    await expect(
      gameManager.runAtomic(game.mainChannelId, (state) => {
        gameManager._setSubPhase(state, PHASES.LOUPS);
      })
    ).rejects.toThrow('Illegal subPhase transition');
  });

  test('rejects unknown states', async () => {
    const game = createMinimalGame(gameManager, 'fsm-unknown');

    await expect(
      gameManager.runAtomic(game.mainChannelId, (state) => {
        gameManager._setSubPhase(state, 'UNKNOWN_SUBPHASE');
      })
    ).rejects.toThrow('Unknown subPhase rejected');

    await expect(
      gameManager.runAtomic(game.mainChannelId, (state) => {
        gameManager._setPhase(state, 'UNKNOWN_PHASE');
      })
    ).rejects.toThrow('Unknown phase rejected');
  });

  test('ENDED is strictly terminal', async () => {
    const game = createMinimalGame(gameManager, 'fsm-ended-terminal');

    await gameManager.runAtomic(game.mainChannelId, (state) => {
      gameManager._setPhase(state, PHASES.ENDED);
    });

    await expect(
      gameManager.runAtomic(game.mainChannelId, (state) => {
        gameManager._setPhase(state, PHASES.DAY);
      })
    ).rejects.toThrow('Illegal phase transition');

    const phaseBefore = game.phase;
    const fakeGuild = { channels: { fetch: jest.fn() } };
    const result = await gameManager.nextPhase(fakeGuild, game);
    expect(result).toBe(PHASES.ENDED);
    expect(game.phase).toBe(phaseBefore);
  });
});
