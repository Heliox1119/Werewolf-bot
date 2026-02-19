const { SlashCommandBuilder, MessageFlags, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const gameManager = require('../game/gameManager');
const { isInGameCategory } = require('../utils/validators');
const { safeReply } = require('../utils/interaction');
const { t } = require('../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('captainvote')
    .setDescription('Voter pour le capitaine (premier jour uniquement, dans le salon village)')
    .addUserOption(opt => opt.setName('target').setDescription('La personne à élire').setRequired(true)),

  async execute(interaction) {
    // Vérification catégorie
    if (!await isInGameCategory(interaction)) {
      return safeReply(interaction, { content: t('error.action_forbidden'), flags: MessageFlags.Ephemeral });
    }
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) return safeReply(interaction, { content: t('error.no_game'), flags: MessageFlags.Ephemeral });
    if (interaction.channelId !== game.villageChannelId) {
      return safeReply(interaction, { content: t('error.only_village_channel'), flags: MessageFlags.Ephemeral });
    }

    const target = interaction.options.getUser('target');
    const res = gameManager.voteCaptain(game.mainChannelId, interaction.user.id, target.id);

    if (!res.ok) {
      let msg = t('error.cannot_vote');
      switch (res.reason) {
        case 'not_day': msg = t('error.not_day'); break;
        case 'wrong_phase': msg = t('error.wrong_phase'); break;
        case 'captain_already': msg = t('error.captain_already'); break;
        case 'not_in_game': msg = t('error.not_in_game'); break;
        case 'voter_dead': msg = t('error.voter_dead'); break;
        case 'target_not_found': msg = t('error.target_invalid'); break;
        case 'target_dead': msg = t('error.target_dead'); break;
      }
      return safeReply(interaction, { content: msg, flags: MessageFlags.Ephemeral });
    }

    // Vote enregistré — annoncer dans le village
    const villageChannel = game.villageChannelId
      ? await interaction.guild.channels.fetch(game.villageChannelId)
      : await interaction.guild.channels.fetch(game.mainChannelId);

    if (res.allVoted && res.resolution && res.resolution.ok) {
      // Tous ont voté — le capitaine est élu automatiquement
      const resolution = res.resolution;
      const msgKey = resolution.wasTie ? 'game.captain_random_elected' : 'cmd.captain.elected';
      await safeReply(interaction, { content: t('cmd.captainvote.success', { name: target.username }), flags: MessageFlags.Ephemeral });
      await villageChannel.send(t(msgKey, { name: resolution.username }));
      gameManager.logAction(game, `Capitaine élu: ${resolution.username}${resolution.wasTie ? ' (égalité, tirage au sort)' : ''}`);

      // Envoyer le DM au capitaine
      try {
        const user = await interaction.client.users.fetch(resolution.winnerId);
        const imageName = 'capitaine.webp';
        const imagePath = path.join(__dirname, '..', 'img', imageName);
        const embed = new EmbedBuilder()
          .setTitle(t('cmd.captain.dm_title'))
          .setDescription(t('cmd.captain.dm_desc'))
          .setColor(0xFFD166)
          .setImage(`attachment://${imageName}`);
        await user.send({ embeds: [embed], files: [new AttachmentBuilder(imagePath, { name: imageName })] });
      } catch (err) { /* Ignore DM failures */ }

      // Avancer vers la délibération
      await gameManager.advanceSubPhase(interaction.guild, game);
    } else {
      // Vote enregistré, pas encore tout le monde
      const info = res.voted !== undefined ? ` (${res.voted}/${res.total})` : '';
      await safeReply(interaction, { content: t('cmd.captainvote.success', { name: target.username }) + info, flags: MessageFlags.Ephemeral });
      await villageChannel.send(t('cmd.captainvote.public', { voter: interaction.user.username, target: target.username, voted: res.voted || '?', total: res.total || '?' }));
    }
  }
};
