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

function renderOtps(otps, deliveries) {
  const tbody = document.querySelector('#otp-table tbody');
  tbody.innerHTML = '';
  deliveries
    .filter(d => d.status === 'expected soon')
    .forEach(d => {
      const info = otps[d.tracking];
      if (!info) return;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${d.tracking}</td><td>${info.otp}</td><td>${formatAge(info.timestamp)}</td>`;
      tbody.appendChild(tr);
    });
}

function renderDeliveries(deliveries, otps) {
  const tbody = document.querySelector('#deliveries-table tbody');
  tbody.innerHTML = '';
  deliveries.forEach(d => {
    const tr = document.createElement('tr');
    const otp = otps[d.tracking]?.otp || '';
    const phone = d.chatId || '';
    const icon = statusIcons[d.status] || 'question-circle';
    tr.innerHTML = `<td>${d.tracking}</td><td>${otp}</td><td>${phone}</td><td><i class="bi bi-${icon}"></i> ${d.status}</td><td>${formatAge(d.updated)}</td>`;
    tbody.appendChild(tr);
  });
}

function updateQr() {
  const img = document.getElementById('qr');
  fetch('/qr.png')
    .then(res => {
      if (!res.ok) throw new Error('no qr');
      img.src = '/qr.png?' + Date.now();
      img.classList.remove('d-none');
    })
    .catch(() => {
      img.classList.add('d-none');
    });
}

function initState() {
  const source = new EventSource('/api/state-stream');
  source.onmessage = e => {
    const data = JSON.parse(e.data);
    renderOtps(data.otps, data.deliveries);
    renderDeliveries(data.deliveries, data.otps);
  };
}

async function initLogs() {
  try {
    const res = await fetch('/api/logs');
    const logs = await res.json();
    const logEl = document.getElementById('log');
    logEl.textContent = logs.join('\n');
    logEl.scrollTop = logEl.scrollHeight;
  } catch {}
  const source = new EventSource('/api/log-stream');
  const logEl = document.getElementById('log');
  source.onmessage = e => {
    logEl.textContent += '\n' + e.data;
    logEl.scrollTop = logEl.scrollHeight;
  };
}

initState();
initLogs();
updateQr();
setInterval(updateQr, 10000);
