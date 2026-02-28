const { t } = require('../utils/i18n');
const gameManager = require('../game/gameManager');

module.exports = {
  name: 'debug-toggle-fakephases',
  description: 'Active/désactive les phases pour les bots/fake joueurs',
  async execute(interaction) {
    if (!interaction.member?.permissions?.has('ADMINISTRATOR')) {
      await interaction.reply({ content: 'Permission refusée.', ephemeral: true });
      return;
    }
    const game = gameManager.getGameByChannel(interaction.channelId);
    if (!game) {
      await interaction.reply({ content: 'Aucune partie active.', ephemeral: true });
      return;
    }
    game.skipFakePhases = !game.skipFakePhases;
    await interaction.reply({ content: `Phases des bots/fake joueurs: ${game.skipFakePhases ? 'désactivées (skip)' : 'activées (jouées)'}` });
  }
};
