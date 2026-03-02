/**
 * tests/game/nightResolutionEngine.test.js — Tests for night resolution engine.
 *
 * Covers: context creation, resolveNightVictim (witch save, salvateur protect,
 * ancien extra-life, actual death, lover collateral), resolveWitchKill,
 * resolveWhiteWolfKill, clearNightState, resolveHunterDeath,
 * announceNightResults (narrative order, peaceful night).
 */

const {
  createNightResolutionContext,
  resolveNightVictim,
  resolveWitchKill,
  resolveWhiteWolfKill,
  clearNightState,
  resolveHunterDeath,
  announceNightResults,
} = require('../../game/nightResolutionEngine');

const ROLES = require('../../game/roles');

// ─── Helpers ────────────────────────────────────────────────────────

function makePlayer(id, role = ROLES.VILLAGER, alive = true, extra = {}) {
  return { id, username: `Player_${id}`, role, alive, ...extra };
}

function makeGame(players, extra = {}) {
  return {
    mainChannelId: 'ch1',
    players,
    nightVictim: null,
    witchSave: false,
    protectedPlayerId: null,
    lastProtectedPlayerId: null,
    witchKillTarget: null,
    whiteWolfKillTarget: null,
    voiceChannelId: null,
    villageRolesPowerless: false,
    _hunterMustShoot: null,
    ...extra,
  };
}

function makeGm(killCollateral = []) {
  return {
    kill: jest.fn(() => killCollateral),
    logAction: jest.fn(),
    sendLogged: jest.fn().mockResolvedValue(undefined),
    announceDeathReveal: jest.fn().mockResolvedValue(undefined),
    playAmbience: jest.fn(),
    achievements: { trackEvent: jest.fn() },
    startHunterTimeout: jest.fn(),
    scheduleSave: jest.fn(),
  };
}

function makeChannel() {
  return { id: 'ch1', send: jest.fn().mockResolvedValue(undefined) };
}

function makeGuild() {
  return { id: 'guild1' };
}

// ─── createNightResolutionContext ───────────────────────────────────

describe('createNightResolutionContext', () => {
  it('returns an empty context with correct shape', () => {
    const ctx = createNightResolutionContext();
    expect(ctx.deaths).toEqual([]);
    expect(ctx.protections).toEqual([]);
    expect(ctx.achievements).toEqual([]);
    expect(ctx.savedVictimId).toBeNull();
    expect(ctx.hunterTriggered).toBeNull();
    expect(ctx.sounds).toEqual([]);
  });
});

// ─── resolveNightVictim ─────────────────────────────────────────────

