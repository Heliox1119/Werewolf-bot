const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");
const gameManager = require("../game/gameManager");
const { commands: logger } = require("../utils/logger");
const { t } = require('../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("debug-start-force")
    .setDescription("🐛 [DEBUG] Forcer le démarrage (ignore vérif joueurs)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.reply({ content: t('error.admin_only'), flags: MessageFlags.Ephemeral });
      return;
    }

    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await interaction.reply({ content: t('error.no_game'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (game.players.length === 0) {
      await interaction.reply({ content: t('cmd.debug_start_force.need_player'), flags: MessageFlags.Ephemeral });
      return;
    }

    const { safeDefer } = require('../utils/interaction');
    await safeDefer(interaction);

    // Utiliser gameManager.start() — bypass du minimum via override
    // Si pas assez de joueurs pour les rôles, start() complète avec les Villageois
    const startedGame = gameManager.start(interaction.channelId);
    if (!startedGame) {
      // start() échoue si minPlayers non atteint, forcer manuellement
      const game2 = gameManager.games.get(interaction.channelId);
      if (game2) {
        game2.rules = { ...game2.rules, minPlayers: 1 };
        const retried = gameManager.start(interaction.channelId);
        if (!retried) {
          await interaction.editReply(t('cmd.debug_start_force.cannot_start'));
          return;
        }
      } else {
        await interaction.editReply(t('cmd.debug_start_force.cannot_start'));
        return;
      }
    }

    const finalGame = gameManager.games.get(interaction.channelId);
    const setupSuccess = await gameManager.postStartGame(interaction.guild, finalGame, interaction.client, interaction);

    if (!setupSuccess) {
      await interaction.editReply(t('cmd.debug_start_force.setup_error'));
      return;
    }

    await interaction.editReply(t('cmd.debug_start_force.success'));
  }
};
