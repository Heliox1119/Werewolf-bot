# ⚡ Best Practices - Interactions Discord

## 🚨 Règle Critique : Les 3 Secondes

Discord exige qu'une interaction soit **defer** ou **reply** dans les **3 secondes** maximum.

### ❌ Ce qui cause l'expiration (Code 10062)

```javascript
// MAUVAIS : Vérification AVANT defer
async execute(interaction) {
  const channel = await interaction.guild.channels.fetch(channelId); // API lente
  if (channel.parentId !== CATEGORY_ID) {
    await interaction.reply("❌ Mauvaise catégorie"); // TROP TARD !
    return;
  }
  await interaction.deferReply(); // Expire si > 3s
}
```

### ✅ Solution : Defer IMMÉDIATEMENT

```javascript
// BON : Defer AVANT vérifications
async execute(interaction) {
  // 1. Defer IMMÉDIATEMENT (< 3 secondes)
  await interaction.deferReply();
  
  // 2. Vérifications (peuvent prendre du temps)
  const channel = await interaction.guild.channels.fetch(channelId);
  if (channel.parentId !== CATEGORY_ID) {
    // Utiliser editReply car déjà defer
    await interaction.editReply("❌ Mauvaise catégorie");
    return;
  }
  
  // 3. Traitement long
  // ...
}
```

## 📋 Ordre des Opérations

### 1️⃣ Defer TOUJOURS en premier

```javascript
async execute(interaction) {
  // Defer AVANT TOUT
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply();
  }
  
  // Maintenant on peut prendre notre temps
  const game = gameManager.games.get(channelId);
  const validated = await validatePlayer(interaction);
  // ...
}
```

### 2️⃣ Utiliser editReply après defer

```javascript
// Après defer, utiliser editReply
await interaction.deferReply();

// Plus tard...
await interaction.editReply("✅ Opération terminée !");
```

### 3️⃣ Gérer les erreurs proprement

```javascript
try {
  await interaction.deferReply();
} catch (err) {
  if (err.code === 10062) {
    // Interaction déjà expirée, on ne peut plus rien faire
    console.error('Interaction expired');
    return;
  }
  throw err;
}
```

## 🚀 Optimisations

### Cache prioritaire

```javascript
// ❌ MAUVAIS : Fetch systématique (lent)
const channel = await guild.channels.fetch(channelId);

// ✅ BON : Cache d'abord (instantané)
const channel = guild.channels.cache.get(channelId) || 
                await guild.channels.fetch(channelId);
```

### Helpers du bot

Le bot fournit des helpers optimisés :

```javascript
const { checkCategoryAndDefer } = require('../utils/commands');

async execute(interaction) {
  // Defer + vérification catégorie en une fois
  if (!await checkCategoryAndDefer(interaction)) return;
  
  // Maintenant on peut travailler tranquillement
  // ...
}
```

## 🛡️ Pattern Standard

### Template de commande

```javascript
const { checkCategoryAndDefer } = require('../utils/commands');
const { commands: logger } = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mycommand')
    .setDescription('Description'),

  async execute(interaction) {
    // 1. Defer + vérifications (helper optimisé)
    if (!await checkCategoryAndDefer(interaction)) {
      logger.warn('Category check failed');
      return;
    }

    // 2. Traitement (peut prendre du temps)
    try {
      const game = gameManager.games.get(interaction.channelId);
      // ...
      
      // 3. Réponse finale
      await interaction.editReply("✅ Opération réussie !");
      
    } catch (error) {
      logger.error('Command failed', error);
      await interaction.editReply("❌ Une erreur est survenue");
    }
  }
};
```

## 🐛 Debugging des Expirations

### Logs utiles

L'erreur 10062 affiche maintenant :

```json
[2026-02-09T16:52:02.661Z] [ERROR] [INTERACTION] Interaction expired (10062)
{
  "commandName": "create",
  "channelId": "123456789",
  "createdTimestamp": 1707495702000,
  "age": 3150
}
```

- **age** > 3000ms = problème de defer tardif
- Vérifier l'ordre des opérations dans la commande

### Checklist debugging

- [ ] `deferReply()` est-il appelé en PREMIER ?
- [ ] Y a-t-il des `await` AVANT le defer ?
- [ ] Les fetches Discord utilisent-ils le cache ?
- [ ] Les vérifications bloquent-elles le defer ?

## ⚠️ Erreurs Communes

### 1. Vérification avant defer

```javascript
// ❌ MAUVAIS
const game = gameManager.games.get(channelId);
if (!game) {
  await interaction.reply("❌ Pas de partie"); // Peut expirer !
  return;
}
await interaction.deferReply();
```

```javascript
// ✅ BON
await interaction.deferReply();
const game = gameManager.games.get(channelId);
if (!game) {
  await interaction.editReply("❌ Pas de partie");
  return;
}
```

### 2. Fetch sans cache

```javascript
// ❌ MAUVAIS : 100-300ms par fetch
const channel = await guild.channels.fetch(id);

// ✅ BON : 0ms si en cache
const channel = guild.channels.cache.get(id) || 
                await guild.channels.fetch(id);
```

### 3. Validation lourde avant defer

```javascript
// ❌ MAUVAIS
const isValid = await heavyValidation(interaction); // 2 secondes
await interaction.deferReply(); // EXPIRE !

// ✅ BON
await interaction.deferReply();
const isValid = await heavyValidation(interaction); // OK
```

### 4. Reply au lieu d'editReply

```javascript
// ❌ MAUVAIS : Après defer, NE PAS reply
await interaction.deferReply();
await interaction.reply("Message"); // ERREUR !

// ✅ BON : Utiliser editReply
await interaction.deferReply();
await interaction.editReply("Message");
```

## 📊 Tableau Récapitulatif

| Action | Avant defer | Après defer | Délai max |
|--------|-------------|-------------|-----------|
| `deferReply()` | ✅ | ❌ | < 3s |
| `reply()` | ✅ | ❌ | < 3s |
| `editReply()` | ❌ | ✅ | Aucun |
| Fetch Discord | ⚠️ (cache OK) | ✅ | Variable |
| Validation | ⚠️ (rapide OK) | ✅ | Variable |
| Traitement lourd | ❌ | ✅ | 15 min max |

## ✅ Résumé

1. **Defer IMMÉDIATEMENT** (< 3 secondes)
2. **Cache prioritaire** pour Discord API
3. **editReply après defer**, jamais reply
4. **Helpers du bot** (`checkCategoryAndDefer`)
5. **Logger les âges** d'interaction en cas d'erreur

---

**Documenté le** : 2026-02-09  
**Dernière révision** : v2.0.0
