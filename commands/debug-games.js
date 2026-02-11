const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");
const gameManager = require("../game/gameManager");
const { commands: logger } = require("../utils/logger");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("debug-games")
    .setDescription("🐛 [DEBUG] Afficher toutes les parties actives")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.member.permissions.has("ADMINISTRATOR")) {
      await interaction.reply({ content: "❌ Admin only", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    logger.info('Debug-games command called', { 
      gamesCount: gameManager.games.size 
    });

    const gamesCount = gameManager.games.size;

    if (gamesCount === 0) {
      await interaction.editReply("📊 **Aucune partie active**");
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("🐛 Parties Actives")
      .setColor(0x00FF00)
      .setDescription(`${gamesCount} partie(s) en cours`);

    for (const [channelId, game] of gameManager.games.entries()) {
      const channelName = await interaction.guild.channels.fetch(channelId)
        .then(ch => ch.name)
        .catch(() => "Inconnu");

      const value = [
        `📺 Channel: <#${channelId}>`,
        `📊 Phase: ${game.phase}`,
        `👥 Joueurs: ${game.players.length}`,
        `💀 Morts: ${game.dead.length}`,
        `🎮 Host: ${game.lobbyHostId ? `<@${game.lobbyHostId}>` : 'N/A'}`,
        `🎤 Voice: ${game.voiceChannelId ? `<#${game.voiceChannelId}>` : 'N/A'}`,
        `🏘️ Village: ${game.villageChannelId ? `<#${game.villageChannelId}>` : 'N/A'}`
      ].join('\n');

      embed.addFields({
        name: `🎮 Partie: ${channelName}`,
        value: value,
        inline: false
      });
    }

    // Add technical info
    embed.addFields({
      name: "🔧 Info Technique",
      value: [
        `Channel actuel: <#${interaction.channelId}>`,
        `IDs parties: ${Array.from(gameManager.games.keys()).map(id => `\`${id}\``).join(', ')}`,
        `Map size: ${gameManager.games.size}`
      ].join('\n'),
      inline: false
    });

    await interaction.editReply({ embeds: [embed] });
  }
};
