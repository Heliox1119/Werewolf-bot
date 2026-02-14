const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const { checkCategoryAndDefer } = require("../utils/commands");
const { isAdmin } = require("../utils/validators");
const { t } = require('../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setrules")
    .setDescription("Définir le nombre min/max de joueurs (admin)")
    .addIntegerOption(opt =>
      opt.setName("min")
        .setDescription("Nombre minimum de joueurs (3-6)")
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName("max")
        .setDescription("Nombre maximum de joueurs (min-20)")
        .setRequired(true)
    ),

  async execute(interaction) {
    // Vérification catégorie et defer
    if (!await checkCategoryAndDefer(interaction)) return;
    
    // Vérification admin
    if (!isAdmin(interaction)) {
      await interaction.editReply({ content: t('error.admin_required'), flags: MessageFlags.Ephemeral });
      return;
    }
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await interaction.editReply({ content: t('error.no_game_dot'), flags: MessageFlags.Ephemeral });
      return;
    }
    const min = interaction.options.getInteger("min");
    const max = interaction.options.getInteger("max");
    if (min < 3 || min > 6) {
      await interaction.editReply({ content: t('error.min_out_of_range'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (max < min || max > 20) {
      await interaction.editReply({ content: t('error.max_out_of_range'), flags: MessageFlags.Ephemeral });
      return;
    }
    game.rules = { minPlayers: min, maxPlayers: max };
    gameManager.scheduleSave();
    await interaction.editReply({ content: t('cmd.setrules.success', { min, max }), flags: MessageFlags.Ephemeral });
  }
};
