const fs = require('fs');
const path = require('path');
const { app: logger } = require('../utils/logger');

/**
 * SQLite automatic backup system
 * Creates hourly backups with rotation (keeps last 24)
 */
class BackupManager {
  constructor() {
    this.db = null;
    this.backupDir = path.join(__dirname, '..', 'data', 'backups');
    this.interval = null;
    this.maxBackups = 24; // Keep last 24 backups (= 24h)
    this.backupIntervalMs = 60 * 60 * 1000; // 1 hour
  }

  /**
   * Initialize the backup manager
   * @param {object} database - GameDatabase instance
   */
  initialize(database) {
    this.db = database;

    // Ensure backup directory exists
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }

    logger.info('BackupManager initialized', { backupDir: this.backupDir, maxBackups: this.maxBackups });
  }

  /**
   * Start automatic hourly backups
   */
  startAutoBackup() {
    if (this.interval) {
      logger.warn('Auto backup already running');
      return;
    }

    // Run first backup 5 minutes after start (let DB settle)
    setTimeout(() => {
      this.performBackup().catch(err => 
        logger.error('Initial backup failed', { error: err.message })
      );
    }, 5 * 60 * 1000);

    // Then every hour
    this.interval = setInterval(() => {
      this.performBackup().catch(err => 
        logger.error('Scheduled backup failed', { error: err.message })
      );
    }, this.backupIntervalMs);

    logger.success('Auto backup started', { interval: '1h', maxBackups: this.maxBackups });
  }

  /**
   * Stop automatic backups
   */
  stopAutoBackup() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      logger.info('Auto backup stopped');
    }
  }

  /**
   * Perform a backup now
   * @returns {string|null} Backup file path or null on failure
   */
  async performBackup() {
    if (!this.db || !this.db.db) {
      logger.error('Cannot backup: database not initialized');
      return null;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupFile = path.join(this.backupDir, `werewolf-${timestamp}.db`);

    try {
      // Use better-sqlite3's built-in backup API
      await this.db.backup(backupFile);

      const stats = fs.statSync(backupFile);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

      logger.success('Backup created', { file: path.basename(backupFile), size: `${sizeMB} MB` });

      // Rotate old backups
      this.rotateBackups();

      return backupFile;
    } catch (err) {
      logger.error('Backup failed', { error: err.message, file: backupFile });
      // Clean up partial backup
      try { if (fs.existsSync(backupFile)) fs.unlinkSync(backupFile); } catch (e) { /* ignore */ }
      return null;
    }
  }

  /**
   * Rotate backups: keep only the last N
   */
  rotateBackups() {
    try {
      const files = fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith('werewolf-') && f.endsWith('.db'))
        .sort() // Sorted by timestamp (oldest first)
        .map(f => path.join(this.backupDir, f));

      const toDelete = files.length - this.maxBackups;
      if (toDelete <= 0) return;

      for (let i = 0; i < toDelete; i++) {
        try {
          fs.unlinkSync(files[i]);
          logger.debug('Old backup deleted', { file: path.basename(files[i]) });
        } catch (e) {
          logger.error('Failed to delete old backup', { file: files[i], error: e.message });
        }
      }

      logger.info('Backup rotation complete', { deleted: toDelete, remaining: this.maxBackups });
    } catch (err) {
      logger.error('Backup rotation failed', { error: err.message });
    }
  }

  /**
   * List available backups
   * @returns {Array<{file: string, size: string, date: Date}>}
   */
  listBackups() {
    try {
      if (!fs.existsSync(this.backupDir)) return [];

      return fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith('werewolf-') && f.endsWith('.db'))
        .sort()
        .reverse()
        .map(f => {
          const fullPath = path.join(this.backupDir, f);
          const stats = fs.statSync(fullPath);
          const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
          // Parse date from filename: werewolf-YYYY-MM-DDTHH-MM-SS.db
          const dateStr = f.replace('werewolf-', '').replace('.db', '').replace(/T/, 'T').replace(/-(\d{2})-(\d{2})$/, ':$1:$2');
          return {
            file: f,
            path: fullPath,
            size: `${sizeMB} MB`,
            date: new Date(dateStr)
          };
        });
    } catch (err) {
      logger.error('Failed to list backups', { error: err.message });
      return [];
    }
  }

  /**
   * Restore from a backup file
   * @param {string} backupFile - Full path to backup file
   */
  async restoreFromBackup(backupFile) {
    if (!fs.existsSync(backupFile)) {
      throw new Error(`Backup file not found: ${backupFile}`);
    }

    const dbPath = this.db.dbPath;
    
    // Create a safety backup before restore
    const safetyBackup = path.join(this.backupDir, `pre-restore-${Date.now()}.db`);
    try {
      await this.db.backup(safetyBackup);
      logger.info('Safety backup created before restore', { file: path.basename(safetyBackup) });
    } catch (e) {
      logger.warn('Could not create safety backup', { error: e.message });
    }

    // Close current DB, copy backup over, reopen
    this.db.close();
    fs.copyFileSync(backupFile, dbPath);
    
    logger.success('Database restored from backup', { file: path.basename(backupFile) });
    return true;
  }
}

// Singleton
let instance = null;

module.exports = {
  initialize: (database) => {
    if (!instance) {
      instance = new BackupManager();
    }
    instance.initialize(database);
    return instance;
  },

  getInstance: () => {
    if (!instance) {
      instance = new BackupManager();
    }
    return instance;
  }
};
