/** @jest-environment node */

jest.mock('axios', () => ({ post: jest.fn().mockResolvedValue({}) }));
jest.mock('../config', () => ({
  getConfig: jest.fn((key, defaultValue) => {
    if (key === 'GATE_OPEN_URL') return 'https://example.invalid/open';
    if (key === 'GATE_CLOSE_URL') return 'https://example.invalid/close';
    if (key === 'AUTO_CLOSE_DELAY_MS') return 1000;
    if (key === 'INSTANT_MODE_DURATION_MS') return 5000;
    return defaultValue;
  })
}));
jest.mock('../notifications', () => ({ sendPushoverNotification: jest.fn() }));
jest.mock('../messaging', () => ({
  sendAuto: jest.fn(),
  Location: class Location {}
}));
jest.mock('../otp', () => ({
  getTrackingsForPhone: jest.fn(() => []),
  removeTrackingForPhone: jest.fn()
}));
jest.mock('../deliveryLog', () => ({ setStatus: jest.fn() }));

const axios = require('axios');
const { openGate } = require('../actions');

describe('gate actions', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    axios.post.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('closing the gate does not end instant mode early', async () => {
    const chat = {
      id: { _serialized: 'courier@example' },
      markUnread: jest.fn()
    };
    const convo = {
      chatId: 'courier@example',
      instant: false,
      instantTimer: null,
      gateCloseTimer: null,
      triggered: true,
      sentLocation: true,
      delivering: true
    };

    await openGate(chat, convo);
    expect(convo.instant).toBe(true);

    await jest.advanceTimersByTimeAsync(1000);
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(convo.gateCloseTimer).toBeNull();
    expect(convo.instant).toBe(true);

    await jest.advanceTimersByTimeAsync(4000);
    expect(convo.instant).toBe(false);
  });

  test('does not call a webhook when gate control is unconfigured', async () => {
    const { getConfig } = require('../config');
    getConfig.mockImplementation((key, defaultValue) => key.startsWith('GATE_') ? '' : defaultValue);
    const chat = { markUnread: jest.fn() };

    await openGate(chat, {});

    expect(axios.post).not.toHaveBeenCalled();
    expect(chat.markUnread).toHaveBeenCalledTimes(1);
  });
});
