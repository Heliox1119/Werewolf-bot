const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const { isInGameCategory } = require("../utils/validators");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("join")
    .setDescription("Rejoindre la partie"),

  async execute(interaction) {
    // Vérification catégorie
    if (!await isInGameCategory(interaction)) {
      await interaction.reply({ content: "❌ Action interdite ici. Utilisez cette commande dans la catégorie dédiée au jeu.", flags: MessageFlags.Ephemeral });
      return;
    }
    const ok = gameManager.join(interaction.channelId, interaction.user);
    await interaction.reply(
      ok ? `✅ ${interaction.user.username} rejoint la partie`
         : "❌ Impossible de rejoindre"
    );
  }
};
