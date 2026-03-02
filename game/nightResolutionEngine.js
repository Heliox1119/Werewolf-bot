/**
 * nightResolutionEngine.js — Pure logic for night→day resolution.
 *
 * Collects all night events into a NightResolutionContext WITHOUT sending
 * any Discord messages.  A single `announceNightResults()` function then
 * sends every message in the correct narrative order, BEFORE any day
 * sub-phase (captain election / vote) begins.
 *
 * Depends on:
 *  - gameManager.kill()          (synchronous: returns collateral deaths)
 *  - gameManager.logAction()
 *  - gameManager.announceDeathReveal()
 *  - gameManager.sendLogged()
 *  - AchievementEngine.trackEvent()
 *  - i18n t()
 */
'use strict';

const { t }     = require('../utils/i18n');
const { game: logger } = require('../utils/logger');

// ---------------------------------------------------------------------------
// Context factory
// ---------------------------------------------------------------------------

/**
 * Create an empty night resolution context.
 * Every resolve* function populates this context; nothing is sent to Discord.
 */
function createNightResolutionContext() {
  return {
    /** { player, cause, collateral: [player], message, ancienMessage? } */
    deaths: [],
    /** { player, source: 'witch'|'salvateur'|'ancien', message } */
    protections: [],
    /** Achievement events to fire after announce: [{ playerId, event }] */
    achievements: [],
    /** Id of the victim saved by witch life potion (null if none) */
    savedVictimId: null,
    /** Hunter player who died and must shoot (null if none) */
    hunterTriggered: null,
    /** Sound effects to play during announce: [filename] */
    sounds: [],
  };
}

// ---------------------------------------------------------------------------
// Resolve functions — mutate game state & fill ctx, send NOTHING
// ---------------------------------------------------------------------------

/**
 * Resolve the main wolf attack (nightVictim).
 * Handles witch save, Salvateur protection, Ancien extra-life, and actual death.
 */
function resolveNightVictim(game, ctx, gm) {
  if (!game.nightVictim) return;

  const ROLES = require('./roles');

  if (game.witchSave) {
    // Witch life potion saved the victim
    ctx.savedVictimId = game.nightVictim;
    ctx.protections.push({
      player: null,
      source: 'witch',
      message: t('game.witch_saved'),
      logMessage: 'Sorciere sauve la victime des loups',
    });
    logger.info('WITCH_LIFE_POTION_SAVED', { nightVictim: game.nightVictim });

  } else if (game.protectedPlayerId && game.protectedPlayerId === game.nightVictim) {
    // Salvateur protection
    const protectedPlayer = game.players.find(p => p.id === game.nightVictim);
    if (protectedPlayer) {
      ctx.protections.push({
        player: protectedPlayer,
        source: 'salvateur',
        message: t('game.salvateur_protected', { name: protectedPlayer.username }),
        logMessage: `Salvateur protège ${protectedPlayer.username} de l'attaque des loups`,
      });
      // Achievement tracking
      const salvateur = game.players.find(p => p.role === ROLES.SALVATEUR && p.alive);
      if (salvateur) {
        ctx.achievements.push({ playerId: salvateur.id, event: 'salvateur_save' });
      }
    }

  } else {
    // Actual victim
    const victimPlayer = game.players.find(p => p.id === game.nightVictim);
    if (victimPlayer && victimPlayer.alive) {
      if (victimPlayer.role === ROLES.ANCIEN && victimPlayer.ancienExtraLife) {
        // Ancien survives with extra life
        victimPlayer.ancienExtraLife = false;
        ctx.protections.push({
          player: victimPlayer,
          source: 'ancien',
          message: t('game.ancien_survives', { name: victimPlayer.username }),
          logMessage: `Ancien ${victimPlayer.username} survit à l'attaque (vie supplémentaire)`,
        });
      } else {
        // Real death
        const deathEntry = {
          player: victimPlayer,
          cause: 'wolves',
          collateral: [],
          messages: [],
        };

        if (victimPlayer.role === ROLES.ANCIEN && !victimPlayer.ancienExtraLife) {
          deathEntry.messages.push({
            text: t('game.ancien_final_death', { name: victimPlayer.username }),
            type: 'ancienFinalDeath',
          });
        }

        deathEntry.messages.push({
          text: t('game.night_victim', { name: victimPlayer.username }),
          type: 'nightVictim',
        });
        ctx.sounds.push('death.mp3');

        // Kill the player (synchronous)
        const collateral = gm.kill(game.mainChannelId, game.nightVictim, { throwOnDbFailure: true });
        gm.logAction(game, `Mort la nuit: ${victimPlayer.username}`);

        for (const dead of collateral) {
          deathEntry.collateral.push(dead);
          gm.logAction(game, `Mort d'amour: ${dead.username}`);
        }

        ctx.deaths.push(deathEntry);
      }
    }
  }

  game.nightVictim = null;
}

/**
 * Resolve the witch's death potion target.
 */
