/**
 * Tests for interactions/ephemeralRoleActions/index.js — Router
 */

const { EPHEMERAL_BUTTON_IDS, handleEphemeralRoleButton } = require('../../../interactions/ephemeralRoleActions');

jest.mock('../../../game/gameManager');
jest.mock('../../../utils/logger', () => require('../../helpers/loggerMock')());

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
