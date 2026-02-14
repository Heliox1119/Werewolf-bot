const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const { commands: logger } = require("../utils/logger");
const { t, translateRole } = require('../utils/i18n');
const ROLES = require("../game/roles");
const { isInGameCategory } = require("../utils/validators");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("start")
    .setDescription("Démarrer la partie"),

  async execute(interaction) {
    // Vérification catégorie
    if (!await isInGameCategory(interaction)) {
      await interaction.reply({ content: t('error.action_forbidden'), flags: MessageFlags.Ephemeral });
      return;
    }
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await interaction.reply({ content: t('error.no_game'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (game.players.length < (game.rules?.minPlayers || 5)) {
      await interaction.reply({ content: t('error.not_enough_players', { min: game.rules?.minPlayers || 5 }), flags: MessageFlags.Ephemeral });
      return;
    }
    const { safeDefer } = require('../utils/interaction');
    await safeDefer(interaction);

    // Construire la liste complète de rôles candidats
    const candidateRoles = [
      ROLES.WEREWOLF,
      ROLES.WEREWOLF,
      ROLES.SEER,
      ROLES.WITCH,
      ROLES.HUNTER,
      ROLES.PETITE_FILLE,
      ROLES.CUPID
    ];

    // Si il y a plus de rôles candidats que de joueurs, proposer une sélection
    let rolesToUse = candidateRoles.slice();
    if (candidateRoles.length > game.players.length) {
      // Interactive selection
      const embed = new EmbedBuilder()
        .setTitle(t('ui.role_select_title'))
        .setDescription(t('ui.role_select_desc', { n: candidateRoles.length, m: game.players.length }))
        .setColor(0x00AE86);

      const rows = [];
      // create buttons (max 5 per row)
      for (let i = 0; i < candidateRoles.length; i += 5) {
        const slice = candidateRoles.slice(i, i + 5);
        const actionRow = new ActionRowBuilder();
        for (let j = 0; j < slice.length; j++) {
          const idx = i + j;
          const btn = new ButtonBuilder()
            .setCustomId(`role_toggle:${idx}`)
            .setLabel(translateRole(slice[j]))
            .setStyle(ButtonStyle.Secondary);
          actionRow.addComponents(btn);
        }
        rows.push(actionRow);
      }

      // add confirm/cancel row
      const controlRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_roles').setLabel(t('ui.btn.confirm')).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('cancel_roles').setLabel(t('ui.btn.cancel')).setStyle(ButtonStyle.Danger)
      );
      rows.push(controlRow);

      const selMsg = await interaction.editReply({ embeds: [embed], components: rows });

      const collector = selMsg.createMessageComponentCollector({ time: 60000 });
      const selected = new Set(candidateRoles.map((r, idx) => idx));

      collector.on('collect', async i => {
        if (i.user.id !== interaction.user.id) {
          await i.reply({ content: t('error.only_initiator'), flags: MessageFlags.Ephemeral });
          return;
        }

        if (i.customId.startsWith('role_toggle:')) {
          const idx = parseInt(i.customId.split(':')[1], 10);
          if (selected.has(idx)) selected.delete(idx);
          else selected.add(idx);

          // build updated embed
          const selectedList = Array.from(selected).map(k => candidateRoles[k]);
          const description = t('ui.role_selected_desc', { n: selectedList.length, m: game.players.length, list: selectedList.map(r => translateRole(r)).join(', ') });
          const newEmbed = EmbedBuilder.from(embed).setDescription(description);
          await i.update({ embeds: [newEmbed], components: rows });
          return;
        }

        if (i.customId === 'confirm_roles') {
          const chosen = Array.from(selected).map(k => candidateRoles[k]);
          if (chosen.length !== game.players.length) {
            const diff = chosen.length - game.players.length;
            if (diff > 0) {
              await i.reply({ content: t('error.too_many_roles', { count: chosen.length, diff: diff }), flags: MessageFlags.Ephemeral });
            } else {
              await i.reply({ content: t('error.not_enough_roles', { count: chosen.length, diff: -diff }), flags: MessageFlags.Ephemeral });
            }
            return;
          }

          rolesToUse = chosen.slice();
          collector.stop('confirmed');
          await i.update({ content: t('cmd.roles_confirmed'), embeds: [], components: [] });
          return;
        }

        if (i.customId === 'cancel_roles') {
          collector.stop('cancelled');
          await i.update({ content: t('error.selection_cancelled'), embeds: [], components: [] });
          return;
        }
      });

      // wait until collector ends and check reason
      const endReason = await new Promise(resolve => {
        collector.on('end', async (collected, reason) => {
          if (reason !== 'confirmed') {
            if (reason === 'cancelled') {
              await interaction.followUp({ content: t('game.cancelled'), flags: MessageFlags.Ephemeral });
            } else {
              await interaction.followUp({ content: t('error.time_expired'), flags: MessageFlags.Ephemeral });
            }
          }
          resolve(reason);
        });
      });

      // Stop if not confirmed
      if (endReason !== 'confirmed') {
        return;
      }
    }

    // Appeler start avec les rôles choisis
    const startedGame = gameManager.start(interaction.channelId, rolesToUse);
    if (!startedGame) {
      await interaction.editReply(t('error.cannot_start'));
      return;
    }

    const success = await gameManager.postStartGame(interaction.guild, startedGame, interaction.client, interaction);
    if (!success) {
      await interaction.editReply(t('error.channel_creation_failed'));
      return;
    }

    await interaction.editReply(t('game.started_command'));
  }
};