describe('resolveNightVictim', () => {
  it('does nothing when nightVictim is null', () => {
    const game = makeGame([makePlayer('1')]);
    const ctx = createNightResolutionContext();
    const gm = makeGm();
    resolveNightVictim(game, ctx, gm);
    expect(ctx.deaths).toHaveLength(0);
    expect(ctx.protections).toHaveLength(0);
    expect(gm.kill).not.toHaveBeenCalled();
  });

  it('records witch save as protection', () => {
    const game = makeGame([makePlayer('1')], { nightVictim: '1', witchSave: true });
    const ctx = createNightResolutionContext();
    const gm = makeGm();
    resolveNightVictim(game, ctx, gm);
    expect(ctx.protections).toHaveLength(1);
    expect(ctx.protections[0].source).toBe('witch');
    expect(ctx.savedVictimId).toBe('1');
    expect(ctx.deaths).toHaveLength(0);
    expect(gm.kill).not.toHaveBeenCalled();
    expect(game.nightVictim).toBeNull();
  });

  it('records salvateur protection', () => {
    const victim = makePlayer('1');
    const salvateur = makePlayer('2', ROLES.SALVATEUR);
    const game = makeGame([victim, salvateur], { nightVictim: '1', protectedPlayerId: '1' });
    const ctx = createNightResolutionContext();
    const gm = makeGm();
    resolveNightVictim(game, ctx, gm);
    expect(ctx.protections).toHaveLength(1);
    expect(ctx.protections[0].source).toBe('salvateur');
    expect(ctx.protections[0].player.id).toBe('1');
    expect(ctx.achievements).toHaveLength(1);
    expect(ctx.achievements[0]).toEqual({ playerId: '2', event: 'salvateur_save' });
    expect(ctx.deaths).toHaveLength(0);
    expect(game.nightVictim).toBeNull();
  });

  it('records ancien extra-life as protection', () => {
    const ancien = makePlayer('1', ROLES.ANCIEN, true, { ancienExtraLife: true });
    const game = makeGame([ancien], { nightVictim: '1' });
    const ctx = createNightResolutionContext();
    const gm = makeGm();
    resolveNightVictim(game, ctx, gm);
    expect(ctx.protections).toHaveLength(1);
    expect(ctx.protections[0].source).toBe('ancien');
    expect(ancien.ancienExtraLife).toBe(false);
    expect(ctx.deaths).toHaveLength(0);
    expect(gm.kill).not.toHaveBeenCalled();
  });

  it('kills the victim and adds death entry', () => {
    const victim = makePlayer('1');
    const game = makeGame([victim], { nightVictim: '1' });
    const ctx = createNightResolutionContext();
    const gm = makeGm();
    resolveNightVictim(game, ctx, gm);
    expect(ctx.deaths).toHaveLength(1);
    expect(ctx.deaths[0].player).toBe(victim);
    expect(ctx.deaths[0].cause).toBe('wolves');
    expect(ctx.deaths[0].messages.some(m => m.type === 'nightVictim')).toBe(true);
    expect(ctx.sounds).toContain('death.mp3');
    expect(gm.kill).toHaveBeenCalledWith('ch1', '1', { throwOnDbFailure: true });
    expect(gm.logAction).toHaveBeenCalledWith(game, 'Mort la nuit: Player_1');
    expect(game.nightVictim).toBeNull();
  });

  it('adds ancien_final_death message before night_victim for ancien without extra life', () => {
    const ancien = makePlayer('1', ROLES.ANCIEN, true, { ancienExtraLife: false });
    const game = makeGame([ancien], { nightVictim: '1' });
    const ctx = createNightResolutionContext();
    const gm = makeGm();
    resolveNightVictim(game, ctx, gm);
    expect(ctx.deaths).toHaveLength(1);
    const msgs = ctx.deaths[0].messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[0].type).toBe('ancienFinalDeath');
    expect(msgs[1].type).toBe('nightVictim');
  });

  it('captures lover collateral on kill', () => {
    const victim = makePlayer('1');
    const lover = makePlayer('2');
    const game = makeGame([victim, lover], { nightVictim: '1' });
    const ctx = createNightResolutionContext();
    const gm = makeGm([lover]);
    resolveNightVictim(game, ctx, gm);
    expect(ctx.deaths).toHaveLength(1);
    expect(ctx.deaths[0].collateral).toEqual([lover]);
    expect(gm.logAction).toHaveBeenCalledWith(game, 'Mort d\'amour: Player_2');
  });

  it('does not create achievement if no salvateur alive', () => {
    const victim = makePlayer('1');
    const game = makeGame([victim], { nightVictim: '1', protectedPlayerId: '1' });
    const ctx = createNightResolutionContext();
    const gm = makeGm();
    resolveNightVictim(game, ctx, gm);
    expect(ctx.achievements).toHaveLength(0);
  });

  it('skips dead victim', () => {
    const victim = makePlayer('1', ROLES.VILLAGER, false);
    const game = makeGame([victim], { nightVictim: '1' });
    const ctx = createNightResolutionContext();
    const gm = makeGm();
    resolveNightVictim(game, ctx, gm);
    expect(ctx.deaths).toHaveLength(0);
    expect(gm.kill).not.toHaveBeenCalled();
  });
});

// ─── resolveWitchKill ───────────────────────────────────────────────

