function initLogging() {
  const pad = n => String(n).padStart(2, '0');
  const ts = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  ['log', 'info', 'warn', 'error', 'debug'].forEach(method => {
    const original = console[method].bind(console);
    console[method] = (...args) => original(`[${ts()}]`, ...args);
  });
}

module.exports = { initLogging };
