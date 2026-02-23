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

    const min = interaction.options.getInteger("min");
    const max = interaction.options.getInteger("max");
    const wolfWin = interaction.options.getString("wolfwin");
    const game = gameManager.getGameByChannelId(interaction.channelId);

    // min/max nécessitent une partie en cours
    if ((min !== null || max !== null) && !game) {
      await interaction.editReply({ content: t('error.no_game_dot'), flags: MessageFlags.Ephemeral });
      return;
    }

    const ConfigManager = require('../utils/config');
    const config = ConfigManager.getInstance();
    const guildId = interaction.guildId;

    if (min === null && max === null && wolfWin === null) {
      // Afficher les règles actuelles
      const currentWolfWin = config.getWolfWinCondition(guildId);
      const wolfWinLabel = currentWolfWin === 'elimination' ? 'Élimination totale' : 'Majorité';
      const currentMin = game?.rules?.minPlayers ?? 5;
      const currentMax = game?.rules?.maxPlayers ?? 10;
      await interaction.editReply({
        content: t('cmd.setrules.current', {
          min: currentMin,
          max: currentMax,
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
      config.setWolfWinCondition(wolfWin, guildId);
    }

    if (game) gameManager.scheduleSave();
    const wolfWinLabel = config.getWolfWinCondition(guildId) === 'elimination' ? 'Élimination totale' : 'Majorité';
    await interaction.editReply({
      content: t('cmd.setrules.success_full', {
        min: game?.rules?.minPlayers ?? 5,
        max: game?.rules?.maxPlayers ?? 10,
        wolfwin: wolfWinLabel
      }),
      flags: MessageFlags.Ephemeral
    });
  }
};