describe('resolveWitchKill', () => {
  it('does nothing when witchKillTarget is null', () => {
    const game = makeGame([makePlayer('1')]);
    const ctx = createNightResolutionContext();
    const gm = makeGm();
    resolveWitchKill(game, ctx, gm);
    expect(ctx.deaths).toHaveLength(0);
  });

  it('kills the witch target and adds death entry', () => {
    const target = makePlayer('2');
    const game = makeGame([makePlayer('1'), target], { witchKillTarget: '2' });
    const ctx = createNightResolutionContext();
    const gm = makeGm();
    resolveWitchKill(game, ctx, gm);
    expect(ctx.deaths).toHaveLength(1);
    expect(ctx.deaths[0].cause).toBe('witch');
    expect(ctx.deaths[0].player).toBe(target);
    expect(gm.kill).toHaveBeenCalledWith('ch1', '2', { throwOnDbFailure: true });
    expect(game.witchKillTarget).toBeNull();
  });

  it('skips death potion if target was saved by life potion', () => {
    const target = makePlayer('2');
    const game = makeGame([target], { witchKillTarget: '2' });
    const ctx = createNightResolutionContext();
    ctx.savedVictimId = '2';
    const gm = makeGm();
    resolveWitchKill(game, ctx, gm);
    expect(ctx.deaths).toHaveLength(0);
    expect(gm.kill).not.toHaveBeenCalled();
    expect(game.witchKillTarget).toBeNull();
  });

  it('handles lover collateral on witch kill', () => {
    const target = makePlayer('2');
    const lover = makePlayer('3');
    const game = makeGame([makePlayer('1'), target, lover], { witchKillTarget: '2' });
    const ctx = createNightResolutionContext();
    const gm = makeGm([lover]);
    resolveWitchKill(game, ctx, gm);
    expect(ctx.deaths[0].collateral).toEqual([lover]);
  });

  it('skips dead target', () => {
    const target = makePlayer('2', ROLES.VILLAGER, false);
    const game = makeGame([target], { witchKillTarget: '2' });
    const ctx = createNightResolutionContext();
    const gm = makeGm();
    resolveWitchKill(game, ctx, gm);
    expect(ctx.deaths).toHaveLength(0);
    expect(gm.kill).not.toHaveBeenCalled();
  });
});

// ─── resolveWhiteWolfKill ───────────────────────────────────────────

describe('resolveWhiteWolfKill', () => {
  it('does nothing when whiteWolfKillTarget is null', () => {
    const game = makeGame([makePlayer('1')]);
    const ctx = createNightResolutionContext();
    const gm = makeGm();
    resolveWhiteWolfKill(game, ctx, gm);
    expect(ctx.deaths).toHaveLength(0);
  });

  it('kills the white wolf target', () => {
    const target = makePlayer('3', ROLES.WEREWOLF);
    const game = makeGame([makePlayer('1'), target], { whiteWolfKillTarget: '3' });
    const ctx = createNightResolutionContext();
    const gm = makeGm();
    resolveWhiteWolfKill(game, ctx, gm);
    expect(ctx.deaths).toHaveLength(1);
    expect(ctx.deaths[0].cause).toBe('white_wolf');
    expect(ctx.deaths[0].player).toBe(target);
    expect(gm.kill).toHaveBeenCalledWith('ch1', '3', { throwOnDbFailure: true });
    expect(game.whiteWolfKillTarget).toBeNull();
  });

  it('handles lover collateral on white wolf kill', () => {
    const target = makePlayer('3', ROLES.WEREWOLF);
    const lover = makePlayer('4');
    const game = makeGame([target, lover], { whiteWolfKillTarget: '3' });
    const ctx = createNightResolutionContext();
    const gm = makeGm([lover]);
    resolveWhiteWolfKill(game, ctx, gm);
    expect(ctx.deaths[0].collateral).toEqual([lover]);
  });
});

// ─── clearNightState ────────────────────────────────────────────────

describe('clearNightState', () => {
  it('cleans up witchSave and salvateur fields', () => {
    const game = makeGame([], {
      witchSave: true,
      protectedPlayerId: '1',
      lastProtectedPlayerId: null,
    });
    clearNightState(game);
    expect(game.witchSave).toBe(false);
    expect(game.protectedPlayerId).toBeNull();
    expect(game.lastProtectedPlayerId).toBe('1');
  });
});

// ─── resolveHunterDeath ─────────────────────────────────────────────

