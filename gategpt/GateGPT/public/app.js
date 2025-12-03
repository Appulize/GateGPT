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

const completedStatuses = new Set(['delivered']);

const base = window.location.pathname.replace(/\/?$/, '/');

async function requestDelete(tracking, button) {
  if (!tracking) return;
  const confirmed = window.confirm(
    `Delete delivery ${tracking}? This will also remove the OTP.`
  );
  if (!confirmed) return;

  button.disabled = true;
  try {
    const res = await fetch(
      `${base}api/deliveries/${encodeURIComponent(tracking)}`,
      { method: 'DELETE' }
    );
    if (!res.ok) {
      button.disabled = false;
      let message = 'Failed to delete delivery.';
      try {
        const data = await res.json();
        if (data?.error) message = data.error;
      } catch {}
      window.alert(message);
    }
  } catch {
    button.disabled = false;
    window.alert(
      'Failed to delete delivery. Please check your connection and try again.'
    );
  }
}

async function requestOtpUpdate(tracking, otp) {
  if (!tracking) throw new Error('Tracking number is required.');
  const res = await fetch(
    `${base}api/otps/${encodeURIComponent(tracking)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp })
    }
  );

  if (!res.ok) {
    let message = 'Failed to update OTP.';
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {}
    throw new Error(message);
  }
}

let latestState = null;
let activeEditors = 0;
let pendingRender = false;

function renderDeliveries(deliveries, otps) {
  const tbody = document.querySelector('#deliveries-table tbody');
  tbody.innerHTML = '';
  deliveries.forEach(d => {
    const tr = document.createElement('tr');
    const otp = otps[d.tracking]?.otp || '';
    const phoneRaw = d.chatId ? d.chatId.split('@')[0] : '';
    const icon = statusIcons[d.status] || 'question-circle';
    const trackingTd = document.createElement('td');
    trackingTd.textContent = d.tracking || '';
    tr.appendChild(trackingTd);

    const otpTd = document.createElement('td');
    const otpText = document.createElement('span');
    otpText.textContent = otp;
    otpTd.appendChild(otpText);

    const otpInput = document.createElement('input');
    otpInput.type = 'text';
    otpInput.className = 'form-control form-control-sm d-none';
    otpInput.value = otp;
    otpInput.spellcheck = false;
    otpTd.appendChild(otpInput);
    tr.appendChild(otpTd);

    const phoneTd = document.createElement('td');
    if (phoneRaw) {
      const link = document.createElement('a');
      link.href = `https://wa.me/${phoneRaw}`;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = phoneRaw;
      phoneTd.appendChild(link);
    }
    tr.appendChild(phoneTd);

    const statusTd = document.createElement('td');
    statusTd.classList.add('status');
    const statusIcon = document.createElement('i');
    statusIcon.className = `bi bi-${icon}`;
    statusTd.appendChild(statusIcon);
    statusTd.appendChild(document.createTextNode(` ${d.status}`));
    tr.appendChild(statusTd);

    const updatedTd = document.createElement('td');
    updatedTd.textContent = formatAge(d.updated);
    tr.appendChild(updatedTd);

    const actionsTd = document.createElement('td');
    actionsTd.classList.add('text-end');
    if (d.tracking) {
      let otpValue = otp;
      let editing = false;
      let saving = false;

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-outline-secondary btn-sm me-2';
      editBtn.title = 'Edit OTP';
      editBtn.setAttribute('aria-label', `Edit OTP for ${d.tracking}`);
      const editIcon = document.createElement('i');
      editIcon.className = 'bi bi-pencil';
      editBtn.appendChild(editIcon);

      const syncPendingState = () => {
        if (activeEditors === 0 && pendingRender && latestState) {
          pendingRender = false;
          renderDeliveries(latestState.deliveries, latestState.otps);
        }
      };

      const setEditing = enable => {
        if (editing === enable) return;
        editing = enable;
        if (enable) {
          activeEditors += 1;
          otpInput.classList.remove('d-none');
          otpText.classList.add('d-none');
          otpInput.value = otpValue;
          editIcon.className = 'bi bi-check';
          editBtn.title = 'Save OTP';
          editBtn.setAttribute('aria-label', `Save OTP for ${d.tracking}`);
          otpInput.focus();
          otpInput.select();
        } else {
          activeEditors = Math.max(0, activeEditors - 1);
          otpInput.classList.add('d-none');
          otpText.classList.remove('d-none');
          otpInput.value = otpValue;
          editIcon.className = 'bi bi-pencil';
          editBtn.title = 'Edit OTP';
          editBtn.setAttribute('aria-label', `Edit OTP for ${d.tracking}`);
          syncPendingState();
        }
      };

      const cancelEdit = () => {
        if (saving) return;
        otpInput.value = otpValue;
        setEditing(false);
      };

      const saveOtp = async () => {
        if (!editing || saving) return;
        const nextValue = otpInput.value.trim();
        if (!nextValue) {
          window.alert('OTP cannot be empty.');
          otpInput.focus();
          return;
        }
        saving = true;
        editBtn.disabled = true;
        otpInput.disabled = true;
        try {
          await requestOtpUpdate(d.tracking, nextValue);
          otpValue = nextValue;
          otpText.textContent = otpValue;
          setEditing(false);
        } catch (err) {
          window.alert(err?.message || 'Failed to update OTP.');
          otpInput.focus();
        } finally {
          saving = false;
          editBtn.disabled = false;
          otpInput.disabled = false;
        }
      };

      editBtn.addEventListener('click', () => {
        if (editing) {
          saveOtp();
        } else {
          setEditing(true);
        }
      });

      otpInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveOtp();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelEdit();
        }
      });

      actionsTd.appendChild(editBtn);
    }

    if (d.tracking && !completedStatuses.has(d.status)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-outline-danger btn-sm';
      btn.title = 'Delete delivery';
      btn.setAttribute('aria-label', `Delete delivery ${d.tracking}`);
      const trashIcon = document.createElement('i');
      trashIcon.className = 'bi bi-trash';
      btn.appendChild(trashIcon);
      btn.addEventListener('click', () => requestDelete(d.tracking, btn));
      actionsTd.appendChild(btn);
    }
    tr.appendChild(actionsTd);

    tbody.appendChild(tr);
  });
}

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

const queueRender = () => {
  if (!latestState) return;
  if (activeEditors > 0) {
    pendingRender = true;
    return;
  }
  pendingRender = false;
  renderDeliveries(latestState.deliveries, latestState.otps);
};

function handleState(data) {
  latestState = data;
  queueRender();
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
