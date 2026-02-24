const { GameManager } = require('../../game/gameManager');
const PHASES = require('../../game/phases');
const ROLES = require('../../game/roles');

function seedGame(manager, channelId = 'crash-main') {
  manager.create(channelId, { guildId: 'guild-crash' });
  const game = manager.games.get(channelId);

  game.phase = PHASES.NIGHT;
  game.subPhase = PHASES.SALVATEUR;
  game.dayCount = 3;
  game.villageChannelId = 'village-crash';
  game.wolvesChannelId = 'wolves-crash';
  game.seerChannelId = 'seer-crash';
  game.witchChannelId = 'witch-crash';
  game.players = [
    { id: '111111111111111111', username: 'Alpha', role: ROLES.SALVATEUR, alive: true, inLove: false },
    { id: '222222222222222222', username: 'Beta', role: ROLES.VILLAGER, alive: true, inLove: false }
  ];

  manager.syncGameToDb(channelId, { throwOnError: true });
  return game;
}

async function applyAtomicMutation(manager, channelId, marker) {
  return manager.runAtomic(channelId, (state) => {
    state.protectedPlayerId = '222222222222222222';
    state.lastProtectedPlayerId = '222222222222222222';
    if (!state.listenHintsGiven.includes(marker)) {
      state.listenHintsGiven.push(marker);
    }
    if (state.subPhase === PHASES.SALVATEUR) {
      manager._setSubPhase(state, PHASES.LOUPS);
    }
    return { ok: true };
  });
}

function hardCrashAndRestart(manager) {
  const sharedDb = manager.db;
  manager.simulateProcessCrashForTests();
  const restarted = new GameManager({ db: sharedDb, testMode: true });
  restarted.loadState();
  return restarted;
}

describe('Crash simulation matrix', () => {
  test.each([
    {
      name: 'after memory mutation',
      point: 'after_memory_mutation',
      expectedPersistedBeforeRestart: false,
      trigger: async (manager, game, marker) => {
        await applyAtomicMutation(manager, game.mainChannelId, marker);
      }
    },
    {
      name: 'before DB commit',
      point: 'before_db_commit',
      expectedPersistedBeforeRestart: false,
      trigger: async (manager, game, marker) => {
        await applyAtomicMutation(manager, game.mainChannelId, marker);
      }
    },
    {
      name: 'after DB commit',
      point: 'after_db_commit',
      expectedPersistedBeforeRestart: true,
      trigger: async (manager, game, marker) => {
        await applyAtomicMutation(manager, game.mainChannelId, marker);
      }
    },
    {
      name: 'before timer scheduling',
      point: 'before_timer_scheduling',
      expectedPersistedBeforeRestart: false,
      trigger: async (manager, game) => {
        game.phase = PHASES.DAY;
        game.subPhase = PHASES.DELIBERATION;
        manager.syncGameToDb(game.mainChannelId, { throwOnError: true });
        const fakeGuild = { channels: { fetch: jest.fn() } };
        manager.startDayTimeout(fakeGuild, game, 'deliberation');
      }
    },
    {
      name: 'during subPhase transition',
      point: 'during_subphase_transition',
      expectedPersistedBeforeRestart: false,
      trigger: async (manager, game, marker) => {
        await applyAtomicMutation(manager, game.mainChannelId, marker);
      }
    }
  ])('simulates crash at $name and recovers safely', async ({ point, trigger }) => {
    const manager = new GameManager({ testMode: true });
    const game = seedGame(manager);
    const marker = `marker-${point}`;

    manager.setFailurePoint(point);

    await expect(trigger(manager, game, marker)).rejects.toMatchObject({
      code: 'SIMULATED_CRASH',
      failurePoint: point
    });

    const restarted = hardCrashAndRestart(manager);
    const restored = restarted.games.get(game.mainChannelId);

    expect(restored).toBeDefined();
    expect(restored.mainChannelId).toBe(game.mainChannelId);
    expect(restored.villageChannelId).toBe('village-crash');
    expect(restored.wolvesChannelId).toBe('wolves-crash');

    expect(PHASES.isKnownMainPhase(restored.phase)).toBe(true);
    expect(PHASES.isKnownSubPhase(restored.subPhase)).toBe(true);

    if (point === 'after_db_commit') {
      expect(restored.listenHintsGiven).toContain(marker);
      expect(restored.protectedPlayerId).toBe('222222222222222222');
      expect(restored.subPhase).toBe(PHASES.LOUPS);
    } else {
      expect(restored.listenHintsGiven).not.toContain(marker);
      expect(restored.protectedPlayerId).toBeNull();
      if (point !== 'before_timer_scheduling') {
        expect(restored.subPhase).toBe(PHASES.SALVATEUR);
      }
    }

    expect(restored.listenHintsGiven.filter(h => h === marker).length).toBeLessThanOrEqual(1);

    if (point === 'before_timer_scheduling') {
      restarted.clearFailurePoints();
      const fakeGuild = { channels: { fetch: jest.fn() } };
      expect(() => restarted.startDayTimeout(fakeGuild, restored, 'deliberation')).not.toThrow();
      const active = restarted.activeGameTimers.get(restored.mainChannelId);
      expect(active).toBeDefined();
      expect(active.type).toBe('day-deliberation');
    } else {
      restarted.clearFailurePoints();
      await expect(applyAtomicMutation(restarted, restored.mainChannelId, marker)).resolves.toEqual({ ok: true });
      const refreshed = restarted.games.get(restored.mainChannelId);
      expect(refreshed.protectedPlayerId).toBe('222222222222222222');
      expect(refreshed.listenHintsGiven.filter(h => h === marker).length).toBe(1);
      expect(PHASES.isKnownSubPhase(refreshed.subPhase)).toBe(true);
    }

    expect(restarted.db.getGame(game.mainChannelId)).not.toBeNull();

    restarted.destroy();
  });
});
