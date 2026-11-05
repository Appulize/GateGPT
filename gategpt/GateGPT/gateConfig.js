const { getConfig } = require('./config');

function isGateConfigured() {
  return Boolean(
    String(getConfig('GATE_OPEN_URL') || '').trim() &&
    String(getConfig('GATE_CLOSE_URL') || '').trim()
  );
}

module.exports = { isGateConfigured };
