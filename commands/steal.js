const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const ROLES = require("../game/roles");
const PHASES = require("../game/phases");
const { isInGameCategory } = require("../utils/validators");
const { safeReply } = require("../utils/interaction");
const { t, translateRole } = require('../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("steal")
    .setDescription("Voleur : choisir une des 2 cartes face cachée")
    .addIntegerOption(option =>
      option
        .setName("choice")
        .setDescription("Numéro de la carte (1 ou 2)")
        .setRequired(true)
        .addChoices(
          { name: "Carte 1", value: 1 },
          { name: "Carte 2", value: 2 }
        )
    ),

  async execute(interaction) {
    // Vérification catégorie
    if (!await isInGameCategory(interaction)) {
      await safeReply(interaction, { content: t('error.action_forbidden'), flags: MessageFlags.Ephemeral });
      return;
    }

    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await safeReply(interaction, { content: t('error.no_game'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est le channel du voleur
    if (interaction.channelId !== game.thiefChannelId) {
      await safeReply(interaction, { content: t('error.only_thief_channel'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est la nuit ET la sous-phase du voleur
    if (game.phase !== PHASES.NIGHT) {
      await safeReply(interaction, { content: t('error.action_forbidden'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (game.subPhase !== PHASES.VOLEUR) {
      await safeReply(interaction, { content: t('error.not_thief_turn'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est le voleur vivant
    const player = game.players.find(p => p.id === interaction.user.id);
    if (!player || player.role !== ROLES.THIEF) {
      await safeReply(interaction, { content: t('error.not_thief'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (!player.alive) {
      await safeReply(interaction, { content: t('error.you_are_dead'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier qu'il y a des cartes disponibles
    if (!game.thiefExtraRoles || game.thiefExtraRoles.length !== 2) {
      await safeReply(interaction, { content: t('error.action_forbidden'), flags: MessageFlags.Ephemeral });
      return;
    }

    const choice = interaction.options.getInteger("choice");
    if (choice !== 1 && choice !== 2) {
      await safeReply(interaction, { content: t('cmd.steal.invalid_choice'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Échanger le rôle
    const chosenRole = game.thiefExtraRoles[choice - 1];
    const oldRole = player.role;
    player.role = chosenRole;
    
    // Synchroniser avec la DB
    gameManager.db.updatePlayer(game.mainChannelId, player.id, { role: chosenRole });

    // Vider les cartes (le voleur a fait son choix)
    game.thiefExtraRoles = [];

    gameManager.clearNightAfkTimeout(game);
    gameManager.logAction(game, `Voleur vole la carte ${choice}: ${chosenRole} (ancien rôle: ${oldRole})`);
    try { gameManager.db.addNightAction(game.mainChannelId, game.dayCount || 0, 'steal', interaction.user.id, null); } catch (e) { /* ignore */ }

    await safeReply(interaction, { content: t('cmd.steal.success', { role: translateRole(chosenRole) }), flags: MessageFlags.Ephemeral });

    // Envoyer le nouveau rôle en DM
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
          embed.setImage(`attachment://${imageName}`);
        }

        await user.send({ embeds: [embed], files });
      }
    } catch (err) {
      // DM failed — ignore silently
    }

    // Si le voleur a pris un rôle de loup, mettre à jour les permissions du channel loups
    if (chosenRole === ROLES.WEREWOLF || chosenRole === ROLES.WHITE_WOLF) {
      try {
        await gameManager.updateChannelPermissions(interaction.guild, game);
      } catch (e) { /* ignore */ }
    }

    // Avancer à la sous-phase suivante
    await gameManager.advanceSubPhase(interaction.guild, game);
  }
};
