/**
 * interactions/ephemeralRoleActions/littleGirlListen.js
 *
 * Ephemeral button handler for the Little Girl's "listen" action.
 * Triggered by the `lgirl_listen` button.
 *
 * Calls EXACTLY the same business logic as `/listen` — no duplication.
 * All guards are in interactions/common/guards.js (validateLittleGirlListen).
 */

const { MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const gameManager = require('../../game/gameManager');
const { validateLittleGirlListen } = require('../common/guards');
const { safeEditReply } = require('../../utils/interaction');
const { t } = require('../../utils/i18n');
const { commands: logger } = require('../../utils/logger');

// Chance that the wolves are alerted (30%) — mirrors listen.js
const DETECTION_CHANCE = 0.3;

/**
 * Normalise a string: lowercase, strip accents, keep only Unicode letters.
 * Mirrors listen.js normalizeForHint.
 */
function normalizeForHint(str) {
  return str.toLowerCase()
    .normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^\p{L}]/gu, '');
}

/**
 * Pick the most ambiguous letter from the Little Girl's username.
 * Mirrors listen.js pickSmartHint.
 */
function pickSmartHint(username, game) {
  const ROLES = require('../../game/roles');
  const targetLetters = [...new Set(normalizeForHint(username).split(''))];

  const alreadyGiven = new Set((game.listenHintsGiven || []).map(l => l.toLowerCase()));
  const available = targetLetters.filter(l => !alreadyGiven.has(l));
  if (available.length === 0) return null;

  const otherNames = game.players
    .filter(p => p.alive && p.role !== ROLES.PETITE_FILLE)
    .map(p => normalizeForHint(p.username));

  const scored = available.map(letter => {
    const matchCount = otherNames.filter(name => name.includes(letter)).length;
    return { letter, matchCount };
  });

  scored.sort((a, b) => b.matchCount - a.matchCount);
  return scored[0].letter;
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
    let hintLetter = null;

    // Activate real-time relay (identical to listen.js)
    await gameManager.runAtomic(game.mainChannelId, (state) => {
      state.listenRelayUserId = interaction.user.id;
      if (Math.random() < DETECTION_CHANCE) {
        hintLetter = pickSmartHint(player.username, state);
        if (hintLetter) {
          state.listenHintsGiven = state.listenHintsGiven || [];
          state.listenHintsGiven.push(hintLetter);
        }
      }
    });

    // DM confirmation to the Little Girl
    await interaction.user.send(t('cmd.listen.relay_started'));
    await safeEditReply(interaction, { content: t('cmd.listen.relay_active'), flags: MessageFlags.Ephemeral });

    // Detection alert to wolves channel
    if (hintLetter !== null) {
      const wolvesChannel = await interaction.guild.channels.fetch(game.wolvesChannelId);
      if (wolvesChannel) {
        if (hintLetter) {
          await wolvesChannel.send(t('cmd.listen.wolves_alert', { letter: hintLetter.toUpperCase() }));
        } else {
          await wolvesChannel.send(t('cmd.listen.wolves_alert_no_hint'));
        }
      }
    }

    gameManager.logAction(game, `Petite Fille ${player.username} espionne les loups (bouton)`);

  } catch (err) {
    logger.error('Erreur bouton lgirl_listen:', { error: err.message });
    try {
      await gameManager.runAtomic(game.mainChannelId, (state) => {
        state.listenRelayUserId = null;
      });
    } catch (_) { /* ignore secondary rollback error */ }
    await safeEditReply(interaction, { content: t('error.listen_fetch_error'), flags: MessageFlags.Ephemeral });
  }
}

/**
 * Build the ephemeral DM prompt (embed + button) for the Little Girl.
 * Pure builder — no side effects, no game state mutation.
 *
 * @param {string} guildId  Used for locale resolution
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }}
 */
function buildLittleGirlPrompt(guildId) {
  const embed = new EmbedBuilder()
    .setTitle(t('role_panel.lgirl_title', {}, guildId))
    .setDescription(t('role_panel.lgirl_narration', {}, guildId))
    .setColor(0xFFB6C1); // light pink

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('lgirl_listen')
      .setLabel(t('role_panel.lgirl_listen_btn', {}, guildId))
      .setStyle(ButtonStyle.Primary)
  );

  return { embeds: [embed], components: [row] };
}

module.exports = { handleLittleGirlListen, buildLittleGirlPrompt };
