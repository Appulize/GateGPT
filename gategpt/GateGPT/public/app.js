function formatAge(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins + 'm';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h';
  const days = Math.floor(hrs / 24);
  return days + 'd';
}

const statusIcons = {
  'expected soon': 'clock',
  'out for delivery': 'truck',
  delivering: 'box-seam',
  delivered: 'check-circle'
};

function renderDeliveries(deliveries, otps) {
  const tbody = document.querySelector('#deliveries-table tbody');
  tbody.innerHTML = '';
  deliveries.forEach(d => {
    const tr = document.createElement('tr');
    const otp = otps[d.tracking]?.otp || '';
    const phoneRaw = d.chatId ? d.chatId.split('@')[0] : '';
    const phoneLink = phoneRaw
      ? `<a href="https://wa.me/${phoneRaw}" target="_blank" rel="noopener">${phoneRaw}</a>`
      : '';
    const icon = statusIcons[d.status] || 'question-circle';
    tr.innerHTML = `<td>${d.tracking}</td><td>${otp}</td><td>${phoneLink}</td><td class="status"><i class="bi bi-${icon}"></i> ${d.status}</td><td>${formatAge(d.updated)}</td>`;
    tbody.appendChild(tr);
  });
}

const base = window.location.pathname.replace(/\/?$/, '/');

function updateQr() {
  const img = document.getElementById('qr');
  fetch(base + 'qr.png')
    .then(res => {
      if (!res.ok) throw new Error('no qr');
      img.src = base + 'qr.png?' + Date.now();
      img.classList.remove('d-none');
    })
    .catch(() => {
      img.classList.add('d-none');
    });
}
let lastQrId = null;

function handleState(data) {
  renderDeliveries(data.deliveries, data.otps);
  if (data.ready) {
    document.getElementById('qr').classList.add('d-none');
    bootstrap
      .Tab.getOrCreateInstance(document.querySelector('#dashboard-tab'))
      .show();
  } else {
    if (data.qrId !== lastQrId) {
      updateQr();
      lastQrId = data.qrId;
    }
    bootstrap.Tab.getOrCreateInstance(
      document.querySelector('#login-tab')
    ).show();
  }
}

async function initState() {
  const poll = async () => {
    try {
      const res = await fetch(base + 'api/state');
      handleState(await res.json());
    } catch {}
  };
  await poll();
  const source = new EventSource(base + 'api/state-stream', {
    withCredentials: true
  });
  let polling = false;
  const startPolling = () => {
    if (polling) return;
    polling = true;
    setInterval(poll, 5000);
  };
  let timer = setTimeout(() => {
    source.close();
    startPolling();
  }, 5000);
  const ready = () => {
    clearTimeout(timer);
    timer = null;
  };
  source.addEventListener('streaming-works', ready);
  source.onmessage = e => {
    ready();
    handleState(JSON.parse(e.data));
  };
  source.onerror = () => {
    if (timer) clearTimeout(timer);
    source.close();
    startPolling();
  };
}

async function initLogs() {
  const fetchLogs = async () => {
    try {
      const res = await fetch(base + 'api/logs');
      const logs = await res.json();
      const logEl = document.getElementById('log');
      logEl.textContent = logs.join('\n');
      logEl.scrollTop = logEl.scrollHeight;
    } catch {}
  };
  await fetchLogs();
  const source = new EventSource(base + 'api/log-stream', {
    withCredentials: true
  });
  const logEl = document.getElementById('log');
  let polling = false;
  const startPolling = () => {
    if (polling) return;
    polling = true;
    setInterval(fetchLogs, 5000);
  };
  let timer = setTimeout(() => {
    source.close();
    startPolling();
  }, 5000);
  const ready = () => {
    clearTimeout(timer);
    timer = null;
  };
  source.addEventListener('streaming-works', ready);
  source.onmessage = e => {
    ready();
    logEl.textContent += '\n' + e.data;
    logEl.scrollTop = logEl.scrollHeight;
  };
  source.onerror = () => {
    if (timer) clearTimeout(timer);
    source.close();
    startPolling();
  };
}

async function initSettings() {
  try {
    const res = await fetch(base + 'api/settings');
    const settings = await res.json();
    const tbody = document.querySelector('#settings-table tbody');
    Object.entries(settings).forEach(([k, v]) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${k}</td><td>${v}</td>`;
      tbody.appendChild(tr);
    });
  } catch {}
}

initState();
initLogs();
initSettings();
