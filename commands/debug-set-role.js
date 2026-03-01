const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");
const gameManager = require("../game/gameManager");
const ROLES = require("../game/roles");
const { t } = require('../utils/i18n');

const ROLE_MAP = {
  WEREWOLF: ROLES.WEREWOLF,
  WHITE_WOLF: ROLES.WHITE_WOLF,
  VILLAGER: ROLES.VILLAGER,
  SEER: ROLES.SEER,
  WITCH: ROLES.WITCH,
  HUNTER: ROLES.HUNTER,
  PETITE_FILLE: ROLES.PETITE_FILLE,
  CUPID: ROLES.CUPID,
  SALVATEUR: ROLES.SALVATEUR,
  ANCIEN: ROLES.ANCIEN,
  IDIOT: ROLES.IDIOT,
  THIEF: ROLES.THIEF
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
          { name: "Loup Blanc", value: "WHITE_WOLF" },
          { name: "Villageois", value: "VILLAGER" },
          { name: "Voyante", value: "SEER" },
          { name: "Sorcière", value: "WITCH" },
          { name: "Chasseur", value: "HUNTER" },
          { name: "Petite Fille", value: "PETITE_FILLE" },
          { name: "Cupidon", value: "CUPID" },
          { name: "Salvateur", value: "SALVATEUR" },
          { name: "Ancien", value: "ANCIEN" },
          { name: "Idiot du Village", value: "IDIOT" },
          { name: "Voleur", value: "THIEF" }
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

    // Defer early — permission updates take several seconds
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await interaction.editReply({ content: t('error.no_game') });
      return;
    }

    const target = interaction.options.getUser("player") || interaction.user;
    const roleKey = interaction.options.getString("role");
    const newRole = ROLE_MAP[roleKey];

    const player = game.players.find(p => p.id === target.id);
    if (!player) {
      await interaction.editReply({ content: t('cmd.debug_set_role.player_not_found') });
      return;
    }

    player.role = newRole;
    gameManager.scheduleSave();

    // Refresh permissions so the player can access the right channels
    await gameManager.updateChannelPermissions(interaction.guild, game);
    await gameManager.updateVoicePerms(interaction.guild, game);

    await interaction.editReply({
      content: t('cmd.debug_set_role.success', { name: target.username, role: newRole })
    });
  }
};
