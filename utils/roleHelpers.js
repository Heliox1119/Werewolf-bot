const ROLES = require('../game/roles');
const { t } = require('./i18n');

function getRoleDescription(role) {
  const descriptions = {
    [ROLES.WEREWOLF]: t('role.instruction.werewolf'),
    [ROLES.VILLAGER]: t('role.instruction.villager'),
    [ROLES.SEER]: t('role.instruction.seer'),
    [ROLES.WITCH]: t('role.instruction.witch'),
    [ROLES.HUNTER]: t('role.instruction.hunter'),
    [ROLES.PETITE_FILLE]: t('role.instruction.petite_fille'),
    [ROLES.CUPID]: t('role.instruction.cupid')
  };
  return descriptions[role] || t('role.instruction.unknown');
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

module.exports = { getRoleDescription, getRoleImageName };
