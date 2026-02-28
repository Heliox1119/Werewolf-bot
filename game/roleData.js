/**
 * roleData.js — Single Source of Truth for all role metadata.
 *
 * This file centralises every piece of role information (names, camps, images,
 * descriptions, commands, phases …) so that views, API responses and client-side
 * scripts can all derive from the same canonical data.
 *
 * ⚠️  `game/roles.js` is intentionally left untouched — the bot Discord layer
 *     still reads its simple ID→name map.  A future step can derive roles.js
 *     from this file (see README / refacto plan).
 *
 * Camp values — canonical: "village" | "wolves" | "solo"
 */

'use strict';

const roles = [
  // ────────────────────────── WOLVES ──────────────────────────
  {
    id: 'WEREWOLF',
    camp: 'wolves',
    image: 'loupSimple.webp',
    emoji: '🐺',
    classic: true,
    phase: 'night',
    cmd: '/kill @joueur',
    name: {
      fr: 'Loup-Garou',
      en: 'Werewolf',
    },
    desc: {
      fr: 'Chaque nuit, les loups-garous se réunissent pour dévorer un villageois.',
      en: 'Each night the werewolves gather and vote on a victim to devour.',
    },
    doc: {
      fr: 'Chaque nuit, les loups-garous se rassemblent dans un canal privé et votent une victime à dévorer avec /kill. Ils doivent atteindre un consensus. Le jour, ils se font passer pour des villageois.',
      en: 'Each night the werewolves gather in a private channel and vote on a victim to devour using /kill. They must reach consensus. During the day, they pretend to be villagers.',
    },
  },

  // ─────────────────────────── SOLO ───────────────────────────
  {
    id: 'WHITE_WOLF',
    camp: 'solo',
    image: 'loupBlanc.webp',
    emoji: '🐺',
    classic: false,
    phase: 'night',
    cmd: '/kill @joueur',
    name: {
      fr: 'Loup Blanc',
      en: 'White Wolf',
    },
    desc: {
      fr: 'Joue en solitaire. Une nuit sur deux, il peut dévorer un loup-garou. Gagne s\u2019il est le dernier.',
      en: 'A lone hunter. Every other night he can devour a fellow wolf. Wins only if he is the last one standing.',
    },
    doc: {
      fr: 'Apparaît comme un loup-garou et chasse avec la meute normalement. Mais une nuit sur deux, il peut aussi secrètement tuer un des autres loups. Gagne uniquement s\u2019il est le tout dernier joueur vivant — un vrai prédateur solitaire.',
      en: 'Appears as a werewolf and hunts with the pack normally. But every other night, can also secretly kill one of the other wolves. Wins only if he\'s the absolute last player standing — a true solo predator.',
    },
  },

  // ────────────────────────── VILLAGE ─────────────────────────
  {
    id: 'VILLAGER',
    camp: 'village',
    image: 'villageois.webp',
    emoji: '🧑‍🌾',
    classic: true,
    phase: 'day',
    cmd: '/vote @joueur',
    name: {
      fr: 'Villageois',
      en: 'Villager',
    },
    desc: {
      fr: 'Un simple villageois sans pouvoir spécial. Il doit démasquer les loups.',
      en: 'A simple villager with no special power. Must unmask the wolves.',
    },
    doc: {
      fr: 'Un simple villageois sans pouvoir spécial. Il doit utiliser la déduction, l\u2019observation et le vote pour démasquer les loups-garous. Le pilier de l\u2019équipe du village.',
      en: 'A simple villager with no special power. Must use deduction, observation and voting to unmask the wolves. The backbone of the village team.',
    },
  },
  {
    id: 'SEER',
    camp: 'village',
    image: 'voyante.webp',
    emoji: '🔮',
    classic: true,
    phase: 'night',
    cmd: '/see @joueur',
    name: {
      fr: 'Voyante',
      en: 'Seer',
    },
    desc: {
      fr: 'Chaque nuit, la voyante peut découvrir le rôle d\u2019un joueur.',
      en: 'Each night, the seer can discover one player\u2019s true role.',
    },
    doc: {
      fr: 'Chaque nuit, la voyante peut utiliser /see pour découvrir le vrai rôle d\u2019un joueur. Information vitale pour le village, mais elle doit rester cachée des loups.',
      en: 'Each night, the seer can use /see to discover one player\u2019s true role. Vital information for the village, but must stay hidden from the wolves.',
    },
  },
  {
    id: 'WITCH',
    camp: 'village',
    image: 'sorciere.png',
    emoji: '🧪',
    classic: true,
    phase: 'night',
    cmd: '/potion vie|mort @joueur',
    name: {
      fr: 'Sorcière',
      en: 'Witch',
    },
    desc: {
      fr: 'Possède une potion de vie et une potion de mort, utilisable une fois chacune.',
      en: 'Has a life potion and a death potion, each usable once per game.',
    },
    doc: {
      fr: 'Possède deux potions, chacune utilisable une fois par partie : une potion de vie pour sauver la victime des loups, et une potion de mort pour tuer un joueur. Elle apprend qui les loups ont ciblé chaque nuit.',
      en: 'Possesses two potions, each usable once per game: a life potion to save the wolves\u2019 victim, and a death potion to kill any player. Learns who the wolves targeted each night.',
    },
  },
  {
    id: 'HUNTER',
    camp: 'village',
    image: 'chasseur.webp',
    emoji: '🔫',
    classic: true,
    phase: 'death',
    cmd: '/shoot @joueur',
    name: {
      fr: 'Chasseur',
      en: 'Hunter',
    },
    desc: {
      fr: 'En mourant, le chasseur peut emporter un autre joueur avec lui.',
      en: 'When the hunter dies, he can take another player down with him.',
    },
    doc: {
      fr: 'Quand le chasseur meurt (quelle qu\u2019en soit la cause), il tire un dernier coup et peut emporter un autre joueur avec lui. Il a 90 secondes pour choisir sa cible.',
      en: 'When the hunter dies (by any cause), he fires a last shot and can take another player down with him. Has 90 seconds to choose a target.',
    },
  },
  {
    id: 'CUPID',
    camp: 'village',
    image: 'cupidon.webp',
    emoji: '💘',
    classic: false,
    phase: 'start',
    cmd: '/love @joueur1 @joueur2',
    name: {
      fr: 'Cupidon',
      en: 'Cupid',
    },
    desc: {
      fr: 'Désigne deux amoureux au début de la partie. Si l\u2019un meurt, l\u2019autre aussi.',
      en: 'Designates two lovers at the start. If one dies, the other dies too.',
    },
    doc: {
      fr: 'La toute première nuit, Cupidon désigne deux amoureux avec /love. Si l\u2019un des amoureux meurt, l\u2019autre meurt de chagrin. Si les amoureux sont de camps opposés, ils gagnent ensemble en duo unique.',
      en: 'On the very first night, Cupid designates two lovers with /love. If one lover dies, the other dies of a broken heart. If the lovers are from opposite camps, they win together as a unique pair.',
    },
  },
  {
    id: 'SALVATEUR',
    camp: 'village',
    image: 'salvateur.webp',
    emoji: '🛡️',
    classic: false,
    phase: 'night',
    cmd: '/protect @joueur',
    name: {
      fr: 'Salvateur',
      en: 'Guardian',
    },
    desc: {
      fr: 'Chaque nuit, il protège un joueur de l\u2019attaque des loups-garous.',
      en: 'Each night, he shields one player from the werewolves\u2019 attack.',
    },
    doc: {
      fr: 'Chaque nuit, le Salvateur protège un joueur de l\u2019attaque des loups-garous. Il ne peut pas protéger le même joueur deux nuits de suite.',
      en: 'Each night, the Guardian protects one player from the werewolves\u2019 attack. Cannot protect the same player two nights in a row.',
    },
  },
  {
    id: 'PETITE_FILLE',
    camp: 'village',
    image: 'petiteFille.webp',
    emoji: '👂',
    classic: false,
    phase: 'night',
    cmd: '/listen',
    name: {
      fr: 'Petite Fille',
      en: 'Little Girl',
    },
    desc: {
      fr: 'Peut espionner les loups-garous pendant la nuit, au risque de se faire repérer.',
      en: 'Can spy on the werewolves at night, at the risk of being noticed.',
    },
    doc: {
      fr: 'Peut espionner les loups-garous la nuit avec /listen, voyant des fragments de leur conversation. Risqué — si les loups la remarquent, ils peuvent la cibler.',
      en: 'Can spy on the werewolves at night using /listen, seeing fragments of their conversation. Risky — if the wolves notice her, they can target her.',
    },
  },
  {
    id: 'ANCIEN',
    camp: 'village',
    image: 'ancien.webp',
    emoji: '📜',
    classic: false,
    phase: 'passive',
    cmd: null,
    name: {
      fr: 'Ancien',
      en: 'Elder',
    },
    desc: {
      fr: 'Résiste à la première attaque des loups-garous grâce à sa robustesse.',
      en: 'Survives the first werewolf attack thanks to his resilience.',
    },
    doc: {
      fr: 'Résiste à la première attaque des loups-garous grâce à sa robustesse (2 vies contre les loups). S\u2019il est tué par le vote du village, tous les pouvoirs spéciaux des villageois sont supprimés pour le reste de la partie.',
      en: 'Survives the first werewolf attack thanks to his resilience (has 2 lives against wolves). If killed by the village vote, all special villager powers are drained for the rest of the game.',
    },
  },
  {
    id: 'IDIOT',
    camp: 'village',
    image: 'idiot.webp',
    emoji: '🤡',
    classic: false,
    phase: 'day',
    cmd: null,
    name: {
      fr: 'Idiot du Village',
      en: 'Village Idiot',
    },
    desc: {
      fr: 'S\u2019il est voté par le village, il est révélé mais perd son droit de vote.',
      en: 'If voted out by the village, he is revealed but loses his right to vote.',
    },
    doc: {
      fr: 'S\u2019il est éliminé par le vote du village pendant la journée, l\u2019Idiot est révélé mais survit — cependant, il perd définitivement son droit de vote. Il meurt normalement des attaques de loups.',
      en: 'If voted out by the village during the day, the Idiot is revealed but survives — however, he permanently loses his right to vote. Dies normally to wolf attacks.',
    },
  },
  {
    id: 'THIEF',
    camp: 'village',
    image: 'voleur.webp',
    emoji: '🃏',
    classic: false,
    phase: 'start',
    cmd: '/steal @carte',
    name: {
      fr: 'Voleur',
      en: 'Thief',
    },
    desc: {
      fr: 'Découvre 2 cartes au début et peut échanger son rôle. Si les deux sont des loups, il doit en prendre une.',
      en: 'Sees 2 extra cards at the start and can swap his role. If both are wolves, he must take one.',
    },
    doc: {
      fr: 'Au début de la partie, le Voleur voit 2 cartes-rôle supplémentaires face visible. Il peut choisir d\u2019échanger son rôle contre l\u2019une d\u2019elles. Si les deux cartes sont des loups-garous, il DOIT en prendre une. Agit la toute première nuit avant tous les autres rôles.',
      en: 'At the start of the game, the Thief sees 2 extra role cards dealt face-up. He can choose to swap his role for one of them. If both cards are werewolves, he MUST take one. Acts during the very first night before all other roles.',
    },
  },
];

// ── Helpers ──────────────────────────────────────────────────

/** @type {Map<string, object>} – indexed by role id for O(1) lookups */
const _byId = new Map(roles.map(r => [r.id, r]));

/**
 * Get a role object by its canonical ID (e.g. "WEREWOLF").
 * @param {string} id
 * @returns {object|undefined}
 */
function getRoleById(id) {
  return _byId.get(id);
}

/**
 * Get roles filtered by camp.
 * @param {"village"|"wolves"|"solo"} camp
 * @returns {object[]}
 */
function getRolesByCamp(camp) {
  return roles.filter(r => r.camp === camp);
}

/**
 * Build a simple { ID: frenchName } map — drop-in compatible with game/roles.js.
 * @returns {Object<string, string>}
 */
function toIdNameMap() {
  return Object.fromEntries(roles.map(r => [r.id, r.name.fr]));
}

// ── Exports ─────────────────────────────────────────────────

module.exports = roles;
module.exports.roles = roles;
module.exports.getRoleById = getRoleById;
module.exports.getRolesByCamp = getRolesByCamp;
module.exports.toIdNameMap = toIdNameMap;
