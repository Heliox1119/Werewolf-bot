/**
 * interactions/ephemeralRoleActions/littleGirlListen.js
 *
 * Ephemeral button handler for the Little Girl's "listen" action.
 * Triggered by the `lgirl_listen` button in the village master panel.
 *
 * New mechanic (replaces legacy /listen relay):
 *  - 50% chance to learn a random wolf's name
 *  - Dynamic exposure system (littleGirlExposureLevel)
 *  - Ambiguous hint sent to wolves channel each time
 *  - Once per night usage limit
 *  - Full identity reveal when exposure threshold reached
 *
 * Guards are in interactions/common/guards.js (validateLittleGirlListen).
 */

const { MessageFlags } = require('discord.js');
const gameManager = require('../../game/gameManager');
const ROLES = require('../../game/roles');
const { validateLittleGirlListen } = require('../common/guards');
const { safeEditReply } = require('../../utils/interaction');
const { t } = require('../../utils/i18n');
const { commands: logger } = require('../../utils/logger');

// Chance that the Little Girl learns a wolf's name (50%)
const WOLF_REVEAL_CHANCE = 0.5;

// ─── Hint Generator ────────────────────────────────────────────────

/**
 * Hint templates for the wolves channel. Each hint must match the Little Girl
 * AND at least 1 other alive player (≥ 2 total) to remain ambiguous.
 */
const HINT_TEMPLATES = [
  {
    test: (name) => /^[aeiouàâäéèêëïîôùûü]/i.test(name),
    key: 'cmd.listen.hint_vowel_start',
  },
  {
    test: (name) => /^[bcdfghjklmnpqrstvwxyz]/i.test(name),
    key: 'cmd.listen.hint_consonant_start',
  },
  {
    test: (name) => name.length >= 6,
    key: 'cmd.listen.hint_long_name',
  },
  {
    test: (name) => name.length <= 5,
    key: 'cmd.listen.hint_short_name',
  },
  {
    test: (name) => {
      const lower = name.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
      return [...new Set(lower.replace(/[^a-z]/g, ''))].some(
        c => (lower.match(new RegExp(c, 'g')) || []).length > 1
      );
    },
    key: 'cmd.listen.hint_repeated_letter',
  },
  {
    test: (name) => /\d/.test(name),
    key: 'cmd.listen.hint_has_number',
  },
  {
    test: (name) => !/\d/.test(name),
    key: 'cmd.listen.hint_no_number',
  },
];

/**
 * Generate an ambiguous hint about the Little Girl for the wolves channel.
 * The hint must match the Little Girl AND at least 1 other alive player.
 *
 * @param {object} lgirlPlayer  The Little Girl player object
 * @param {object} state        Game state
 * @param {string} [guildId]    Guild ID for locale
 * @returns {string|null}       Formatted hint message, or null if no valid hint
 */
function generateAmbiguousHint(lgirlPlayer, state, guildId) {
  const alivePlayers = state.players.filter(p => p.alive);

  // Filter for hints that match the Little Girl AND at least 1 other alive player
  const validHints = HINT_TEMPLATES.filter(hint => {
    if (!hint.test(lgirlPlayer.username)) return false;
    const otherMatches = alivePlayers.filter(
      p => p.id !== lgirlPlayer.id && hint.test(p.username)
    );
    return otherMatches.length >= 1; // ≥ 2 total (lgirl + 1 other)
  });

  if (validHints.length === 0) {
    // Fallback: generic hint (no specific attribute matches 2+ players)
    return t('cmd.listen.hint_generic', {}, guildId);
  }

  const chosen = validHints[Math.floor(Math.random() * validHints.length)];
  return t(chosen.key, {}, guildId);
}

/**
 * Handle the lgirl_listen button press.
 * The interaction is already deferred (ephemeral) by the router.
 *
 * @param {ButtonInteraction} interaction
 */
async function handleLittleGirlListen(interaction) {
  const result = validateLittleGirlListen(interaction);
  if (!result.ok) {
    await safeEditReply(interaction, { content: result.message, flags: MessageFlags.Ephemeral });
    return;
  }

  const { game, player } = result;

  try {
    let wolfRevealName = null;
    let hintMessage = null;
    let exposed = false;

    await gameManager.runAtomic(game.mainChannelId, (state) => {
      // Mark as listened this night (once per night)
      state.littleGirlListenedThisNight = true;

      // Increment exposure level
      state.littleGirlExposureLevel = (state.littleGirlExposureLevel || 0) + 1;

      // 50% chance to learn a random wolf's name
      const wolves = state.players.filter(
        p => p.alive && (p.role === ROLES.WEREWOLF || p.role === ROLES.WHITE_WOLF)
      );
      if (Math.random() < WOLF_REVEAL_CHANCE && wolves.length > 0) {
        const wolf = wolves[Math.floor(Math.random() * wolves.length)];
        wolfRevealName = wolf.username;
      }

      // Check exposure threshold: maxExposure = 1 + alive wolves count
      const aliveWolvesCount = wolves.length;
      const maxExposure = 1 + aliveWolvesCount;
      if (state.littleGirlExposureLevel >= maxExposure) {
        state.littleGirlExposed = true;
        exposed = true;
      }

      // Generate ambiguous hint for wolves
      hintMessage = generateAmbiguousHint(player, state, state.guildId);
    });

    // Ephemeral response to the Little Girl
    if (wolfRevealName) {
      await safeEditReply(interaction, {
        content: t('cmd.listen.wolf_revealed', { name: wolfRevealName }),
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await safeEditReply(interaction, {
        content: t('cmd.listen.nothing_learned'),
        flags: MessageFlags.Ephemeral,
      });
    }

    // Send hint to wolves channel
    if (hintMessage && game.wolvesChannelId) {
      try {
        const wolvesChannel = await interaction.guild.channels.fetch(game.wolvesChannelId);
        if (wolvesChannel) {
          await wolvesChannel.send(hintMessage);
        }
      } catch (e) {
        logger.debug('Failed to send hint to wolves channel', { error: e.message });
      }
    }

    // Full identity reveal if exposure threshold reached
    if (exposed && game.wolvesChannelId) {
      try {
        const wolvesChannel = await interaction.guild.channels.fetch(game.wolvesChannelId);
        if (wolvesChannel) {
          await wolvesChannel.send(
            t('cmd.listen.identity_revealed', { name: player.username }, game.guildId)
          );
        }
      } catch (e) {
        logger.debug('Failed to send identity reveal to wolves channel', { error: e.message });
      }
    }

    gameManager.logAction(
      game,
      `Petite Fille ${player.username} espionne les loups (exposure: ${game.littleGirlExposureLevel})` +
        (wolfRevealName ? ` — loup révélé: ${wolfRevealName}` : '') +
        (exposed ? ' — EXPOSÉE !' : '')
    );

  } catch (err) {
    logger.error('Erreur bouton lgirl_listen:', { error: err.message });
    await safeEditReply(interaction, {
      content: t('error.listen_fetch_error'),
      flags: MessageFlags.Ephemeral,
    });
  }
}

module.exports = {
  handleLittleGirlListen,
  generateAmbiguousHint,
  WOLF_REVEAL_CHANCE,
  HINT_TEMPLATES,
};
