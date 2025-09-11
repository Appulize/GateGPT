/** @jest-environment node */

// Speed up automated responses
process.env.RESPONSE_DELAY_MS = '0';
process.env.AUTO_CLOSE_DELAY_MS = '1000';
process.env.TRIGGER_KEYWORDS = 'q.*post,outside';

const axios = require('axios');
const fs = require('fs');

// Mock only the WhatsApp messaging layer
const handlers = {};
jest.mock('../messaging', () => {
  const sendAuto = jest.fn();
  const chat = {
    id: { _serialized: 'test@c.us' },
    sendMessage: jest.fn(),
    markUnread: jest.fn()
  };
  class Location {
    constructor(lat, lon, title, subtitle) {
      this.lat = lat;
      this.lon = lon;
      this.title = title;
      this.subtitle = subtitle;
    }
  }
  function initMessaging(opts) {
    Object.assign(handlers, opts);
  }
  return {
    initMessaging,
    sendAuto,
    isAutoMessage: () => false,
    getChatById: async () => chat,
    Location,
    __handlers: handlers,
    __chat: chat
  };
});

const messaging = require('../messaging');
const { CONFIG_PATH } = require('../config');
require('../main');

function createMessage(body) {
  return {
    body,
    fromMe: false,
    type: 'chat',
    timestamp: Date.now(),
    getChat: async () => messaging.__chat
  };
}

describe('delivery conversation', () => {
  jest.setTimeout(120000);

  afterAll(() => {
    fs.unwatchFile(CONFIG_PATH);
  });

  test('opens and closes the gate via tool calls', async () => {
    // simulate ready event to send startup notification
    if (messaging.__handlers.onReady) {
      await messaging.__handlers.onReady();
    }

    const postSpy = jest.spyOn(axios, 'post');

    await messaging.__handlers.onMessage(createMessage('Hi sir qpost'));
    await messaging.__handlers.onMessage(createMessage('Outside'));
    await messaging.__handlers.onMessage(
      createMessage('Yes outside building 32 now')
    );

    // wait for GPT response and auto-close timer
    await new Promise(res => setTimeout(res, 20000));

    const calledUrls = postSpy.mock.calls.map(c => c[0]);
    expect(calledUrls).toContain(process.env.GATE_OPEN_URL);
    expect(calledUrls).toContain(process.env.GATE_CLOSE_URL);
  });
});
