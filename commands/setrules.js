const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const { checkCategoryAndDefer } = require("../utils/commands");
const { isAdmin } = require("../utils/validators");

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
      await interaction.editReply({ content: "❌ Tu dois être administrateur", flags: MessageFlags.Ephemeral });
      return;
    }
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await interaction.reply({ content: "❌ Aucune partie ici", flags: MessageFlags.Ephemeral });
      return;
    }
    const min = interaction.options.getInteger("min");
    const max = interaction.options.getInteger("max");
    if (min < 3 || min > 6) {
      await interaction.reply({ content: "❌ Le minimum doit être entre 3 et 6.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (max < min || max > 20) {
      await interaction.reply({ content: "❌ Le maximum doit être entre le minimum et 20.", flags: MessageFlags.Ephemeral });
      return;
    }
    game.rules = { minPlayers: min, maxPlayers: max };
    gameManager.scheduleSave();
    await interaction.editReply({ content: `✅ Règles mises à jour : min ${min}, max ${max} joueurs.`, flags: MessageFlags.Ephemeral });
  }
};
