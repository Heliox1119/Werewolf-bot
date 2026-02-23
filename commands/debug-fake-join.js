const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");
const gameManager = require("../game/gameManager");
const { t } = require('../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("debug-fake-join")
    .setDescription("🐛 [DEBUG] Ajouter des joueurs fictifs")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption(option =>
      option
        .setName("count")
        .setDescription("Nombre de joueurs à ajouter")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(20)
    ),

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

    const count = interaction.options.getInteger("count");
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

    // Rafraîchir le lobby embed
    try {
      if (game.lobbyMessageId) {
        const channel = await interaction.guild.channels.fetch(game.mainChannelId);
        const lobbyMsg = await channel.messages.fetch(game.lobbyMessageId);
        const { buildLobbyMessage } = require('../utils/lobbyBuilder');
        const payload = buildLobbyMessage(game, game.lobbyHostId);
        await lobbyMsg.edit(payload);
      }
    } catch (e) { /* ignore */ }

    await interaction.reply({
      content: t('cmd.debug_fake_join.success', { count, total: game.players.length }),
      flags: MessageFlags.Ephemeral
    });
  }
};
