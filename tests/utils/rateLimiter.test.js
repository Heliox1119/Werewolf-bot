const { RateLimiter } = require('../../utils/rateLimiter');

describe('RateLimiter', () => {
  let limiter;

  beforeEach(() => {
    limiter = new RateLimiter();
    jest.useFakeTimers();
  });

  afterEach(() => {
    limiter.destroy();
    jest.useRealTimers();
  });

  describe('Token Bucket', () => {
    test('autorise les requêtes dans la limite', () => {
      const userId = 'user1';
      const commandName = 'vote';
      
      // vote config: 20 tokens / 60s window, 500ms cooldown
      // Faire 5 requêtes en respectant le cooldown
      for (let i = 0; i < 5; i++) {
        const result = limiter.checkLimit(userId, commandName);
        if (!result.allowed) {
          console.log('Iteration', i, 'échouée:', result.reason);
        }
        expect(result.allowed).toBe(true);
        // Avancer le temps pour respecter le cooldown
        jest.advanceTimersByTime(600); // 600ms > 500ms cooldown
      }
    });

    test('bloque les requêtes qui dépassent la limite', () => {
      const userId = 'user2';
      const commandName = 'create';
      
      // create config: 3 tokens / 60s window, 5000ms cooldown
      // Consommer tous les tokens
      for (let i = 0; i < 3; i++) {
        const result = limiter.checkLimit(userId, commandName);
        expect(result.allowed).toBe(true);
        // Avancer le temps pour respecter le cooldown
        jest.advanceTimersByTime(6000); // 6s > 5s cooldown
      }

      // 4ème requête devrait être bloquée
      const result = limiter.checkLimit(userId, commandName);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Rate limit dépassé');
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    test('recharge les tokens après la fenêtre', () => {
      const userId = 'user3';
      const commandName = 'join';
      
      // join config: 10 tokens / 60s window
      // Consommer tous les tokens
      for (let i = 0; i < 10; i++) {
        limiter.checkLimit(userId, commandName);
      }

      // Bloqué maintenant
      expect(limiter.checkLimit(userId, commandName).allowed).toBe(false);

      // Avancer dans le temps de 60s
      jest.advanceTimersByTime(60000);

      // Devrait être rechargé
      const result = limiter.checkLimit(userId, commandName);
      expect(result.allowed).toBe(true);
    });

    test('recharge partiellement les tokens', () => {
      const userId = 'user4';
      const commandName = 'vote';
      
      // vote: 20 tokens / 60s = 1 token toutes les 3s, cooldown 500ms
      // Consommer 5 tokens en respectant le cooldown
      for (let i = 0; i < 5; i++) {
        limiter.checkLimit(userId, commandName);
        jest.advanceTimersByTime(600); // Respecter le cooldown
      }

      // Avancer de 15s (devrait recharger 5 tokens)
      jest.advanceTimersByTime(15000);

      // Bucket actuel: (20 - 5) + 5 = 20 tokens
      const stats = limiter.getUserStats(userId);
      expect(stats.commands.vote.tokensRemaining).toBeCloseTo(20, 0);
    });
  });

  describe('Cooldown', () => {
    test('applique le cooldown entre les requêtes', () => {
      const userId = 'user5';
      const commandName = 'create';
      
      // create cooldown: 5000ms
      const first = limiter.checkLimit(userId, commandName);
      expect(first.allowed).toBe(true);

      // Immédiatement après (cooldown actif)
      const second = limiter.checkLimit(userId, commandName);
      expect(second.allowed).toBe(false);
      expect(second.reason).toContain('Cooldown actif');

      // Avancer de 5s
      jest.advanceTimersByTime(5000);

      // Devrait passer
      const third = limiter.checkLimit(userId, commandName);
      expect(third.allowed).toBe(true);
    });

    test('cooldown différent par commande', () => {
      const userId = 'user6';
      
      // start: cooldown 2s
      limiter.checkLimit(userId, 'start');
      jest.advanceTimersByTime(2000);
      expect(limiter.checkLimit(userId, 'start').allowed).toBe(true);

      // create: cooldown 5s
      limiter.checkLimit(userId, 'create');
      jest.advanceTimersByTime(2000);
      expect(limiter.checkLimit(userId, 'create').allowed).toBe(false);
      jest.advanceTimersByTime(3000);
      expect(limiter.checkLimit(userId, 'create').allowed).toBe(true);
    });
  });

  describe('Violations et pénalités', () => {
    test('incrémente les violations', () => {
      const userId = 'user7';
      const commandName = 'join';
      
      // join: 10 tokens, cooldown 2000ms
      // Consommer tous les tokens
      for (let i = 0; i < 10; i++) {
        limiter.checkLimit(userId, commandName);
        jest.advanceTimersByTime(2500); // Respecter le cooldown
      }

      // Essayer 3 fois de plus (violations)
      for (let i = 0; i < 3; i++) {
        limiter.checkLimit(userId, commandName);
      }

      const stats = limiter.getUserStats(userId);
      expect(stats.commands.join.violations).toBeGreaterThan(0);
    });

    test('applique un ban après 5 violations', () => {
      const userId = 'user8';
      const commandName = 'create';
      
      // create: 3 tokens, cooldown 5000ms
      // Consommer tous les tokens
      for (let i = 0; i < 3; i++) {
        limiter.checkLimit(userId, commandName);
        jest.advanceTimersByTime(6000); // Respecter le cooldown
      }

      // Faire 5 violations (dépasser la limite)
      for (let i = 0; i < 5; i++) {
        limiter.checkLimit(userId, commandName);
      }

      // Vérifier que l'utilisateur est banni
      const stats = limiter.getUserStats(userId);
      expect(stats.banned).toBe(true);
      expect(stats.banInfo.reason).toContain('rate limit');
    });

    test('ban empêche toutes les commandes', () => {
      const userId = 'user9';
      
      // Bannir manuellement
      limiter.banUser(userId, 60000, 'test');

      // Essayer n'importe quelle commande
      const result = limiter.checkLimit(userId, 'vote');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('banni');
    });

    test('ban expire automatiquement', () => {
      const userId = 'user10';
      
      // Ban de 1 minute
      limiter.banUser(userId, 60000, 'test');
      expect(limiter.checkLimit(userId, 'vote').allowed).toBe(false);

      // Avancer de 61s
      jest.advanceTimersByTime(61000);

      // Devrait être débanni
      const result = limiter.checkLimit(userId, 'vote');
      expect(result.allowed).toBe(true);
    });
  });

  describe('Utilisateurs multiples', () => {
    test('isole les limites par utilisateur', () => {
      const user1 = 'user11';
      const user2 = 'user12';
      const commandName = 'create';
      
      // User1 consomme tous ses tokens
      for (let i = 0; i < 3; i++) {
        limiter.checkLimit(user1, commandName);
      }
      expect(limiter.checkLimit(user1, commandName).allowed).toBe(false);

      // User2 devrait avoir ses propres tokens
      expect(limiter.checkLimit(user2, commandName).allowed).toBe(true);
    });

    test('isole les limites par commande', () => {
      const userId = 'user13';
      
      // Consommer tous les tokens de 'create'
      for (let i = 0; i < 3; i++) {
        limiter.checkLimit(userId, 'create');
      }
      expect(limiter.checkLimit(userId, 'create').allowed).toBe(false);

      // 'join' devrait avoir ses propres tokens
      expect(limiter.checkLimit(userId, 'join').allowed).toBe(true);
    });
  });

  describe('Gestion administrative', () => {
    test('resetUser efface les limites', () => {
      const userId = 'user14';
      
      // Consommer des tokens
      for (let i = 0; i < 5; i++) {
        limiter.checkLimit(userId, 'vote');
      }

      // Reset
      limiter.resetUser(userId);

      // Stats devraient être vides
      const stats = limiter.getUserStats(userId);
      expect(Object.keys(stats.commands).length).toBe(0);
    });

    test('unbanUser débannit immédiatement', () => {
      const userId = 'user15';
      
      limiter.banUser(userId, 60000, 'test');
      expect(limiter.checkLimit(userId, 'vote').allowed).toBe(false);

      limiter.unbanUser(userId);
      expect(limiter.checkLimit(userId, 'vote').allowed).toBe(true);
    });
  });

  describe('Statistiques', () => {
    test('getGlobalStats retourne les bonnes valeurs', () => {
      limiter.checkLimit('user16', 'vote');
      limiter.checkLimit('user17', 'vote');
      limiter.banUser('user18', 60000, 'test');

      const stats = limiter.getGlobalStats();
      expect(stats.totalUsers).toBe(2);
      expect(stats.bannedUsers).toBe(1);
    });

    test('getUserStats retourne les détails', () => {
      const userId = 'user19';
      
      limiter.checkLimit(userId, 'vote');
      limiter.checkLimit(userId, 'create');

      const stats = limiter.getUserStats(userId);
      expect(stats.userId).toBe(userId);
      expect(stats.banned).toBe(false);
      expect(Object.keys(stats.commands).length).toBe(2);
    });
  });

  describe('Cleanup', () => {
    test('nettoie les buckets inactifs', () => {
      const userId = 'user20';
      
      limiter.checkLimit(userId, 'vote');

      // Vérifier que le bucket existe
      expect(limiter.buckets.has(userId)).toBe(true);

      // Avancer de plus d'1h
      jest.advanceTimersByTime(61 * 60 * 1000);
      limiter.cleanup();

      // Bucket devrait être supprimé
      expect(limiter.buckets.has(userId)).toBe(false);
    });

    test('nettoie les bans expirés', () => {
      const userId = 'user21';
      
      limiter.banUser(userId, 1000, 'test');
      expect(limiter.bans.has(userId)).toBe(true);

      // Avancer dans le temps
      jest.advanceTimersByTime(2000);
      limiter.cleanup();

      // Ban devrait être nettoyé
      expect(limiter.bans.has(userId)).toBe(false);
    });
  });

  describe('Configuration par défaut', () => {
    test('utilise config par défaut pour commande inconnue', () => {
      const result = limiter.checkLimit('user22', 'unknown-command');
      expect(result.allowed).toBe(true);

      // Config par défaut: 30 tokens
      const stats = limiter.getUserStats('user22');
      expect(stats.commands['unknown-command'].maxTokens).toBe(30);
    });
  });
});