describe('resolveHunterDeath', () => {
  it('detects hunter death in wolf victims', () => {
    const hunter = makePlayer('1', ROLES.HUNTER);
    const game = makeGame([hunter]);
    const ctx = createNightResolutionContext();
    ctx.deaths.push({ player: hunter, cause: 'wolves', collateral: [], messages: [] });
    resolveHunterDeath(game, ctx);
    expect(ctx.hunterTriggered).toBe(hunter);
  });

  it('detects hunter death in lover collateral', () => {
    const victim = makePlayer('1');
    const hunter = makePlayer('2', ROLES.HUNTER);
    const game = makeGame([victim, hunter]);
    const ctx = createNightResolutionContext();
    ctx.deaths.push({ player: victim, cause: 'wolves', collateral: [hunter], messages: [] });
    resolveHunterDeath(game, ctx);
    expect(ctx.hunterTriggered).toBe(hunter);
  });

  it('does not trigger hunter when villageRolesPowerless', () => {
    const hunter = makePlayer('1', ROLES.HUNTER);
    const game = makeGame([hunter], { villageRolesPowerless: true });
    const ctx = createNightResolutionContext();
    ctx.deaths.push({ player: hunter, cause: 'wolves', collateral: [], messages: [] });
    resolveHunterDeath(game, ctx);
    expect(ctx.hunterTriggered).toBeNull();
  });

  it('does nothing when no hunter among dead', () => {
    const villager = makePlayer('1');
    const game = makeGame([villager]);
    const ctx = createNightResolutionContext();
    ctx.deaths.push({ player: villager, cause: 'wolves', collateral: [], messages: [] });
    resolveHunterDeath(game, ctx);
    expect(ctx.hunterTriggered).toBeNull();
  });

  it('does nothing when ctx.deaths is empty', () => {
    const game = makeGame([]);
    const ctx = createNightResolutionContext();
    resolveHunterDeath(game, ctx);
    expect(ctx.hunterTriggered).toBeNull();
  });
});

// ─── announceNightResults ───────────────────────────────────────────

