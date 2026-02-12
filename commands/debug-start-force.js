const { SlashCommandBuilder, MessageFlags, EmbedBuilder, AttachmentBuilder, PermissionFlagsBits } = require("discord.js");
const path = require("path");
const gameManager = require("../game/gameManager");
const ROLES = require("../game/roles");
const { commands: logger } = require("../utils/logger");

function getRoleDescription(role) {
  const descriptions = {
    [ROLES.VILLAGER]: "Salon: 🏘️-village. Commande: /vote @joueur (voter le jour).",
    [ROLES.WEREWOLF]: "Salon: 🐺-loups. Commande: /kill @joueur (choisir la victime la nuit).",
    [ROLES.SEER]: "Salon: 🔮-voyante. Commande: /see @joueur (connaitre le role la nuit).",
    [ROLES.WITCH]: "Salon: 🧪-sorciere. Commandes: /potion save ou /potion kill @joueur (la nuit).",
    [ROLES.HUNTER]: "Salon: 🏘️-village. Commande: /shoot @joueur (si tu es elimine).",
    [ROLES.PETITE_FILLE]: "Salon: 🏘️-village. Commande: /listen (espionner les loups la nuit).",
    [ROLES.CUPID]: "Salon: ❤️-cupidon. Commande: /love @a @b (au debut de la partie)."
  };
  return descriptions[role] || "?";
}

function getRoleImageName(role) {
  const images = {
    [ROLES.WEREWOLF]: "loupSimple.webp",
    [ROLES.VILLAGER]: "villageois.webp",
    [ROLES.SEER]: "voyante.webp",
    [ROLES.WITCH]: "sorciere.png",
    [ROLES.HUNTER]: "chasseur.webp",
    [ROLES.PETITE_FILLE]: "petiteFille.webp",
    [ROLES.CUPID]: "cupidon.webp"
  };
  return images[role] || null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("debug-start-force")
    .setDescription("🐛 [DEBUG] Forcer le démarrage (ignore vérif joueurs)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.reply({ content: "❌ Admin only", flags: MessageFlags.Ephemeral });
      return;
    }

    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await interaction.reply({ content: "❌ Aucune partie ici", flags: MessageFlags.Ephemeral });
      return;
    }

    if (game.players.length === 0) {
      await interaction.reply({ content: "❌ Ajoute au moins 1 joueur d'abord", flags: MessageFlags.Ephemeral });
      return;
    }

    const { safeDefer } = require('../utils/interaction');
    await safeDefer(interaction);

    // Distribuer les rôles
    const candidateRoles = [
      ROLES.WEREWOLF,
      ROLES.WEREWOLF,
      ROLES.SEER,
      ROLES.WITCH,
      ROLES.HUNTER,
      ROLES.PETITE_FILLE,
      ROLES.CUPID
    ];

    let rolesPool = candidateRoles.slice(0, game.players.length);
    game.players.forEach(p => {
      const role = rolesPool.splice(Math.floor(Math.random() * rolesPool.length), 1)[0];
      p.role = role || ROLES.VILLAGER;
    });

    game.startedAt = Date.now();
    gameManager.logAction(game, 'Partie demarree (debug)');
    for (const p of game.players) {
      gameManager.logAction(game, `${p.username} => ${p.role}`);
    }

    const setupSuccess = await gameManager.updateChannelPermissions(
      interaction.guild,
      game
    );

    if (!setupSuccess) {
      await interaction.editReply(
        "❌ Erreur lors de setupChannels"
      );
      return;
    }

    await gameManager.updateVoicePerms(interaction.guild, game);
    await interaction.editReply("🌙 Jeu lancé en debug !");

    // Envoyer les rôles en DM
    for (const player of game.players) {
      if (player.id.startsWith("fake_")) continue; // Skip fake users
      try {
        const user = await interaction.client.users.fetch(player.id);
        const embed = new EmbedBuilder()
          .setTitle(`Ton role : ${player.role}`)
          .setDescription(getRoleDescription(player.role))
          .setColor(0xFF6B6B);

        const imageName = getRoleImageName(player.role);
        const files = [];
        if (imageName) {
          const imagePath = path.join(__dirname, "..", "img", imageName);
          files.push(new AttachmentBuilder(imagePath, { name: imageName }));
          embed.setImage(`attachment://${imageName}`);
        }

        await user.send({ embeds: [embed], files });
      } catch (err) {
        logger.debug(`Pas de DM pour ${player.id}`);
      }
    }

    // Messages systèmes
    const villageChannel = game.villageChannelId
      ? await interaction.guild.channels.fetch(game.villageChannelId)
      : await interaction.guild.channels.fetch(interaction.channelId);

    await villageChannel.send(
      `🌙 **LA NUIT TOMBE (DEBUG)**\n\n` +
      `Joueurs : ${game.players.map(p => `\`${p.username}\` (${p.role})`).join(", ")}\n\n` +
      `Utilisez \`/nextphase\` pour avancer !`
    );
  }
};
