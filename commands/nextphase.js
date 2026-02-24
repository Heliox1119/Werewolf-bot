const { SlashCommandBuilder, ChannelType, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const PHASES = require("../game/phases");
const { isInGameCategory } = require("../utils/validators");
const { t } = require('../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("nextphase")
    .setDescription("Passer à la phase suivante (Nuit ↔ Jour)"),

  async execute(interaction) {
    if (!interaction.member.permissions.has('Administrator')) {
      const { safeReply } = require('../utils/interaction');
      await safeReply(interaction, { content: t('error.admin_only'), flags: MessageFlags.Ephemeral });
      return;
    }
    // Vérification catégorie
    if (!await isInGameCategory(interaction)) {
      const { safeReply } = require('../utils/interaction');
      await safeReply(interaction, { content: t('error.action_forbidden'), flags: MessageFlags.Ephemeral });
      return;
    }
    const { safeDefer } = require('../utils/interaction');
    await safeDefer(interaction);
    if (gameManager.isRecentDuplicate('nextphase', interaction.channelId, interaction.user.id)) {
      return;
    }
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await interaction.editReply({ content: t('error.no_game'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (game.phase === PHASES.ENDED) {
      await interaction.editReply(t('error.game_ended'));
      return;
    }

    if (game.phase === PHASES.NIGHT) {
      await gameManager.transitionToDay(interaction.guild, game);
      await interaction.editReply(t('cmd.nextphase.success'));
      return;
    }

    if (game.phase === PHASES.DAY) {
      await gameManager.transitionToNight(interaction.guild, game);
      await interaction.editReply(t('cmd.nextphase.success'));
      return;
    }
  }
};