describe('announceNightResults', () => {
  it('sends protections before deaths (narrative order)', async () => {
    const channel = makeChannel();
    const guild = makeGuild();
    const gm = makeGm();
    const game = makeGame([]);

    const victim = makePlayer('1');
    const ctx = createNightResolutionContext();
    ctx.protections.push({
      player: null,
      source: 'witch',
      message: 'Witch saved!',
      logMessage: 'Sorciere sauve',
    });
    ctx.deaths.push({
      player: victim,
      cause: 'wolves',
      collateral: [],
      messages: [{ text: 'Victim died!', type: 'nightVictim' }],
    });

    await announceNightResults(channel, ctx, game, gm, guild);

    const calls = gm.sendLogged.mock.calls.map(c => c[1]);
    const protIdx = calls.indexOf('Witch saved!');
    const deathIdx = calls.indexOf('Victim died!');
    expect(protIdx).toBeLessThan(deathIdx);
  });

  it('sends death reveal after death message', async () => {
    const channel = makeChannel();
    const guild = makeGuild();
    const gm = makeGm();
    const game = makeGame([]);

    const victim = makePlayer('1');
    const ctx = createNightResolutionContext();
    ctx.deaths.push({
      player: victim,
      cause: 'wolves',
      collateral: [],
      messages: [{ text: 'Victim died!', type: 'nightVictim' }],
    });

    await announceNightResults(channel, ctx, game, gm, guild);

    expect(gm.sendLogged).toHaveBeenCalledWith(channel, 'Victim died!', { type: 'nightVictim' });
    expect(gm.announceDeathReveal).toHaveBeenCalledWith(channel, victim, 'wolves');
  });

  it('sends lover death after primary death', async () => {
    const channel = makeChannel();
    const guild = makeGuild();
    const gm = makeGm();
    const game = makeGame([]);

    const victim = makePlayer('1');
    const lover = makePlayer('2');
    const ctx = createNightResolutionContext();
    ctx.deaths.push({
      player: victim,
      cause: 'wolves',
      collateral: [lover],
      messages: [{ text: 'Victim died!', type: 'nightVictim' }],
    });

    await announceNightResults(channel, ctx, game, gm, guild);

    // 3 sendLogged calls: victim message, lover death
    const sendCalls = gm.sendLogged.mock.calls;
    expect(sendCalls.length).toBe(2);
    expect(sendCalls[0][1]).toBe('Victim died!');
    // lover death message contains player name (from i18n t())
    expect(sendCalls[1][2]).toEqual({ type: 'loverDeath' });

    // 2 announceDeathReveal calls: victim, then lover
    expect(gm.announceDeathReveal).toHaveBeenCalledTimes(2);
    expect(gm.announceDeathReveal.mock.calls[0][1]).toBe(victim);
    expect(gm.announceDeathReveal.mock.calls[1][1]).toBe(lover);
  });

  it('sends peaceful night message when no deaths and no protections', async () => {
    const channel = makeChannel();
    const guild = makeGuild();
    const gm = makeGm();
    const game = makeGame([]);
    const ctx = createNightResolutionContext();

    await announceNightResults(channel, ctx, game, gm, guild);

    expect(gm.sendLogged).toHaveBeenCalledTimes(1);
    expect(gm.sendLogged.mock.calls[0][2]).toEqual({ type: 'nightPeaceful' });
  });

  it('does NOT send peaceful message when there are protections but no deaths', async () => {
    const channel = makeChannel();
    const guild = makeGuild();
    const gm = makeGm();
    const game = makeGame([]);
    const ctx = createNightResolutionContext();
    ctx.protections.push({
      player: null,
      source: 'witch',
      message: 'Witch saved!',
      logMessage: 'save',
    });

    await announceNightResults(channel, ctx, game, gm, guild);

    const types = gm.sendLogged.mock.calls.map(c => c[2]?.type);
    expect(types).not.toContain('nightPeaceful');
  });

  it('fires achievements', async () => {
    const channel = makeChannel();
    const guild = makeGuild();
    const gm = makeGm();
    const game = makeGame([]);
    const ctx = createNightResolutionContext();
    ctx.achievements.push({ playerId: '5', event: 'salvateur_save' });

    await announceNightResults(channel, ctx, game, gm, guild);

    expect(gm.achievements.trackEvent).toHaveBeenCalledWith('5', 'salvateur_save');
  });

  it('triggers hunter with message and timeout', async () => {
    const channel = makeChannel();
    const guild = makeGuild();
    const gm = makeGm();
    const hunter = makePlayer('1', ROLES.HUNTER);
    const game = makeGame([hunter]);
    const ctx = createNightResolutionContext();
    ctx.hunterTriggered = hunter;

    await announceNightResults(channel, ctx, game, gm, guild);

    expect(game._hunterMustShoot).toBe('1');
    expect(gm.startHunterTimeout).toHaveBeenCalledWith(guild, game, '1');
    expect(gm.sendLogged).toHaveBeenCalledWith(
      channel,
      expect.stringContaining('Player_1'),
      { type: 'hunterDeath' }
    );
  });

  it('plays death sound when ctx.sounds is non-empty and voice channel exists', async () => {
    const channel = makeChannel();
    const guild = makeGuild();
    const gm = makeGm();
    const game = makeGame([], { voiceChannelId: 'vc1' });
    const ctx = createNightResolutionContext();
    ctx.sounds.push('death.mp3');
    ctx.deaths.push({
      player: makePlayer('1'),
      cause: 'wolves',
      collateral: [],
      messages: [{ text: 'died', type: 'nightVictim' }],
    });

    await announceNightResults(channel, ctx, game, gm, guild);

    expect(gm.playAmbience).toHaveBeenCalledWith('vc1', 'death.mp3');
  });

  it('does not play sound without voice channel', async () => {
    const channel = makeChannel();
    const guild = makeGuild();
    const gm = makeGm();
    const game = makeGame([]);
    const ctx = createNightResolutionContext();
    ctx.sounds.push('death.mp3');

    await announceNightResults(channel, ctx, game, gm, guild);

    expect(gm.playAmbience).not.toHaveBeenCalled();
  });

  it('handles multiple deaths in correct order (wolf → witch → white_wolf)', async () => {
    const channel = makeChannel();
    const guild = makeGuild();
    const gm = makeGm();
    const game = makeGame([]);

    const wolfVictim = makePlayer('1');
    const witchVictim = makePlayer('2');
    const wwVictim = makePlayer('3');
    const ctx = createNightResolutionContext();
    ctx.deaths.push(
      { player: wolfVictim, cause: 'wolves', collateral: [], messages: [{ text: 'Wolf kill', type: 'nightVictim' }] },
      { player: witchVictim, cause: 'witch', collateral: [], messages: [{ text: 'Witch kill', type: 'witchKill' }] },
      { player: wwVictim, cause: 'white_wolf', collateral: [], messages: [{ text: 'WW kill', type: 'whiteWolfKill' }] },
    );

    await announceNightResults(channel, ctx, game, gm, guild);

    const msgs = gm.sendLogged.mock.calls.map(c => c[1]);
    expect(msgs).toEqual(['Wolf kill', 'Witch kill', 'WW kill']);

    const reveals = gm.announceDeathReveal.mock.calls.map(c => c[1].id);
    expect(reveals).toEqual(['1', '2', '3']);
  });
});

// ─── Full resolution integration ────────────────────────────────────

