const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const rateLimiter = require("../utils/rateLimiter");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ratelimit")
    .setDescription("Gérer le rate limiting (admin)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName("stats")
        .setDescription("Voir les statistiques globales")
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("user")
        .setDescription("Voir les stats d'un utilisateur")
        .addUserOption(option =>
          option
            .setName("utilisateur")
            .setDescription("L'utilisateur à vérifier")
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("reset")
        .setDescription("Réinitialiser les limites d'un utilisateur")
        .addUserOption(option =>
          option
            .setName("utilisateur")
            .setDescription("L'utilisateur à réinitialiser")
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("ban")
        .setDescription("Bannir temporairement un utilisateur")
        .addUserOption(option =>
          option
            .setName("utilisateur")
            .setDescription("L'utilisateur à bannir")
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option
            .setName("duree")
            .setDescription("Durée en minutes")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(1440)
        )
        .addStringOption(option =>
          option
            .setName("raison")
            .setDescription("Raison du ban")
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("unban")
        .setDescription("Débannir un utilisateur")
        .addUserOption(option =>
          option
            .setName("utilisateur")
            .setDescription("L'utilisateur à débannir")
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case "stats":
        await handleStats(interaction);
        break;
      case "user":
        await handleUserStats(interaction);
        break;
      case "reset":
        await handleReset(interaction);
        break;
      case "ban":
        await handleBan(interaction);
        break;
      case "unban":
        await handleUnban(interaction);
        break;
    }
  }
};

async function handleStats(interaction) {
  const stats = rateLimiter.getGlobalStats();

  const embed = new EmbedBuilder()
    .setTitle("📊 Rate Limiting - Statistiques Globales")
    .setColor(0x5865F2)
    .addFields(
      { name: "👥 Utilisateurs trackés", value: stats.totalUsers.toString(), inline: true },
      { name: "🚫 Utilisateurs bannis", value: stats.bannedUsers.toString(), inline: true },
      { name: "🪣 Buckets actifs", value: stats.totalBuckets.toString(), inline: true }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: 64 });
}

async function handleUserStats(interaction) {
  const user = interaction.options.getUser("utilisateur");
  const stats = rateLimiter.getUserStats(user.id);

  const embed = new EmbedBuilder()
    .setTitle(`📊 Rate Limiting - ${user.username}`)
    .setColor(stats.banned ? 0xFF0000 : 0x00FF00)
    .setDescription(stats.banned ? `🚫 **BANNI**: ${stats.banInfo.reason}` : "✅ Utilisateur actif");

  if (stats.banned) {
    const retryAfter = Math.ceil((stats.banInfo.bannedUntil - Date.now()) / 1000);
    embed.addFields({
      name: "⏱️ Débannissement dans",
      value: `${retryAfter}s (${stats.banInfo.violations} violations)`,
      inline: false
    });
  }

  const commandStats = Object.entries(stats.commands)
    .sort((a, b) => b[1].violations - a[1].violations)
    .slice(0, 10);

  if (commandStats.length > 0) {
    const commandsText = commandStats
      .map(([cmd, data]) => {
        const percent = Math.round((data.tokensRemaining / data.maxTokens) * 100);
        const bar = "█".repeat(Math.floor(percent / 10)) + "░".repeat(10 - Math.floor(percent / 10));
        return `\`${cmd.padEnd(15)}\` ${bar} ${data.tokensRemaining}/${data.maxTokens} (⚠️ ${data.violations.toFixed(1)})`;
      })
      .join("\n");

    embed.addFields({
      name: "🎮 Commandes utilisées",
      value: commandsText,
      inline: false
    });
  } else {
    embed.addFields({
      name: "🎮 Commandes",
      value: "Aucune commande utilisée récemment",
      inline: false
    });
  }

  await interaction.reply({ embeds: [embed], flags: 64 });
}

async function handleReset(interaction) {
  const user = interaction.options.getUser("utilisateur");
  
  rateLimiter.resetUser(user.id);

  const embed = new EmbedBuilder()
    .setTitle("✅ Rate Limits Réinitialisés")
    .setDescription(`Les limites de ${user.username} ont été réinitialisées.`)
    .setColor(0x00FF00)
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: 64 });
}

async function handleBan(interaction) {
  const user = interaction.options.getUser("utilisateur");
  const duration = interaction.options.getInteger("duree");
  const reason = interaction.options.getString("raison") || "ban manuel administrateur";

  rateLimiter.banUser(user.id, duration * 60 * 1000, reason);

  const embed = new EmbedBuilder()
    .setTitle("🚫 Utilisateur Banni")
    .setDescription(`${user.username} a été banni pour ${duration} minute(s).`)
    .addFields(
      { name: "Raison", value: reason, inline: false },
      { name: "Durée", value: `${duration} minute(s)`, inline: true },
      { name: "Admin", value: interaction.user.username, inline: true }
    )
    .setColor(0xFF0000)
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: 64 });
}

async function handleUnban(interaction) {
  const user = interaction.options.getUser("utilisateur");
  
  rateLimiter.unbanUser(user.id);

  const embed = new EmbedBuilder()
    .setTitle("✅ Utilisateur Débanni")
    .setDescription(`${user.username} a été débanni.`)
    .setColor(0x00FF00)
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: 64 });
}
