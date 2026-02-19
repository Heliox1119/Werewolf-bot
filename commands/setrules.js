const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const { checkCategoryAndDefer } = require("../utils/commands");
const { isAdmin } = require("../utils/validators");
const { t } = require('../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setrules")
    .setDescription("Définir le nombre min/max de joueurs et les conditions de victoire (admin)")
    .addIntegerOption(opt =>
      opt.setName("min")
        .setDescription("Nombre minimum de joueurs (3-6)")
        .setRequired(false)
    )
    .addIntegerOption(opt =>
      opt.setName("max")
        .setDescription("Nombre maximum de joueurs (min-20)")
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName("wolfwin")
        .setDescription("Condition de victoire des loups")
        .setRequired(false)
        .addChoices(
          { name: "Majorité (loups ≥ villageois)", value: "majority" },
          { name: "Élimination totale (tous les villageois morts)", value: "elimination" }
        )
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
    const wolfWin = interaction.options.getString("wolfwin");

    if (min === null && max === null && wolfWin === null) {
      // Afficher les règles actuelles
      const ConfigManager = require('../utils/config');
      const config = ConfigManager.getInstance();
      const currentWolfWin = config.getWolfWinCondition();
      const wolfWinLabel = currentWolfWin === 'elimination' ? 'Élimination totale' : 'Majorité';
      await interaction.editReply({
        content: t('cmd.setrules.current', {
          min: game.rules?.minPlayers ?? 5,
          max: game.rules?.maxPlayers ?? 10,
          wolfwin: wolfWinLabel
        }),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (min !== null || max !== null) {
      const newMin = min ?? game.rules?.minPlayers ?? 5;
      const newMax = max ?? game.rules?.maxPlayers ?? 10;
      if (newMin < 3 || newMin > 6) {
        await interaction.editReply({ content: t('error.min_out_of_range'), flags: MessageFlags.Ephemeral });
        return;
      }
      if (newMax < newMin || newMax > 20) {
        await interaction.editReply({ content: t('error.max_out_of_range'), flags: MessageFlags.Ephemeral });
        return;
      }
      game.rules = { ...game.rules, minPlayers: newMin, maxPlayers: newMax };
    }

    if (wolfWin) {
      const ConfigManager = require('../utils/config');
      const config = ConfigManager.getInstance();
      config.setWolfWinCondition(wolfWin);
    }

    gameManager.scheduleSave();
    const ConfigManager2 = require('../utils/config');
    const config2 = ConfigManager2.getInstance();
    const wolfWinLabel = config2.getWolfWinCondition() === 'elimination' ? 'Élimination totale' : 'Majorité';
    await interaction.editReply({
      content: t('cmd.setrules.success_full', {
        min: game.rules.minPlayers,
        max: game.rules.maxPlayers,
        wolfwin: wolfWinLabel
      }),
      flags: MessageFlags.Ephemeral
    });
  }
};
