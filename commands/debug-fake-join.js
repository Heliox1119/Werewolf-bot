const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");
const gameManager = require("../game/gameManager");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("debug-fake-join")
    .setDescription("🐛 [DEBUG] Ajouter des joueurs fictifs")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addNumberOption(option =>
      option
        .setName("count")
        .setDescription("Nombre de joueurs à ajouter")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10)
    ),

  async execute(interaction) {
    if (!interaction.member.permissions.has("ADMINISTRATOR")) {
      await interaction.reply({ content: "❌ Admin only", flags: MessageFlags.Ephemeral });
      return;
    }

    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await interaction.reply({ content: "❌ Aucune partie ici", flags: MessageFlags.Ephemeral });
      return;
    }

    const count = interaction.options.getNumber("count");
    const names = ["Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace", "Henry", "Ivy", "Jack"];
    
    for (let i = 0; i < count; i++) {
      const fakeName = names[Math.floor(Math.random() * names.length)] + Math.random().toString().slice(2, 5);
      game.players.push({
        id: `fake_${Date.now()}_${i}`,
        username: fakeName,
        role: null,
        alive: true
      });
    }

    await interaction.reply({
      content: `✅ ${count} joueur(s) fictif(s) ajouté(s) !\n\n👥 Total : ${game.players.length} joueur(s)`,
      flags: MessageFlags.Ephemeral
    });
  }
};
