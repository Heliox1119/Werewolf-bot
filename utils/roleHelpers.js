const ROLES = require('../game/roles');

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

module.exports = { getRoleDescription, getRoleImageName };
