const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const rateLimiter = require("../utils/rateLimiter");
const { t } = require('../utils/i18n');
const { getColor } = require('../utils/theme');

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
    .setTitle(t('cmd.ratelimit.stats_title'))
    .setColor(getColor(interaction.guildId, 'blurple'))
    .addFields(
      { name: t('cmd.ratelimit.tracked_users'), value: stats.totalUsers.toString(), inline: true },
      { name: t('cmd.ratelimit.banned_users'), value: stats.bannedUsers.toString(), inline: true },
      { name: t('cmd.ratelimit.active_buckets'), value: stats.totalBuckets.toString(), inline: true }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: 64 });
}

async function handleUserStats(interaction) {
  const user = interaction.options.getUser("utilisateur");
  const stats = rateLimiter.getUserStats(user.id);

  const embed = new EmbedBuilder()
    .setTitle(t('cmd.ratelimit.user_title', { name: user.username }))
    .setColor(stats.banned ? getColor(interaction.guildId, 'error') : getColor(interaction.guildId, 'success'))
    .setDescription(stats.banned ? t('cmd.ratelimit.user_banned', { reason: stats.banInfo.reason }) : t('cmd.ratelimit.user_active'));

  if (stats.banned) {
    const retryAfter = Math.ceil((stats.banInfo.bannedUntil - Date.now()) / 1000);
    embed.addFields({
      name: t('cmd.ratelimit.unban_in'),
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
      name: t('cmd.ratelimit.commands_used'),
      value: commandsText,
      inline: false
    });
  } else {
    embed.addFields({
      name: t('cmd.ratelimit.commands'),
      value: t('cmd.ratelimit.no_commands'),
      inline: false
    });
  }

  await interaction.reply({ embeds: [embed], flags: 64 });
}

async function handleReset(interaction) {
  const user = interaction.options.getUser("utilisateur");
  
  rateLimiter.resetUser(user.id);

  const embed = new EmbedBuilder()
    .setTitle(t('cmd.ratelimit.reset_title'))
    .setDescription(t('cmd.ratelimit.reset_desc', { name: user.username }))
    .setColor(getColor(interaction.guildId, 'success'))
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: 64 });
}

async function handleBan(interaction) {
  const user = interaction.options.getUser("utilisateur");
  const duration = interaction.options.getInteger("duree");
  const reason = interaction.options.getString("raison") || t('cmd.ratelimit.default_ban_reason');

  rateLimiter.banUser(user.id, duration * 60 * 1000, reason);

  const embed = new EmbedBuilder()
    .setTitle(t('cmd.ratelimit.ban_title'))
    .setDescription(t('cmd.ratelimit.ban_desc', { name: user.username, duration }))
    .addFields(
      { name: t('cmd.ratelimit.reason'), value: reason, inline: false },
      { name: t('cmd.ratelimit.duration'), value: t('cmd.ratelimit.minutes', { n: duration }), inline: true },
      { name: t('cmd.ratelimit.admin'), value: interaction.user.username, inline: true }
    )
    .setColor(getColor(interaction.guildId, 'error'))
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: 64 });
}

async function handleUnban(interaction) {
  const user = interaction.options.getUser("utilisateur");
  
  rateLimiter.unbanUser(user.id);

  const embed = new EmbedBuilder()
    .setTitle(t('cmd.ratelimit.unban_title'))
    .setDescription(t('cmd.ratelimit.unban_desc', { name: user.username }))
    .setColor(getColor(interaction.guildId, 'success'))
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: 64 });
}
