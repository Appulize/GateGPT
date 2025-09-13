const EventEmitter = require('events');

// Keep a short history of logs for the dashboard and expose a stream
const logEmitter = new EventEmitter();
const history = [];
const MAX_HISTORY = 500;

function initLogging() {
  const pad = n => String(n).padStart(2, '0');
  const ts = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  ['log', 'info', 'warn', 'error', 'debug'].forEach(method => {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      const prefix = `[${ts()}]`;
      original(prefix, ...args);
      const line = [prefix, ...args]
        .map(a => (typeof a === 'string' ? a : JSON.stringify(a)))
        .join(' ');
      history.push(line);
      if (history.length > MAX_HISTORY) history.shift();
      logEmitter.emit('log', line);
    };
  });
}

function getLogHistory() {
  return history.slice();
}

module.exports = { initLogging, logEmitter, getLogHistory };
