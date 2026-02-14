const { SlashCommandBuilder, MessageFlags } = require('discord.js');
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

    return safeReply(interaction, { content: t('cmd.captainvote.success', { name: target.username }), flags: MessageFlags.Ephemeral });
  }
};
