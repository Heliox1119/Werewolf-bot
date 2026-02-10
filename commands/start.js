const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, AttachmentBuilder, MessageFlags } = require("discord.js");
const path = require("path");
const gameManager = require("../game/gameManager");
const { commands: logger } = require("../utils/logger");
const ROLES = require("../game/roles");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("start")
    .setDescription("Démarrer la partie"),

  async execute(interaction) {
    // Vérification catégorie
    const channel = await interaction.guild.channels.fetch(interaction.channelId);
    if (channel.parentId !== '1469976287790633146') {
      await interaction.reply({ content: "❌ Action interdite ici. Utilisez cette commande dans la catégorie dédiée au jeu.", flags: MessageFlags.Ephemeral });
      return;
    }
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await interaction.reply("❌ Aucune partie ici");
      return;
    }
    if (game.players.length < 5) {
      await interaction.reply("❌ Impossible de démarrer (minimum 5 joueurs)");
      return;
    }
    const { safeDefer } = require('../utils/interaction');
    await safeDefer(interaction);

    // Construire la liste complète de rôles candidats
    const candidateRoles = [
      ROLES.WEREWOLF,
      ROLES.WEREWOLF,
      ROLES.SEER,
      ROLES.WITCH,
      ROLES.HUNTER,
      ROLES.PETITE_FILLE,
      ROLES.CUPID
    ];

    // Si il y a plus de rôles candidats que de joueurs, proposer une sélection
    let rolesToUse = candidateRoles.slice();
    if (candidateRoles.length > game.players.length) {
      // Interactive selection
      const embed = new EmbedBuilder()
        .setTitle('Sélection des rôles')
        .setDescription(`Il y a ${candidateRoles.length} rôles candidats pour ${game.players.length} joueurs. Désélectionne les rôles à retirer puis confirme.`)
        .setColor(0x00AE86);

      const rows = [];
      // create buttons (max 5 per row)
      for (let i = 0; i < candidateRoles.length; i += 5) {
        const slice = candidateRoles.slice(i, i + 5);
        const actionRow = new ActionRowBuilder();
        for (let j = 0; j < slice.length; j++) {
          const idx = i + j;
          const btn = new ButtonBuilder()
            .setCustomId(`role_toggle:${idx}`)
            .setLabel(slice[j])
            .setStyle(ButtonStyle.Secondary);
          actionRow.addComponents(btn);
        }
        rows.push(actionRow);
      }

      // add confirm/cancel row
      const controlRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_roles').setLabel('Confirmer').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('cancel_roles').setLabel('Annuler').setStyle(ButtonStyle.Danger)
      );
      rows.push(controlRow);

      const selMsg = await interaction.editReply({ embeds: [embed], components: rows });

      const collector = selMsg.createMessageComponentCollector({ time: 60000 });
      const selected = new Set(candidateRoles.map((r, idx) => idx));

      collector.on('collect', async i => {
        if (i.user.id !== interaction.user.id) {
          await i.reply({ content: 'Seul·e l\'initiateur·ice peut configurer les rôles', flags: MessageFlags.Ephemeral });
          return;
        }

        if (i.customId.startsWith('role_toggle:')) {
          const idx = parseInt(i.customId.split(':')[1], 10);
          if (selected.has(idx)) selected.delete(idx);
          else selected.add(idx);

          // build updated embed
          const selectedList = Array.from(selected).map(k => candidateRoles[k]);
          const description = `Rôles sélectionnés (${selectedList.length}/${game.players.length}):\n${selectedList.join(', ')}`;
          const newEmbed = EmbedBuilder.from(embed).setDescription(description);
          await i.update({ embeds: [newEmbed], components: rows });
          return;
        }

        if (i.customId === 'confirm_roles') {
          const chosen = Array.from(selected).map(k => candidateRoles[k]);
          if (chosen.length !== game.players.length) {
            const diff = chosen.length - game.players.length;
            if (diff > 0) {
              await i.reply({ content: `❌ Trop de rôles sélectionnés (${chosen.length}). Désélectionne ${diff} rôles.`, flags: MessageFlags.Ephemeral });
            } else {
              await i.reply({ content: `❌ Pas assez de rôles sélectionnés (${chosen.length}). Sélectionne ${-diff} rôles supplémentaires.`, flags: MessageFlags.Ephemeral });
            }
            return;
          }

          rolesToUse = chosen.slice();
          collector.stop('confirmed');
          await i.update({ content: '✅ Rôles confirmés, démarrage de la partie...', embeds: [], components: [] });
          return;
        }

        if (i.customId === 'cancel_roles') {
          collector.stop('cancelled');
          await i.update({ content: '❌ Sélection annulée.', embeds: [], components: [] });
          return;
        }
      });

      // wait until collector ends and check reason
      const endReason = await new Promise(resolve => {
        collector.on('end', async (collected, reason) => {
          if (reason !== 'confirmed') {
            if (reason === 'cancelled') {
              await interaction.followUp({ content: 'Démarrage annulé.', flags: MessageFlags.Ephemeral });
            } else {
              await interaction.followUp({ content: '❌ Temps écoulé, démarrage annulé.', flags: MessageFlags.Ephemeral });
            }
          }
          resolve(reason);
        });
      });

      // Stop if not confirmed
      if (endReason !== 'confirmed') {
        return;
      }
    }

    // Appeler start avec les rôles choisis
    const startedGame = gameManager.start(interaction.channelId, rolesToUse);
    if (!startedGame) {
      await interaction.editReply('❌ Impossible de démarrer la partie.');
      return;
    }

    const setupSuccess = await gameManager.updateChannelPermissions(
      interaction.guild,
      startedGame
    );

    if (!setupSuccess) {
      await interaction.editReply(
        "❌ **Erreur lors de la création des channels !**\n\n" +
        "Vérifications :\n" +
        "1. Le bot a-t-il la permission **Manage Channels** ?\n" +
        "2. Le bot est-il au-dessus des rôles utilisateurs ?\n" +
        "3. Regarde la console du bot pour plus de détails"
      );
      return;
    }

    // Initialiser les permissions vocales (mute tous les joueurs la nuit)
    await gameManager.updateVoicePerms(interaction.guild, startedGame);

    await interaction.editReply("🌙 La nuit tombe… channels privés créés et rôles envoyés !");

    // Envoyer les rôles en DM (ignorer les IDs non-valide, ex: joueurs fake_...)
    for (const player of startedGame.players) {
      if (typeof player.id !== 'string' || !/^\d+$/.test(player.id)) {
        console.log(`[Loup-Garou] Skip DM for non-snowflake id: ${player.id}`);
        continue;
      }

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

        logger.info('DM send', { userId: user.id, username: user.username, content: '[role embed]' });
        await user.send({ embeds: [embed], files });
      } catch (err) {
        console.error(`[Loup-Garou] Erreur envoi DM rôle à ${player.id}:`, err.message);
      }
    }

    // Messages dans les channels privés
    if (startedGame.wolvesChannelId) {
      const wolvesChannel = await interaction.guild.channels.fetch(startedGame.wolvesChannelId);
      const wolves = startedGame.players.filter(p => p.role === ROLES.WEREWOLF);
      logger.info('Channel send', { channelId: wolvesChannel.id, channelName: wolvesChannel.name, content: '[wolves welcome]' });
      await wolvesChannel.send(
        `🐺 **Bienvenue aux Loups-Garous !**\n` +
        `Vous êtes ${wolves.length} dans cette nuit.\n` +
        `Utilisez \`/kill @joueur\` pour désigner votre victime.`
      );
    }

    if (startedGame.seerChannelId) {
      const seerChannel = await interaction.guild.channels.fetch(startedGame.seerChannelId);
      logger.info('Channel send', { channelId: seerChannel.id, channelName: seerChannel.name, content: '[seer welcome]' });
      await seerChannel.send(
        `🔮 **Bienvenue, Voyante !**\n` +
        `Utilisez \`/see @joueur\` pour découvrir le rôle d'un joueur.`
      );
    }

    if (startedGame.witchChannelId) {
      const witchChannel = await interaction.guild.channels.fetch(startedGame.witchChannelId);
      logger.info('Channel send', { channelId: witchChannel.id, channelName: witchChannel.name, content: '[witch welcome]' });
      await witchChannel.send(
        `🧪 **Bienvenue, Sorcière !**\n` +
        `Tu possèdes 2 potions : une de **vie** et une de **mort**.\n` +
        `Utilise \`/potion save\` ou \`/potion kill @joueur\``
      );
    }

    // Message dans le channel village (système)
    const villageChannel = startedGame.villageChannelId
      ? await interaction.guild.channels.fetch(startedGame.villageChannelId)
      : await interaction.guild.channels.fetch(interaction.channelId);

    logger.info('Channel send', { channelId: villageChannel.id, channelName: villageChannel.name, content: '[night system message]' });
    await villageChannel.send(
      `🌙 **LA NUIT TOMBE**\n\n` +
      `✅ Les rôles ont été distribués en DM\n` +
      `✅ Channels privés créés pour les rôles spéciaux\n` +
      `🎤 **Rejoignez le channel vocal 🎤-partie**\n\n` +
      `**Cette nuit :**\n` +
      `• Les loups choisissent leur victime avec \`/kill @joueur\` (dans leur channel)\n` +
      `• Les autres ne peuvent PAS parler (micros coupés)\n\n` +
      `Utilisez \`/nextphase\` pour passer au jour quand la nuit est finie !`
    );
  }
};

function getRoleDescription(role) {
  const descriptions = {
    [ROLES.WEREWOLF]: "Salon: 🐺-loups. Commande: /kill @joueur (choisir la victime la nuit).",
    [ROLES.VILLAGER]: "Salon: 🏘️-village. Commande: /vote @joueur (voter le jour).",
    [ROLES.SEER]: "Salon: 🔮-voyante. Commande: /see @joueur (connaitre le role la nuit).",
    [ROLES.WITCH]: "Salon: 🧪-sorciere. Commandes: /potion save ou /potion kill @joueur (la nuit).",
    [ROLES.HUNTER]: "Salon: 🏘️-village. Commande: /shoot @joueur (si tu es elimine).",
    [ROLES.PETITE_FILLE]: "Salon: 🏘️-village. Commande: /listen (espionner les loups la nuit).",
    [ROLES.CUPID]: "Salon: ❤️-cupidon. Commande: /love @a @b (au debut de la partie)."
  };
  return descriptions[role] || "Rôle inconnu";
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
