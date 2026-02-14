const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");
const gameManager = require("../game/gameManager");
const ROLES = require("../game/roles");
const { t } = require('../utils/i18n');

const ROLE_MAP = {
  WEREWOLF: ROLES.WEREWOLF,
  VILLAGER: ROLES.VILLAGER,
  SEER: ROLES.SEER,
  WITCH: ROLES.WITCH,
  HUNTER: ROLES.HUNTER,
  PETITE_FILLE: ROLES.PETITE_FILLE,
  CUPID: ROLES.CUPID
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("debug-set-role")
    .setDescription("🐛 [DEBUG] Forcer le role d'un joueur")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option
        .setName("role")
        .setDescription("Role a assigner")
        .setRequired(true)
        .addChoices(
          { name: "Loup-Garou", value: "WEREWOLF" },
          { name: "Villageois", value: "VILLAGER" },
          { name: "Voyante", value: "SEER" },
          { name: "Sorciere", value: "WITCH" },
          { name: "Chasseur", value: "HUNTER" },
          { name: "Petite Fille", value: "PETITE_FILLE" },
          { name: "Cupidon", value: "CUPID" }
        )
    )
    .addUserOption(option =>
      option
        .setName("player")
        .setDescription("Joueur cible (par defaut: toi)")
        .setRequired(false)
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

    const target = interaction.options.getUser("player") || interaction.user;
    const roleKey = interaction.options.getString("role");
    const newRole = ROLE_MAP[roleKey];

    const player = game.players.find(p => p.id === target.id);
    if (!player) {
      await interaction.reply({ content: t('cmd.debug_set_role.player_not_found'), flags: MessageFlags.Ephemeral });
      return;
    }

    player.role = newRole;
    gameManager.scheduleSave();

    // Refresh permissions so the player can access the right channels
    await gameManager.updateChannelPermissions(interaction.guild, game);
    await gameManager.updateVoicePerms(interaction.guild, game);

    await interaction.reply({
      content: t('cmd.debug_set_role.success', { name: target.username, role: newRole }),
      flags: MessageFlags.Ephemeral
    });
  }
};
