/**
 * interactions/thiefButtons.js — Button & select-menu handler for the Thief (Voleur) role.
 *
 * DYNAMIC mode — two buttons + skip:
 *   • thief_steal:1   — Choose card 1  (mirrors /steal choice:1)
 *   • thief_steal:2   — Choose card 2  (mirrors /steal choice:2)
 *   • thief_skip       — Keep current role (mirrors /skip for VOLEUR)
 *
 * CLASSIC mode — select menu + skip:
 *   • thief_steal_select  — StringSelectMenu, value = role constant
 *   • thief_skip           — Keep current role
 *
 * Every guard and business-logic step is identical to the slash commands.
 * This file ONLY adapts the interaction plumbing (deferred ephemeral + editReply).
 */

const { MessageFlags } = require('discord.js');
const gameManager = require('../game/gameManager');
const ROLES = require('../game/roles');
const { validateThiefSteal, validateThiefSkip } = require('./common/guards');
const { safeEditReply } = require('../utils/interaction');
const { t, translateRole } = require('../utils/i18n');

/**
 * Core steal logic shared by buttons (DYNAMIC) and select menu (CLASSIC).
 *
 * @param {Interaction} interaction  Already deferred (ephemeral).
 * @param {string} chosenRole        The role constant the Thief selected.
 */
async function handleStealCore(interaction, chosenRole) {
  const result = validateThiefSteal(interaction);
  if (!result.ok) {
    await safeEditReply(interaction, { content: result.message, flags: MessageFlags.Ephemeral });
    return;
  }

  const { game, player } = result;

  // Validate that the chosen role is actually in the selection pool
  if (!game.thiefExtraRoles.includes(chosenRole)) {
    await safeEditReply(interaction, { content: t('cmd.steal.invalid_choice'), flags: MessageFlags.Ephemeral });
    return;
  }

  const oldRole = player.role;

  try {
    await gameManager.runAtomic(game.mainChannelId, (state) => {
      const actor = state.players.find(p => p.id === interaction.user.id);
      if (!actor) throw new Error('Thief disappeared during atomic mutation');
      actor.role = chosenRole;
      state.thiefExtraRoles = [];
      gameManager.clearNightAfkTimeout(state);
      gameManager.logAction(state, `Voleur vole: ${chosenRole} (ancien rôle: ${oldRole})`);
      const persistedPlayer = gameManager.db.updatePlayer(state.mainChannelId, actor.id, { role: chosenRole });
      if (!persistedPlayer) throw new Error('Failed to persist thief role swap');
      const persistedAction = gameManager.db.addNightAction(state.mainChannelId, state.dayCount || 0, 'steal', interaction.user.id, null);
      if (!persistedAction) throw new Error('Failed to persist thief action');
    });
  } catch (e) {
    await safeEditReply(interaction, { content: t('error.internal'), flags: MessageFlags.Ephemeral });
    return;
  }

  await safeEditReply(interaction, { content: t('cmd.steal.success', { role: translateRole(chosenRole) }), flags: MessageFlags.Ephemeral });

  // DM the new role
  try {
    const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
    const { getRoleImageName } = require('../utils/roleHelpers');
    const { translateRoleDesc, getColor } = require('../utils/i18n');
    const pathMod = require('path');
    const client = require.main?.exports?.client;

    if (client) {
      const user = await client.users.fetch(player.id);
      const embed = new EmbedBuilder()
        .setTitle(t('role.dm_title', { role: translateRole(chosenRole) }))
        .setDescription(translateRoleDesc ? translateRoleDesc(chosenRole) : translateRole(chosenRole))
        .setColor(getColor ? getColor(game.guildId, 'primary') : 0x9B59B6);

      const imageName = getRoleImageName(chosenRole);
      const files = [];
      if (imageName) {
        const imagePath = pathMod.join(__dirname, '..', 'img', imageName);
        files.push(new AttachmentBuilder(imagePath, { name: imageName }));
        embed.setThumbnail(`attachment://${imageName}`);
      }

      await user.send({ embeds: [embed], files });
    }
  } catch (_) {
    // DM failed — ignore silently
  }

  // If thief took a wolf role, update wolf channel permissions
  if (chosenRole === ROLES.WEREWOLF || chosenRole === ROLES.WHITE_WOLF) {
    try {
      await gameManager.updateChannelPermissions(interaction.guild, game);
    } catch (_) { /* ignore */ }
  }

  // Advance to next sub-phase
  await gameManager.advanceSubPhase(interaction.guild, game);
}

/**
 * Handle a thief_steal button press (DYNAMIC mode — choice 1 or 2).
 * @param {ButtonInteraction} interaction  Already deferred (ephemeral).
 * @param {number} choice  1 or 2
 */
async function handleSteal(interaction, choice) {
  const game = gameManager.getGameByChannelId(interaction.channelId);
  if (!game || !game.thiefExtraRoles || !game.thiefExtraRoles[choice - 1]) {
    await safeEditReply(interaction, { content: t('error.action_forbidden'), flags: MessageFlags.Ephemeral });
    return;
  }
  const chosenRole = game.thiefExtraRoles[choice - 1];
  await handleStealCore(interaction, chosenRole);
}

/**
 * Handle a thief_steal_select menu interaction (CLASSIC mode).
 * @param {StringSelectMenuInteraction} interaction  Already deferred (ephemeral).
 */
async function handleStealSelect(interaction) {
  const chosenRole = interaction.values[0];
  if (!chosenRole) {
    await safeEditReply(interaction, { content: t('cmd.steal.invalid_choice'), flags: MessageFlags.Ephemeral });
    return;
  }
  await handleStealCore(interaction, chosenRole);
}

/**
 * Handle a thief_skip button press.
 * @param {ButtonInteraction} interaction  Already deferred (ephemeral).
 */
async function handleSkip(interaction) {
  const result = validateThiefSkip(interaction);
  if (!result.ok) {
    await safeEditReply(interaction, { content: result.message, flags: MessageFlags.Ephemeral });
    return;
  }

  const { game } = result;

  gameManager.clearNightAfkTimeout(game);
  gameManager.logAction(game, 'Voleur passe son action (skip)');

  await safeEditReply(interaction, { content: t('cmd.skip.success', { label: 'Voleur' }), flags: MessageFlags.Ephemeral });

  // Advance to next sub-phase
  await gameManager.advanceSubPhase(interaction.guild, game);
}

/**
 * Main router for all thief button interactions.
 * Called from the interactionCreate handler in index.js.
 *
 * @param {ButtonInteraction} interaction  Already deferred (ephemeral).
 */
async function handleThiefButton(interaction) {
  const [buttonType, arg1] = interaction.customId.split(':');

  if (buttonType === 'thief_steal') {
    const choice = parseInt(arg1, 10);
    if (choice !== 1 && choice !== 2) {
      await safeEditReply(interaction, { content: t('cmd.steal.invalid_choice'), flags: MessageFlags.Ephemeral });
      return;
    }
    await handleSteal(interaction, choice);
    return;
  }

  if (buttonType === 'thief_skip') {
    await handleSkip(interaction);
    return;
  }
}

module.exports = { handleThiefButton, handleStealSelect };