function resolveWitchKill(game, ctx, gm) {
  if (!game.witchKillTarget) return;

  // Safety: don't kill the player who was just saved by the life potion
  if (ctx.savedVictimId && game.witchKillTarget === ctx.savedVictimId) {
    logger.warn('WITCH_KILL_TARGET_SAVED_SKIP', {
      witchKillTarget: game.witchKillTarget,
      savedVictimId: ctx.savedVictimId,
    });
    game.witchKillTarget = null;
    return;
  }

  const witchVictim = game.players.find(p => p.id === game.witchKillTarget);
  if (witchVictim && witchVictim.alive) {
    const deathEntry = {
      player: witchVictim,
      cause: 'witch',
      collateral: [],
      messages: [{
        text: t('game.witch_kill', { name: witchVictim.username }),
        type: 'witchKill',
      }],
    };

    const collateral = gm.kill(game.mainChannelId, game.witchKillTarget, { throwOnDbFailure: true });
    gm.logAction(game, `Empoisonné: ${witchVictim.username}`);

    for (const dead of collateral) {
      deathEntry.collateral.push(dead);
      gm.logAction(game, `Mort d'amour: ${dead.username}`);
    }

    ctx.deaths.push(deathEntry);
  }

  game.witchKillTarget = null;
}

/**
 * Resolve the White Wolf's kill target.
 */
function resolveWhiteWolfKill(game, ctx, gm) {
  if (!game.whiteWolfKillTarget) return;

  const wwVictim = game.players.find(p => p.id === game.whiteWolfKillTarget);
  if (wwVictim && wwVictim.alive) {
    const deathEntry = {
      player: wwVictim,
      cause: 'white_wolf',
      collateral: [],
      messages: [{
        text: t('game.white_wolf_kill', { name: wwVictim.username }),
        type: 'whiteWolfKill',
      }],
    };

    const collateral = gm.kill(game.mainChannelId, game.whiteWolfKillTarget, { throwOnDbFailure: true });
    gm.logAction(game, `Dévoré par le Loup Blanc: ${wwVictim.username}`);

    for (const dead of collateral) {
      deathEntry.collateral.push(dead);
      gm.logAction(game, `Mort d'amour: ${dead.username}`);
    }

    ctx.deaths.push(deathEntry);
  }

  game.whiteWolfKillTarget = null;
}

/**
 * Clear transient night state after resolution.
 */
function clearNightState(game) {
  game.witchSave = false;
  game.lastProtectedPlayerId = game.protectedPlayerId;
  game.protectedPlayerId = null;
}

/**
 * Check if a hunter died this night and needs to shoot.
 */
function resolveHunterDeath(game, ctx) {
  const ROLES = require('./roles');
  const allDead = [];
  for (const d of ctx.deaths) {
    allDead.push(d.player);
    allDead.push(...d.collateral);
  }

  for (const dead of allDead) {
    if (dead.role === ROLES.HUNTER && !game.villageRolesPowerless) {
      ctx.hunterTriggered = dead;
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Announce — single function sends ALL night results in narrative order
// ---------------------------------------------------------------------------

/**
 * Send all night resolution messages to mainChannel in the correct order:
 *  1. Protections / saves (witch save, salvateur, ancien extra-life)
 *  2. Deaths (with reveal embeds + lover collateral)
 *  3. Peaceful night (if no deaths AND no protections)
 *  4. Hunter trigger
 *
 * @param {TextChannel} mainChannel
 * @param {object}      ctx   - NightResolutionContext
 * @param {object}      game
 * @param {object}      gm    - GameManager instance (sendLogged, announceDeathReveal, achievements, sounds)
 * @param {Guild}       guild - Discord guild (needed for startHunterTimeout)
 */
async function announceNightResults(mainChannel, ctx, game, gm, guild) {
  // 1. Play death sound if needed
  if (ctx.sounds.length > 0 && game.voiceChannelId) {
    for (const sound of ctx.sounds) {
      gm.playAmbience(game.voiceChannelId, sound);
    }
  }

  // 2. Protections / saves
  for (const prot of ctx.protections) {
    await gm.sendLogged(mainChannel, prot.message, { type: prot.source + 'Save' });
    gm.logAction(game, prot.logMessage);
  }

  // 3. Deaths — in order: wolf victim, witch kill, white wolf kill
  for (const death of ctx.deaths) {
    // Pre-messages (e.g. ancien_final_death before night_victim)
    for (const msg of death.messages) {
      await gm.sendLogged(mainChannel, msg.text, { type: msg.type });
    }
    // Death reveal embed
    await gm.announceDeathReveal(mainChannel, death.player, death.cause);
    // Lover collateral
    for (const dead of death.collateral) {
      await gm.sendLogged(mainChannel, t('game.lover_death', { name: dead.username }), { type: 'loverDeath' });
      await gm.announceDeathReveal(mainChannel, dead, 'love');
    }
  }

  // 4. Peaceful night (no deaths and no protections)
  if (ctx.deaths.length === 0 && ctx.protections.length === 0) {
    await gm.sendLogged(mainChannel, t('game.night_peaceful'), { type: 'nightPeaceful' });
  }

  // 5. Achievements
  if (gm.achievements) {
    for (const ach of ctx.achievements) {
      try { gm.achievements.trackEvent(ach.playerId, ach.event); } catch (e) { /* ignore */ }
    }
  }

  // 6. Hunter trigger
  if (ctx.hunterTriggered) {
    const dead = ctx.hunterTriggered;
    game._hunterMustShoot = dead.id;
    await gm.sendLogged(mainChannel, t('game.hunter_death', { name: dead.username }), { type: 'hunterDeath' });
    gm.startHunterTimeout(guild, game, dead.id);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  createNightResolutionContext,
  resolveNightVictim,
  resolveWitchKill,
  resolveWhiteWolfKill,
  clearNightState,
  resolveHunterDeath,
  announceNightResults,
};
