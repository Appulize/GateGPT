const { getConfig } = require('./config');

const DEFAULT_INSTANT_MODE_DURATION_MS = 5 * 60 * 1000;

function disableInstantMode(convo, chatId = convo.chatId) {
  convo.instant = false;
  convo.triggered = false;
  convo.sentLocation = false;
  convo.delivering = false;
  convo.instantTimer = null;
  console.log(`🕓 Instant mode OFF for ${chatId}`);
}

function enableInstantMode(convo, chatId = convo.chatId) {
  convo.instant = true;

  if (convo.instantTimer) clearTimeout(convo.instantTimer);
  convo.instantTimer = setTimeout(
    () => disableInstantMode(convo, chatId),
    getConfig('INSTANT_MODE_DURATION_MS', DEFAULT_INSTANT_MODE_DURATION_MS)
  );
}

module.exports = {
  DEFAULT_INSTANT_MODE_DURATION_MS,
  enableInstantMode
};
