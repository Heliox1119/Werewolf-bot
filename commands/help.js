const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType
} = require("discord.js");

const COLORS = {
  PRIMARY: 0xFF6B6B,
  INFO: 0x4ECDC4,
  WARN: 0xFFD166
};

const buildOverviewEmbed = () =>
  new EmbedBuilder()
    .setTitle("🐺 Loup-Garou Bot — Aide")
    .setColor(COLORS.PRIMARY)
    .setDescription(
      "Bienvenue ! Choisis une section ci-dessous pour afficher l'aide detaillee."
    )
    .addFields(
      { name: "🚀 Demarrage rapide", value: "`/create` → lobby → `Rejoindre` → `Demarrer`", inline: false },
      { name: "⏩ Enchainement", value: "Les phases s'enchainent automatiquement.", inline: false }
    )
    .setFooter({ text: "Werewolf Bot • Aide" });

const buildSetupEmbed = () =>
  new EmbedBuilder()
    .setTitle("🧩 Mise en place")
    .setColor(COLORS.PRIMARY)
    .setDescription(
      "Tout se passe dans la categorie de jeu."
    )
    .addFields(
      { name: "🧪 Creer une partie", value: "`/create` — cree les salons (village, roles, vocal), lance l'ambiance et affiche le lobby. Utilise `min` et `max` si disponibles pour regler les joueurs.", inline: false },
      { name: "👥 Rejoindre", value: "`/join` — ajoute ton profil au lobby. Possible uniquement avant le demarrage.", inline: false },
      { name: "▶ Demarrer", value: "`/start` — distribue les roles en DM (embed + image), applique les permissions et lance la nuit.", inline: false }
    )
    .setFooter({ text: "Astuce: le lobby propose les boutons Rejoindre / Quitter / Demarrer" });

const buildNightEmbed = () =>
  new EmbedBuilder()
    .setTitle("🌙 Actions de nuit")
    .setColor(COLORS.INFO)
    .addFields(
      { name: "🐺 Loups", value: "Salon 🐺-loups — `/kill @joueur` pour designer la victime. Une seule cible pour la nuit.", inline: false },
      { name: "🔮 Voyante", value: "Salon 🔮-voyante — `/see @joueur` pour connaitre le role d'un joueur vivant.", inline: false },
      { name: "🧪 Sorciere", value: "Salon 🧪-sorciere — `/potion save` pour sauver la victime des loups, ou `/potion kill @joueur` pour empoisonner.", inline: false },
      { name: "❤️ Cupidon", value: "Salon ❤️-cupidon — `/love @a @b` pour lier deux amoureux (1ere nuit uniquement).", inline: false },
      { name: "👧 Petite Fille", value: "Salon 🏘️-village — `/listen` pour recevoir un resume des loups. Attention a ne pas te faire reperer.", inline: false }
    )
    .setFooter({ text: "Les phases nocturnes s'enchainent automatiquement" });

const buildDayEmbed = () =>
  new EmbedBuilder()
    .setTitle("☀️ Actions de jour")
    .setColor(COLORS.INFO)
    .addFields(
      { name: "🗳️ Vote", value: "Salon principal ou 🏘️-village — `/vote @joueur` pour eliminer quelqu'un. Le jour passe a la nuit quand tous les joueurs reels ont vote.", inline: false },
      { name: "🏅 Capitaine", value: "`/captainvote @joueur` pour voter. Ensuite `/declarecaptain` pour annoncer l'elu. Le capitaine a une voix x2.", inline: false },
      { name: "🏹 Chasseur", value: "`/shoot @joueur` uniquement si tu es elimine. Tu peux tirer une derniere fois.", inline: false }
    )
    .setFooter({ text: "Le jour passe a la nuit quand tous les joueurs reels ont vote" });

const buildAdminEmbed = () =>
  new EmbedBuilder()
    .setTitle("🛠️ Admin & Debug")
    .setColor(COLORS.WARN)
    .addFields(
      { name: "🧹 Fin de partie", value: "`/end` — termine la partie en cours et supprime les salons associes.", inline: false },
      { name: "🧯 Nettoyage", value: "`/clear` — supprime les salons residuels si le bot a crash ou si une partie est bloquee.", inline: false },
      { name: "⏭️ Debug phase", value: "`/nextphase` — admin uniquement pour forcer une transition.", inline: false },
      { name: "🐛 Debug", value: "`/debug-*` — outils de test (faux joueurs, reset, info).", inline: false }
    )
    .setFooter({ text: "Utilise ces commandes avec prudence" });

const HELP_SECTIONS = {
  overview: buildOverviewEmbed,
  setup: buildSetupEmbed,
  night: buildNightEmbed,
  day: buildDayEmbed,
  admin: buildAdminEmbed
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("📖 Afficher l'aide complète du bot Loup-Garou"),

  async execute(interaction) {
    const select = new StringSelectMenuBuilder()
      .setCustomId("help_menu")
      .setPlaceholder("Choisis une section")
      .addOptions(
        { label: "Vue d'ensemble", value: "overview", description: "Demarrage rapide et resume", emoji: "📌" },
        { label: "Mise en place", value: "setup", description: "Creer et demarrer une partie", emoji: "🧩" },
        { label: "Actions de nuit", value: "night", description: "Roles et commandes nocturnes", emoji: "🌙" },
        { label: "Actions de jour", value: "day", description: "Vote et capitaine", emoji: "☀️" },
        { label: "Admin & Debug", value: "admin", description: "Outils de moderation", emoji: "🛠️" }
      );

    const row = new ActionRowBuilder().addComponents(select);
    const embed = buildOverviewEmbed();

    await interaction.reply({
      embeds: [embed],
      components: [row],
      flags: MessageFlags.Ephemeral
    });

    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 120000
    });

    collector.on("collect", async (selectInteraction) => {
      if (selectInteraction.user.id !== interaction.user.id) {
        await selectInteraction.reply({ content: "❌ Seul l'auteur peut utiliser ce menu.", flags: MessageFlags.Ephemeral });
        return;
      }

      const key = selectInteraction.values[0];
      const builder = HELP_SECTIONS[key] || buildOverviewEmbed;
      await selectInteraction.update({ embeds: [builder()], components: [row] });
    });

    collector.on("end", async () => {
      try {
        select.setDisabled(true);
        await message.edit({ components: [new ActionRowBuilder().addComponents(select)] });
      } catch (e) {
        // Ignore edit failures
      }
    });
  }
};