const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");
const gameManager = require("../game/gameManager");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("debug-info")
    .setDescription("🐛 [DEBUG] Afficher l'état de la partie")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

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

    const embed = new EmbedBuilder()
      .setTitle("🐛 Informations de Debug")
      .setColor(0x00FF00)
      .addFields(
        {
          name: "📊 Phase",
          value: game.phase,
          inline: true
        },
        {
          name: "☀️ Jour #",
          value: (game.dayCount || 0).toString(),
          inline: true
        },
        {
          name: "👥 Joueurs",
          value: game.players.length.toString(),
          inline: true
        },
        {
          name: "💀 Morts",
          value: game.dead.length.toString(),
          inline: true
        },
        {
          name: "⚔️ Capitaine",
          value: game.captainId ? `<@${game.captainId}>` : "Aucun",
          inline: true
        },
        {
          name: "❤️ Couples",
          value: game.lovers.length > 0 ? game.lovers.map(p => `${p[0].slice(0, 4)}...`).join(", ") : "Aucun",
          inline: true
        }
      );

    const playersList = game.players
      .map(p => `• \`${p.username}\` — **${p.role}** ${p.alive ? "✅" : "💀"}`)
      .join("\n");

    embed.addFields({ name: "👥 Liste des joueurs", value: playersList || "Vide", inline: false });

    const votesList = Array.from(game.votes.entries())
      .map(([id, count]) => {
        const voter = game.players.find(p => p.id === id);
        return `• \`${voter?.username || id}\` : ${count} votes`;
      })
      .join("\n");

    if (votesList) {
      embed.addFields({ name: "🗳️ Votes", value: votesList, inline: false });
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
};
