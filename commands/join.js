const { SlashCommandBuilder } = require("discord.js");
const gameManager = require("../game/gameManager");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("join")
    .setDescription("Rejoindre la partie"),

  async execute(interaction) {
    // Vérification catégorie
    const channel = await interaction.guild.channels.fetch(interaction.channelId);
    if (channel.parentId !== '1469976287790633146') {
      await interaction.reply({ content: "❌ Action interdite ici. Utilisez cette commande dans la catégorie dédiée au jeu.", flags: 64 });
      return;
    }
    const ok = gameManager.join(interaction.channelId, interaction.user);
    await interaction.reply(
      ok ? `✅ ${interaction.user.username} rejoint la partie`
         : "❌ Impossible de rejoindre"
    );
  }
};
