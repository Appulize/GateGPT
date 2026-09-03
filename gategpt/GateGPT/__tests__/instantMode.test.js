/** @jest-environment node */

jest.mock('../config', () => ({
  getConfig: jest.fn()
}));

const { getConfig } = require('../config');
const {
  DEFAULT_INSTANT_MODE_DURATION_MS,
  enableInstantMode
} = require('../instantMode');

describe('instant mode', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    getConfig.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('defaults to five minutes', () => {
    getConfig.mockImplementation((_key, defaultValue) => defaultValue);
    const convo = {
      instant: false,
      instantTimer: null,
      triggered: true,
      sentLocation: true,
      delivering: true,
      chatId: 'courier@example'
    };

    enableInstantMode(convo);
    jest.advanceTimersByTime(DEFAULT_INSTANT_MODE_DURATION_MS - 1);
    expect(convo.instant).toBe(true);

    jest.advanceTimersByTime(1);
    expect(convo).toMatchObject({
      instant: false,
      instantTimer: null,
      triggered: false,
      sentLocation: false,
      delivering: false
    });
    expect(getConfig).toHaveBeenCalledWith(
      'INSTANT_MODE_DURATION_MS',
      300000
    );
  });

  test('uses the configured duration and replaces the previous timer', () => {
    getConfig.mockReturnValue(1000);
    const oldTimer = setTimeout(() => {}, 10000);
    const convo = { instant: false, instantTimer: oldTimer, chatId: 'courier@example' };

    enableInstantMode(convo);
    expect(convo.instantTimer).not.toBe(oldTimer);

    jest.advanceTimersByTime(999);
    expect(convo.instant).toBe(true);
    jest.advanceTimersByTime(1);
    expect(convo.instant).toBe(false);
  });
});
