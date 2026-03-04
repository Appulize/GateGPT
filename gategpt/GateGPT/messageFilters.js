const CHANNEL_JID_RE = /@\w*newsletter\b/i;

function extractMessageJids(message) {
  const ids = [
    message?.from,
    message?.to,
    message?.id?.remote,
    message?.id?.participant,
    message?.author,
    message?.chatId,
    message?._data?.from?._serialized,
    message?._data?.to?._serialized,
    message?._data?.id?.remote,
    message?._data?.id?.participant
  ];

  return ids.filter(value => typeof value === 'string');
}

function isChannelMessage(message) {
  return extractMessageJids(message).some(jid => CHANNEL_JID_RE.test(jid));
}

function isChannelChatError(err) {
  const message = String(err?.message || '');
  const stack = String(err?.stack || '');

  return (
    message.includes('channelMetadata')
    || message.includes('Channel._patch')
    || stack.includes('structures/Channel.js')
  );
}

module.exports = {
  CHANNEL_JID_RE,
  extractMessageJids,
  isChannelMessage,
  isChannelChatError
};
