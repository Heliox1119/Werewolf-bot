/**
 * Role Builder Service — Validates and manages custom role definitions.
 * 
 * Backend service for the admin UI role builder.
 * No dynamic code execution. All validation is schema-based.
 * 
 * @module game/abilities/roleBuilderService
 */

'use strict';

const {
  validateRoleDefinition,
  normalizeRoleDefinition,
  ABILITY_TYPES,
  ABILITY_EFFECTS,
  ABILITY_TRIGGERS,
  CAMP_VALUES,
  WIN_CONDITIONS,
  TARGET_TYPES,
  PHASE_VALUES,
  FORBIDDEN_COMBOS,
  MAX_ABILITIES_PER_ROLE,
} = require('./abilitySchema');
const { game: logger } = require('../../utils/logger');

// ─── Role Builder ────────────────────────────────────────────────────────────

class RoleBuilderService {
  /**
   * @param {Object} db - GameDatabase instance
   */
  constructor(db) {
    this.db = db;
    this._ensureTable();
  }

  /**
   * Ensure the custom_roles table exists with ability support.
   */
  _ensureTable() {
    try {
      this.db.db.exec(`
        CREATE TABLE IF NOT EXISTS custom_roles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id TEXT NOT NULL,
          name TEXT NOT NULL,
          emoji TEXT DEFAULT '❓',
          camp TEXT NOT NULL DEFAULT 'village',
          power TEXT DEFAULT 'none',
          description TEXT DEFAULT '',
          abilities_json TEXT DEFAULT '[]',
          win_condition TEXT DEFAULT 'village_wins',
          created_by TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      // Migrate: add updated_at if missing
      try {
        this.db.db.exec(`ALTER TABLE custom_roles ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`);
      } catch { /* column already exists */ }
      // Migrate: add abilities_json if missing (upgrade from old schema)
      try {
        this.db.db.exec(`ALTER TABLE custom_roles ADD COLUMN abilities_json TEXT DEFAULT '[]'`);
      } catch { /* column already exists */ }
      // Migrate: add win_condition if missing
      try {
        this.db.db.exec(`ALTER TABLE custom_roles ADD COLUMN win_condition TEXT DEFAULT 'village_wins'`);
      } catch { /* column already exists */ }
    } catch (err) {
      logger.warn('RoleBuilderService: Failed to ensure custom_roles table', { error: err.message });
    }
  }

  /**
   * Validate a role definition (without saving).
   * 
   * @param {Object} roleDefinition - { name, camp, winCondition, abilities }
   * @returns {{ valid: boolean, errors: string[], normalized?: Object }}
   */
  validateRole(roleDefinition) {
    const result = validateRoleDefinition(roleDefinition);
    if (result.valid) {
      result.normalized = normalizeRoleDefinition(roleDefinition);
    }
    return result;
  }

  /**
   * Create a new custom role for a guild.
   * Validates, normalizes, and persists.
   * 
   * @param {string} guildId
   * @param {Object} roleDefinition - { name, camp, winCondition, abilities, emoji?, description? }
   * @param {string} [createdBy] - User ID of creator
   * @returns {{ ok: boolean, id?: number, errors?: string[] }}
   */
  createRole(guildId, roleDefinition, createdBy) {
    // Validate
    const validation = this.validateRole(roleDefinition);
    if (!validation.valid) {
      return { ok: false, errors: validation.errors };
    }

    const normalized = validation.normalized;

    // Check for duplicate name in guild
    const existing = this.db.db.prepare(
      'SELECT id FROM custom_roles WHERE guild_id = ? AND name = ?'
    ).get(guildId, normalized.name);

    if (existing) {
      return { ok: false, errors: [`A role named "${normalized.name}" already exists in this guild`] };
    }

    // Max roles per guild (prevent abuse)
    const count = this.db.db.prepare(
      'SELECT COUNT(*) as cnt FROM custom_roles WHERE guild_id = ?'
    ).get(guildId);

    if (count && count.cnt >= 20) {
      return { ok: false, errors: ['Maximum 20 custom roles per guild'] };
    }

    // Insert
    try {
      const stmt = this.db.db.prepare(`
        INSERT INTO custom_roles (guild_id, name, emoji, camp, description, abilities_json, win_condition, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        guildId,
        normalized.name,
        roleDefinition.emoji || '❓',
        normalized.camp,
        roleDefinition.description || '',
        JSON.stringify(normalized.abilities),
        normalized.winCondition,
        createdBy || null
      );

      logger.info('Custom role created', {
        guildId,
        name: normalized.name,
        roleId: result.lastInsertRowid,
        abilityCount: normalized.abilities.length,
      });

      return { ok: true, id: result.lastInsertRowid };
    } catch (err) {
      logger.error('Failed to create custom role', { error: err.message });
      return { ok: false, errors: ['Database error: ' + err.message] };
    }
  }

  /**
   * Update an existing custom role.
   * 
   * @param {number} roleId
   * @param {string} guildId - For ownership check
   * @param {Object} roleDefinition
   * @returns {{ ok: boolean, errors?: string[] }}
   */
  updateRole(roleId, guildId, roleDefinition) {
    // Check exists and belongs to guild
    const existing = this.db.db.prepare(
      'SELECT * FROM custom_roles WHERE id = ? AND guild_id = ?'
    ).get(roleId, guildId);

    if (!existing) {
      return { ok: false, errors: ['Role not found or does not belong to this guild'] };
    }

    // Validate
    const validation = this.validateRole(roleDefinition);
    if (!validation.valid) {
      return { ok: false, errors: validation.errors };
    }

    const normalized = validation.normalized;

    // Check name uniqueness (excluding self)
    const duplicate = this.db.db.prepare(
      'SELECT id FROM custom_roles WHERE guild_id = ? AND name = ? AND id != ?'
    ).get(guildId, normalized.name, roleId);

    if (duplicate) {
      return { ok: false, errors: [`A role named "${normalized.name}" already exists in this guild`] };
    }

    try {
      this.db.db.prepare(`
        UPDATE custom_roles
        SET name = ?, camp = ?, description = ?, abilities_json = ?, win_condition = ?,
            emoji = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND guild_id = ?
      `).run(
        normalized.name,
        normalized.camp,
        roleDefinition.description || '',
        JSON.stringify(normalized.abilities),
        normalized.winCondition,
        roleDefinition.emoji || '❓',
        roleId,
        guildId
      );

      logger.info('Custom role updated', { roleId, guildId, name: normalized.name });
      return { ok: true };
    } catch (err) {
      logger.error('Failed to update custom role', { error: err.message });
      return { ok: false, errors: ['Database error: ' + err.message] };
    }
  }

  /**
   * Delete a custom role.
   * 
   * @param {number} roleId
   * @param {string} guildId
   * @returns {{ ok: boolean, errors?: string[] }}
   */
  deleteRole(roleId, guildId) {
    const existing = this.db.db.prepare(
      'SELECT * FROM custom_roles WHERE id = ? AND guild_id = ?'
    ).get(roleId, guildId);

    if (!existing) {
      return { ok: false, errors: ['Role not found'] };
    }

    try {
      this.db.db.prepare('DELETE FROM custom_roles WHERE id = ? AND guild_id = ?').run(roleId, guildId);
      logger.info('Custom role deleted', { roleId, guildId, name: existing.name });
      return { ok: true };
    } catch (err) {
      return { ok: false, errors: ['Database error: ' + err.message] };
    }
  }

  /**
   * Get all custom roles for a guild.
   * Returns validated + normalized definitions.
   * 
   * @param {string} guildId
   * @returns {Array<Object>}
   */
  getRolesForGuild(guildId) {
    try {
      const rows = this.db.db.prepare(
        'SELECT * FROM custom_roles WHERE guild_id = ? ORDER BY created_at DESC'
      ).all(guildId);

      return rows.map(row => {
        let abilities = [];
        try {
          abilities = JSON.parse(row.abilities_json || '[]');
        } catch {
          abilities = [];
        }

        return {
          id: row.id,
          guildId: row.guild_id,
          name: row.name,
          emoji: row.emoji,
          camp: row.camp,
          description: row.description,
          abilities,
          winCondition: row.win_condition || 'village_wins',
          createdBy: row.created_by,
          createdAt: row.created_at,
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Get a single custom role by ID.
   * 
   * @param {number} roleId
   * @param {string} guildId
   * @returns {Object|null}
   */
  getRole(roleId, guildId) {
    try {
      const row = this.db.db.prepare(
        'SELECT * FROM custom_roles WHERE id = ? AND guild_id = ?'
      ).get(roleId, guildId);

      if (!row) return null;

      let abilities = [];
      try {
        abilities = JSON.parse(row.abilities_json || '[]');
      } catch {
        abilities = [];
      }

      return {
        id: row.id,
        guildId: row.guild_id,
        name: row.name,
        emoji: row.emoji,
        camp: row.camp,
        description: row.description,
        abilities,
        winCondition: row.win_condition || 'village_wins',
        createdBy: row.created_by,
        createdAt: row.created_at,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get the available schema information for UI rendering.
   * @returns {Object}
   */
  getSchema() {
    return {
      abilityTypes: ABILITY_TYPES,
      effects: ABILITY_EFFECTS,
      triggers: ABILITY_TRIGGERS,
      camps: CAMP_VALUES,
      winConditions: WIN_CONDITIONS,
      targetTypes: TARGET_TYPES,
      phases: PHASE_VALUES,
      forbiddenCombos: FORBIDDEN_COMBOS,
      maxAbilities: MAX_ABILITIES_PER_ROLE,
    };
  }
}

module.exports = RoleBuilderService;
