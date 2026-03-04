const {
  CHANNEL_JID_RE,
  extractMessageJids,
  isChannelMessage,
  isChannelChatError
} = require('../messageFilters');

describe('messageFilters', () => {
  test('matches known channel jid format', () => {
    expect(CHANNEL_JID_RE.test('120363123456789012@newsletter')).toBe(true);
  });

  test('detects channel messages using from and id.remote', () => {
    expect(isChannelMessage({ from: '120363123456789012@newsletter' })).toBe(true);
    expect(isChannelMessage({ id: { remote: '120363999999999999@newsletter' } })).toBe(true);
  });

  test('does not flag regular private/group/status messages', () => {
    expect(isChannelMessage({ from: '123456789@c.us' })).toBe(false);
    expect(isChannelMessage({ from: '123456789-123456@g.us' })).toBe(false);
    expect(isChannelMessage({ from: 'status@broadcast' })).toBe(false);
  });

  test('extracts all available jid-like fields', () => {
    const jids = extractMessageJids({
      from: '111@c.us',
      to: '222@c.us',
      author: '333@c.us',
      id: { remote: '444@c.us', participant: '555@c.us' },
      _data: {
        from: { _serialized: '666@c.us' },
        to: { _serialized: '777@c.us' },
        id: { remote: '888@c.us', participant: '999@c.us' }
      }
    });

    expect(jids).toEqual(expect.arrayContaining([
      '111@c.us',
      '222@c.us',
      '333@c.us',
      '444@c.us',
      '555@c.us',
      '666@c.us',
      '777@c.us',
      '888@c.us',
      '999@c.us'
    ]));
  });

  test('recognizes known channel parsing error signatures', () => {
    expect(isChannelChatError(new TypeError("Cannot read properties of undefined (reading 'description')"))).toBe(false);
    expect(isChannelChatError({
      message: "Cannot read properties of undefined (reading 'channelMetadata')"
    })).toBe(true);
    expect(isChannelChatError({
      stack: 'at Channel._patch (/opt/gategpt/node_modules/whatsapp-web.js/src/structures/Channel.js:44:49)'
    })).toBe(true);
  });
});
