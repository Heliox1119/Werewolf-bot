const { SlashCommandBuilder } = require("discord.js");
const gameManager = require("../game/gameManager");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("status")
    .setDescription("Voir l'état de la partie"),

  async execute(interaction) {
    // Vérification catégorie
    const channel = await interaction.guild.channels.fetch(interaction.channelId);
    if (channel.parentId !== '1469976287790633146') {
      await interaction.reply({ content: "❌ Action interdite ici. Utilisez cette commande dans la catégorie dédiée au jeu.", flags: 64 });
      return;
    }
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) return interaction.reply("❌ Aucune partie ici");
    const alive = game.players.filter(p => p.alive);
    const dead = game.players.filter(p => !p.alive);
    let message = `🎭 **État de la Partie**\n\n`;
    message += `📍 **Phase**: ${game.phase}\n`;
    message += `🧑 **Vivants**: ${alive.length}\n`;
    message += `⚰️ **Morts**: ${dead.length}\n`;
    if (game.captainId) {
      const cap = game.players.find(p => p.id === game.captainId);
      if (cap) message += `\n👑 **Capitaine**: ${cap.username}\n`;
    }
    message += `\n`;
    if (alive.length > 0) {
      message += `**Vivants:**\n${alive.map(p => `  • ${p.username}`).join("\n")}\n\n`;
    }
    if (dead.length > 0) {
      message += `**Morts:**\n${dead.map(p => `  • ${p.username}`).join("\n")}`;
    }
    const victory = gameManager.checkVictory(interaction.channelId);
    if (victory) {
      message += `\n\n🏆 **${victory}** a gagné!`;
    }
    await interaction.reply(message);
  }
};
