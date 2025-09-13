/** @jest-environment node */

// Speed up automated responses
process.env.RESPONSE_DELAY_MS = '0';
process.env.AUTO_CLOSE_DELAY_MS = '1000';
process.env.TRIGGER_KEYWORDS = 'q.*post,outside';
process.env.OTP_TRIGGER_KEYWORDS = 'GFS!';

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
    getStatus: () => ({ ready: true, qrId: 0 }),
    __handlers: handlers,
    __chat: chat
  };
});

const messaging = require('../messaging');
jest.mock('../openaiClient', () => ({
  chat: { completions: { create: jest.fn() } }
}));
const openai = require('../openaiClient');
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
    openai.chat.completions.create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '',
            tool_calls: [
              { type: 'function', function: { name: 'open_gate', arguments: '{}' } }
            ]
          }
        }
      ]
    });

    await messaging.__handlers.onMessage(createMessage('Hi sir qpost'));

    // wait for GPT response and auto-close timer
    await new Promise(res => setTimeout(res, 20000));

    const calledUrls = postSpy.mock.calls.map(c => c[0]);
    expect(calledUrls).toContain('https://your.server.com/api/webhook/open-gate');
  });

  test('handles OTP lifecycle', async () => {
    openai.chat.completions.create.mockReset();
    openai.chat.completions.create
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  type: 'function',
                  function: {
                    name: 'save_tracking_otp',
                    arguments: JSON.stringify({
                      tracking_number: 'ABC123',
                      otp: '9999'
                    })
                  }
                }
              ]
            }
          }
        ]
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  type: 'function',
                  function: {
                    name: 'associate_tracking_number',
                    arguments: JSON.stringify({
                      tracking_number: 'ABC123'
                    })
                  }
                }
              ]
            }
          }
        ]
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  type: 'function',
                  function: {
                    name: 'send_otp',
                    arguments: JSON.stringify({
                      tracking_number: 'ABC123'
                    })
                  }
                }
              ]
            }
          }
        ]
      });

    const { getOtp } = require('../otp');

    await messaging.__handlers.onMessage(createMessage('GFS! some message'));
    expect(getOtp('ABC123')).toBe('9999');

    await messaging.__handlers.onMessage(createMessage('tracking ABC123'));
    await new Promise(res => setTimeout(res, 10));

    await messaging.__handlers.onMessage(createMessage('otp please'));
    await new Promise(res => setTimeout(res, 10));

    expect(messaging.sendAuto).toHaveBeenLastCalledWith(
      messaging.__chat,
      '9999'
    );
    expect(getOtp('ABC123')).toBeUndefined();
  });
});
