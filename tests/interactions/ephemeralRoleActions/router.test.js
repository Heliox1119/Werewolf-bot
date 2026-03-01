/**
 * Tests for interactions/ephemeralRoleActions/index.js — Router
 */

const { EPHEMERAL_BUTTON_IDS, handleEphemeralRoleButton } = require('../../../interactions/ephemeralRoleActions');

jest.mock('../../../game/gameManager');
jest.mock('../../../utils/logger', () => ({
  app: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  commands: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), startTimer: jest.fn(() => ({ end: jest.fn() })) },
  interaction: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

describe('ephemeralRoleActions router', () => {

  test('EPHEMERAL_BUTTON_IDS contains lgirl_listen', () => {
    expect(EPHEMERAL_BUTTON_IDS).toContain('lgirl_listen');
  });

  test('handleEphemeralRoleButton is a function', () => {
    expect(typeof handleEphemeralRoleButton).toBe('function');
  });

  test('ignores unknown customId without throwing', async () => {
    const interaction = { customId: 'unknown_button' };
    await expect(handleEphemeralRoleButton(interaction)).resolves.toBeUndefined();
  });
});