describe('Full night resolution flow', () => {
  it('wolf kill → witch kill produces 2 deaths, no protections', () => {
    const victim1 = makePlayer('1');
    const victim2 = makePlayer('2');
    const game = makeGame([victim1, victim2, makePlayer('3')], {
      nightVictim: '1',
      witchKillTarget: '2',
    });
    const ctx = createNightResolutionContext();
    const gm = makeGm();

    resolveNightVictim(game, ctx, gm);
    resolveWitchKill(game, ctx, gm);
    resolveWhiteWolfKill(game, ctx, gm);
    clearNightState(game);
    resolveHunterDeath(game, ctx);

    expect(ctx.deaths).toHaveLength(2);
    expect(ctx.protections).toHaveLength(0);
    expect(ctx.hunterTriggered).toBeNull();
  });

  it('salvateur protection + witch kill produces 1 protection + 1 death', () => {
    const target = makePlayer('1');
    const witchTarget = makePlayer('2');
    const salvateur = makePlayer('3', ROLES.SALVATEUR);
    const game = makeGame([target, witchTarget, salvateur], {
      nightVictim: '1',
      protectedPlayerId: '1',
      witchKillTarget: '2',
    });
    const ctx = createNightResolutionContext();
    const gm = makeGm();

    resolveNightVictim(game, ctx, gm);
    resolveWitchKill(game, ctx, gm);
    resolveWhiteWolfKill(game, ctx, gm);
    clearNightState(game);

    expect(ctx.protections).toHaveLength(1);
    expect(ctx.protections[0].source).toBe('salvateur');
    expect(ctx.deaths).toHaveLength(1);
    expect(ctx.deaths[0].cause).toBe('witch');
  });

  it('witch save + witch death on same target → save wins, death skipped', () => {
    const target = makePlayer('1');
    const game = makeGame([target], {
      nightVictim: '1',
      witchSave: true,
      witchKillTarget: '1',
    });
    const ctx = createNightResolutionContext();
    const gm = makeGm();

    resolveNightVictim(game, ctx, gm);
    resolveWitchKill(game, ctx, gm);

    expect(ctx.protections).toHaveLength(1);
    expect(ctx.protections[0].source).toBe('witch');
    expect(ctx.deaths).toHaveLength(0);
    expect(ctx.savedVictimId).toBe('1');
  });

  it('hunter dies as wolf victim → hunterTriggered set', () => {
    const hunter = makePlayer('1', ROLES.HUNTER);
    const game = makeGame([hunter, makePlayer('2')], { nightVictim: '1' });
    const ctx = createNightResolutionContext();
    const gm = makeGm();

    resolveNightVictim(game, ctx, gm);
    resolveWitchKill(game, ctx, gm);
    resolveWhiteWolfKill(game, ctx, gm);
    clearNightState(game);
    resolveHunterDeath(game, ctx);

    expect(ctx.hunterTriggered).toBe(hunter);
  });

  it('no night events → empty context', () => {
    const game = makeGame([makePlayer('1'), makePlayer('2')]);
    const ctx = createNightResolutionContext();
    const gm = makeGm();

    resolveNightVictim(game, ctx, gm);
    resolveWitchKill(game, ctx, gm);
    resolveWhiteWolfKill(game, ctx, gm);
    clearNightState(game);
    resolveHunterDeath(game, ctx);

    expect(ctx.deaths).toHaveLength(0);
    expect(ctx.protections).toHaveLength(0);
    expect(ctx.hunterTriggered).toBeNull();
  });

  it('triple death: wolf + witch + white wolf', () => {
    const v1 = makePlayer('1');
    const v2 = makePlayer('2');
    const v3 = makePlayer('3', ROLES.WEREWOLF);
    const game = makeGame([v1, v2, v3, makePlayer('4')], {
      nightVictim: '1',
      witchKillTarget: '2',
      whiteWolfKillTarget: '3',
    });
    const ctx = createNightResolutionContext();
    const gm = makeGm();

    resolveNightVictim(game, ctx, gm);
    resolveWitchKill(game, ctx, gm);
    resolveWhiteWolfKill(game, ctx, gm);
    clearNightState(game);

    expect(ctx.deaths).toHaveLength(3);
    expect(ctx.deaths[0].cause).toBe('wolves');
    expect(ctx.deaths[1].cause).toBe('witch');
    expect(ctx.deaths[2].cause).toBe('white_wolf');
  });
});
