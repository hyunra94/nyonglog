(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const WORKER_URL = String(window.PAPER_LOG_CONFIG?.WORKER_URL || '').replace(/\/+$/, '');
  const SETTINGS_KEY = 'paperLogLocalSettingsV2';
  const LEGACY_SETTINGS_KEY = 'paperLogLocalSettingsV1';
  const PIN_HASH_KEY = 'paperLogLocalPinHashV2';
  const SESSION_APP_KEY = 'paperLogLocalRuntimeKeyV2';
  const CRYPTO_ITERATIONS = 210000;
  const DB_NAME = 'paper-log-local';
  const DB_VERSION = 1;
  const MONEY_STORE = 'moneyRecords';

  const state = {
    tab: 'home',
    today: new Date(),
    selectedDate: dateKey(new Date()),
    calendarMonth: startOfMonth(new Date()),
    moneyMonth: startOfMonth(new Date()),
    schedules: [],
    moneyRecords: [],
    moneyType: 'expense',
    selectedMoneyDate: '',
    editingSchedule: null,
    editingMoney: null,
    showCanceled: false,
    deferredInstallPrompt: null,
    settings: loadSettings(),
    runtimeAppKey: sessionStorage.getItem(SESSION_APP_KEY) || '',
    unlocked: false,
  };

  const moneyDb = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(MONEY_STORE)) {
            const store = db.createObjectStore(MONEY_STORE, { keyPath: 'id' });
            store.createIndex('date', 'date', { unique: false });
            store.createIndex('type', 'type', { unique: false });
            store.createIndex('updatedAt', 'updatedAt', { unique: false });
          }
        };
        req.onsuccess = () => {
          this.db = req.result;
          resolve(this.db);
        };
        req.onerror = () => reject(req.error);
      });
    },
    async getAll() {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(MONEY_STORE, 'readonly');
        const req = tx.objectStore(MONEY_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    },
    async put(record) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(MONEY_STORE, 'readwrite');
        tx.objectStore(MONEY_STORE).put(record);
        tx.oncomplete = () => resolve(record);
        tx.onerror = () => reject(tx.error);
      });
    },
    async delete(id) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(MONEY_STORE, 'readwrite');
        tx.objectStore(MONEY_STORE).delete(id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    },
    async clear() {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(MONEY_STORE, 'readwrite');
        tx.objectStore(MONEY_STORE).clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    },
    async bulkPut(records) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(MONEY_STORE, 'readwrite');
        const store = tx.objectStore(MONEY_STORE);
        records.forEach(record => store.put(record));
        tx.oncomplete = () => resolve(records.length);
        tx.onerror = () => reject(tx.error);
      });
    },
  };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindEvents();
    renderDateStrip();
    renderHeader();
    restoreSettingsForm();
    await setupLock();
    await loadMoney();
    renderAll();
    await loadCalendar(true);
    registerServiceWorker();
  }

  function bindEvents() {
    $$('.navBtn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
    $('#openSettingsBtn').addEventListener('click', () => switchTab('settings'));
    $('#quickAddSchedule').addEventListener('click', () => openScheduleSheet({ date: state.selectedDate }));
    $('#quickAddMoney').addEventListener('click', () => openMoneySheet({ date: state.selectedDate }));

    $('#prevCalendarMonth').addEventListener('click', () => changeCalendarMonth(-1));
    $('#nextCalendarMonth').addEventListener('click', () => changeCalendarMonth(1));
    $('#calendarMonthTitle').addEventListener('click', () => {
      state.calendarMonth = startOfMonth(new Date());
      state.selectedDate = dateKey(new Date());
      loadCalendar(false);
      renderAll();
    });
    $('#refreshCalendar').addEventListener('click', () => loadCalendar(false));
    $('#showCanceled').addEventListener('change', e => {
      state.showCanceled = e.target.checked;
      loadCalendar(false);
    });
    $('#openScheduleFab').addEventListener('click', () => openScheduleSheet({ date: state.selectedDate }));

    $('#prevMoneyMonth').addEventListener('click', () => changeMoneyMonth(-1));
    $('#nextMoneyMonth').addEventListener('click', () => changeMoneyMonth(1));
    $('#moneyMonthTitle').addEventListener('click', () => {
      state.moneyMonth = startOfMonth(new Date());
      state.selectedMoneyDate = '';
      renderAll();
    });
    $('#openMoneyFab').addEventListener('click', () => openMoneySheet({ date: state.selectedMoneyDate || state.selectedDate }));
    $('#clearMoneyDateFilter').addEventListener('click', () => {
      state.selectedMoneyDate = '';
      renderMoney();
    });

    $('#closeScheduleSheet').addEventListener('click', closeScheduleSheet);
    $('#scheduleSheet').addEventListener('click', e => { if (e.target.id === 'scheduleSheet') closeScheduleSheet(); });
    $('#scheduleForm').addEventListener('submit', saveSchedule);
    $('#deleteScheduleBtn').addEventListener('click', deleteSchedule);

    $('#closeMoneySheet').addEventListener('click', closeMoneySheet);
    $('#moneySheet').addEventListener('click', e => { if (e.target.id === 'moneySheet') closeMoneySheet(); });
    $('#moneyForm').addEventListener('submit', saveMoneyRecord);
    $('#deleteMoneyBtn').addEventListener('click', deleteMoneyRecord);
    $$('.typeBtn').forEach(btn => btn.addEventListener('click', () => setMoneyType(btn.dataset.moneyType)));

    $('#settingsForm').addEventListener('submit', saveSettingsForm);
    $('#settingRememberKey').addEventListener('change', syncRememberPinField);
    $('#testConnectionBtn').addEventListener('click', testConnection);
    $('#clearSettingsBtn').addEventListener('click', clearSettings);
    $('#pinForm').addEventListener('submit', savePin);
    $('#clearPinBtn').addEventListener('click', clearPin);
    $('#unlockForm').addEventListener('submit', unlockApp);

    $('#exportJsonBtn').addEventListener('click', exportJson);
    $('#importJsonInput').addEventListener('change', importJson);
    $('#exportMonthCsvBtn').addEventListener('click', () => exportCsv(false));
    $('#exportAllCsvBtn').addEventListener('click', () => exportCsv(true));
    $('#clearMoneyBtn').addEventListener('click', clearMoneyData);

    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      state.deferredInstallPrompt = event;
      $('#installPwaBtn').hidden = false;
    });
    $('#installPwaBtn').addEventListener('click', async () => {
      if (!state.deferredInstallPrompt) return;
      state.deferredInstallPrompt.prompt();
      await state.deferredInstallPrompt.userChoice.catch(() => null);
      state.deferredInstallPrompt = null;
      $('#installPwaBtn').hidden = true;
    });
  }

  async function setupLock() {
    if (needsUnlock()) {
      $('#lockScreen').hidden = false;
      setTimeout(() => $('#unlockPin').focus(), 50);
    }
  }

  function needsUnlock() {
    return Boolean(state.settings.encryptedAppKey || state.settings.pinHash);
  }

  async function unlockApp(event) {
    event.preventDefault();
    const pin = $('#unlockPin').value.trim();
    if (!pin) {
      $('#unlockStatus').textContent = 'PIN을 입력해 주세요.';
      return;
    }

    try {
      if (state.settings.pinHash) {
        const ok = await verifyPin(pin, state.settings);
        if (!ok) throw new Error('PIN이 맞지 않아요.');
      }

      if (state.settings.encryptedAppKey) {
        state.runtimeAppKey = await decryptString(state.settings.encryptedAppKey, pin);
        sessionStorage.setItem(SESSION_APP_KEY, state.runtimeAppKey);
      }

      state.unlocked = true;
      $('#lockScreen').hidden = true;
      $('#unlockStatus').textContent = '';
      $('#unlockPin').value = '';
      restoreSettingsForm();
      await loadCalendar(false);
      renderAll();
    } catch (error) {
      $('#unlockStatus').textContent = error.message || '잠금을 해제하지 못했어요.';
    }
  }

  async function savePin(event) {
    event.preventDefault();
    const pin = $('#newPin').value.trim();
    if (pin.length < 4) {
      $('#pinStatus').textContent = 'PIN은 4자리 이상으로 입력해 주세요.';
      return;
    }

    if (state.settings.encryptedAppKey) {
      const appKey = getAppKey();
      if (!appKey) {
        $('#pinStatus').textContent = '저장된 앱 키가 있어요. 먼저 현재 PIN으로 잠금을 해제한 뒤 PIN을 변경해 주세요.';
        return;
      }
      state.settings.encryptedAppKey = await encryptString(appKey, pin);
    }

    Object.assign(state.settings, await createPinFields(pin));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    $('#newPin').value = '';
    $('#pinStatus').textContent = state.settings.encryptedAppKey
      ? 'PIN을 변경하고 저장된 앱 키도 새 PIN으로 다시 암호화했어요.'
      : 'PIN을 저장했어요. 다음 실행부터 잠금 화면이 표시됩니다.';
  }

  function clearPin() {
    const hasSavedKey = Boolean(state.settings.encryptedAppKey);
    const message = hasSavedKey
      ? 'PIN을 해제하면 이 기기에 저장된 앱 키도 함께 삭제됩니다. 계속할까요?'
      : '앱 잠금 PIN을 해제할까요?';
    if (!confirm(message)) return;

    delete state.settings.pinHash;
    delete state.settings.pinSalt;
    delete state.settings.pinIterations;

    if (hasSavedKey) {
      delete state.settings.encryptedAppKey;
      state.settings.rememberKey = false;
      state.runtimeAppKey = '';
      sessionStorage.removeItem(SESSION_APP_KEY);
      $('#settingAppKey').value = '';
    }

    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    $('#pinStatus').textContent = hasSavedKey
      ? 'PIN과 이 기기에 저장된 앱 키를 삭제했어요.'
      : 'PIN을 해제했어요.';
    restoreSettingsForm();
  }

  async function createPinFields(pin) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const bits = await derivePinBits(pin, salt, CRYPTO_ITERATIONS);
    return {
      pinSalt: bytesToBase64(salt),
      pinHash: bytesToBase64(new Uint8Array(bits)),
      pinIterations: CRYPTO_ITERATIONS,
    };
  }

  async function verifyPin(pin, settings) {
    if (!settings.pinHash || !settings.pinSalt) return false;
    const salt = base64ToBytes(settings.pinSalt);
    const iterations = Number(settings.pinIterations || CRYPTO_ITERATIONS);
    const bits = await derivePinBits(pin, salt, iterations);
    return timingSafeEqual(bytesToBase64(new Uint8Array(bits)), settings.pinHash);
  }

  async function derivePinBits(pin, salt, iterations) {
    const baseKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(pin),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    return crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      baseKey,
      256
    );
  }

  async function deriveAesKey(pin, salt, iterations) {
    const baseKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(pin),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptString(text, pin) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveAesKey(pin, salt, CRYPTO_ITERATIONS);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(text)
    );
    return {
      v: 1,
      alg: 'AES-GCM',
      kdf: 'PBKDF2-SHA256',
      iterations: CRYPTO_ITERATIONS,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      data: bytesToBase64(new Uint8Array(encrypted)),
    };
  }

  async function decryptString(payload, pin) {
    if (!payload?.salt || !payload?.iv || !payload?.data) throw new Error('저장된 앱 키 형식이 올바르지 않아요.');
    const salt = base64ToBytes(payload.salt);
    const iv = base64ToBytes(payload.iv);
    const iterations = Number(payload.iterations || CRYPTO_ITERATIONS);
    const key = await deriveAesKey(pin, salt, iterations);
    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        base64ToBytes(payload.data)
      );
      return new TextDecoder().decode(decrypted);
    } catch {
      throw new Error('PIN이 맞지 않거나 저장된 앱 키를 복호화할 수 없어요.');
    }
  }

  function bytesToBase64(bytes) {
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function base64ToBytes(text) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function timingSafeEqual(a, b) {
    if (a.length !== b.length) return false;
    let out = 0;
    for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return out === 0;
  }

  function switchTab(tab) {
    state.tab = tab;
    $$('.page').forEach(page => page.classList.toggle('on', page.dataset.page === tab));
    $$('.navBtn').forEach(btn => btn.classList.toggle('on', btn.dataset.tab === tab));
    renderHeader();
    if (tab === 'calendar') renderCalendar();
    if (tab === 'money') renderMoney();
  }

  function renderHeader() {
    const label = {
      home: 'Calendar in Notion · Money on this device',
      calendar: '일정 DB만 Notion과 연결돼요',
      money: '가계부는 이 기기에 로컬 저장돼요',
      settings: '연결 · 잠금 · 백업',
    }[state.tab] || 'Paper Log Local';
    $('#headerSub').textContent = label;
  }

  function renderAll() {
    renderDateStrip();
    renderHome();
    renderCalendar();
    renderMoney();
  }

  function renderDateStrip() {
    const wrap = $('#dateStrip');
    wrap.innerHTML = '';
    const base = new Date();
    const monday = addDays(base, -((base.getDay() + 6) % 7));
    for (let i = 0; i < 7; i += 1) {
      const d = addDays(monday, i);
      const key = dateKey(d);
      const btn = document.createElement('button');
      btn.className = `pill ${isWeekend(d) ? 'weekend' : ''} ${key === state.selectedDate ? 'on' : ''}`;
      btn.type = 'button';
      btn.innerHTML = `<strong>${d.getDate()}</strong><span>${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i]}</span>`;
      btn.addEventListener('click', () => {
        state.selectedDate = key;
        renderAll();
        if (state.tab === 'calendar') switchTab('calendar');
      });
      wrap.appendChild(btn);
    }
    $('#todayLabel').textContent = formatKoreanDate(new Date());
  }

  async function loadCalendar(silent) {
    const status = $('#calendarStatus');
    if (!hasApiConfig()) {
      if (!silent) status.textContent = '설정에서 앱 키를 입력하고, config.js의 Worker URL을 확인해 주세요.';
      renderCalendar();
      renderHome();
      return;
    }
    const range = calendarGridRange(state.calendarMonth);
    const qs = new URLSearchParams({ from: range.from, to: range.to, includeCanceled: String(state.showCanceled) });
    try {
      if (!silent) status.textContent = 'Notion에서 일정을 불러오는 중이에요.';
      const res = await apiFetch(`/api/calendar?${qs.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.message || data.error || 'Worker 응답 오류');
      state.schedules = Array.isArray(data.schedules) ? data.schedules : [];
      status.textContent = `Notion 불러오기 완료 · 일정 ${state.schedules.length}개`;
    } catch (error) {
      status.textContent = `불러오기 실패: ${error.message}`;
    }
    renderCalendar();
    renderHome();
  }

  async function saveSchedule(event) {
    event.preventDefault();
    const status = $('#scheduleFormStatus');
    if (!hasApiConfig()) {
      status.textContent = '설정에서 앱 키를 입력하고, config.js의 Worker URL을 확인해 주세요.';
      return;
    }
    const body = {
      title: $('#scheduleTitle').value.trim(),
      date: $('#scheduleDate').value,
      endDate: $('#scheduleEndDate').value,
      time: $('#scheduleTime').value,
      category: $('#scheduleCategory').value.trim(),
      canceled: $('#scheduleCanceled').checked,
      memoTags: parseTags($('#scheduleMemoTags').value),
    };
    if (!body.title || !body.date) return;
    if (state.editingSchedule?.id) body.id = state.editingSchedule.id;
    try {
      status.textContent = '저장 중이에요.';
      const res = await apiFetch('/api/calendar', {
        method: state.editingSchedule?.id ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.message || data.error || '저장 실패');
      closeScheduleSheet();
      await loadCalendar(false);
    } catch (error) {
      status.textContent = `저장 실패: ${error.message}`;
    }
  }

  async function deleteSchedule() {
    if (!state.editingSchedule?.id) return;
    if (!confirm('이 일정을 삭제할까요? Notion에서는 보관 처리됩니다.')) return;
    try {
      const res = await apiFetch('/api/calendar', {
        method: 'DELETE',
        body: JSON.stringify({ id: state.editingSchedule.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.message || data.error || '삭제 실패');
      closeScheduleSheet();
      await loadCalendar(false);
    } catch (error) {
      $('#scheduleFormStatus').textContent = `삭제 실패: ${error.message}`;
    }
  }

  function renderCalendar() {
    $('#showCanceled').checked = state.showCanceled;
    $('#calendarMonthTitle').textContent = monthLabel(state.calendarMonth);
    const grid = $('#calendarGrid');
    grid.innerHTML = '';
    ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach((w, i) => {
      const cell = document.createElement('div');
      cell.className = `wd ${i >= 5 ? 'weekend' : ''}`;
      cell.textContent = w;
      grid.appendChild(cell);
    });
    const start = gridStartMonday(state.calendarMonth);
    const today = dateKey(new Date());
    const monthKeyValue = monthKey(state.calendarMonth);
    for (let i = 0; i < 42; i += 1) {
      const d = addDays(start, i);
      const key = dateKey(d);
      const items = schedulesForDate(key);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = `day ${monthKey(d) !== monthKeyValue ? 'mute' : ''} ${isWeekend(d) ? 'weekend' : ''} ${key === today ? 'today' : ''} ${key === state.selectedDate ? 'sel' : ''}`;
      cell.innerHTML = `<span class="num">${d.getDate()}</span><span class="dots">${items.slice(0, 4).map(item => `<i class="dot ${colorClass(item)}"></i>`).join('')}</span>`;
      cell.addEventListener('click', () => {
        state.selectedDate = key;
        renderAll();
      });
      grid.appendChild(cell);
    }
    renderCalendarDetail();
  }

  function renderCalendarDetail() {
    const detail = $('#calendarDetail');
    const items = schedulesForDate(state.selectedDate);
    const label = formatKoreanDate(toDate(state.selectedDate));
    detail.innerHTML = `<h4>${label}</h4>`;
    if (!items.length) {
      detail.insertAdjacentHTML('beforeend', '<p class="empty">일정이 없어요.</p>');
      return;
    }
    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'eventItem';
      row.innerHTML = `
        <span class="time">${item.time || 'all'}</span>
        <button type="button">
          <strong>${escapeHtml(item.title || '제목 없음')}</strong>
          ${item.memoTags?.length ? `<div class="memoTags">${item.memoTags.map(t => `#${escapeHtml(t)}`).join(' ')}</div>` : ''}
        </button>
        <span class="tag ${item.canceled ? 'canceled' : ''}">${item.canceled ? '취소' : escapeHtml(item.category || '일정')}</span>
      `;
      row.querySelector('button').addEventListener('click', () => openScheduleSheet(item));
      detail.appendChild(row);
    });
  }

  function renderHome() {
    const todayKey = dateKey(new Date());
    const todayItems = state.schedules.filter(item => item.date === todayKey).sort(sortSchedule);
    const list = $('#homeSchedules');
    list.innerHTML = '';
    todayItems.forEach(item => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="time">${item.time || 'all'}</span><span>${escapeHtml(item.title || '제목 없음')} <em class="tag ${item.canceled ? 'canceled' : ''}">${item.canceled ? '취소' : escapeHtml(item.category || '일정')}</em></span>`;
      list.appendChild(li);
    });
    $('#homeScheduleEmpty').hidden = todayItems.length > 0;

    const monthRecords = moneyRecordsInMonth(new Date());
    const summary = summarizeMoney(monthRecords);
    $('#homeIncome').textContent = won(summary.income);
    $('#homeExpense').textContent = won(summary.expense);
    $('#homeBalance').textContent = won(summary.income - summary.expense);
  }

  async function loadMoney() {
    try {
      state.moneyRecords = (await moneyDb.getAll()).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
    } catch (error) {
      $('#moneyStatus').textContent = `로컬 가계부 로드 실패: ${error.message}`;
    }
  }

  async function saveMoneyRecord(event) {
    event.preventDefault();
    const now = new Date().toISOString();
    const record = {
      id: state.editingMoney?.id || crypto.randomUUID(),
      type: state.moneyType,
      date: $('#moneyDate').value,
      title: $('#moneyTitle').value.trim(),
      amount: Number($('#moneyAmount').value || 0),
      category: $('#moneyCategory').value.trim(),
      payment: $('#moneyPayment').value.trim(),
      memo: $('#moneyMemo').value.trim(),
      waste: state.moneyType === 'expense' ? $('#moneyWaste').checked : false,
      createdAt: state.editingMoney?.createdAt || now,
      updatedAt: now,
    };
    if (!record.date || !record.title || record.amount <= 0) return;
    await moneyDb.put(record);
    closeMoneySheet();
    await loadMoney();
    renderAll();
    $('#moneyStatus').textContent = '가계부를 저장했어요.';
  }

  async function deleteMoneyRecord() {
    if (!state.editingMoney?.id) return;
    if (!confirm('이 가계부 기록을 삭제할까요?')) return;
    await moneyDb.delete(state.editingMoney.id);
    closeMoneySheet();
    await loadMoney();
    renderAll();
    $('#moneyStatus').textContent = '가계부 기록을 삭제했어요.';
  }

  function renderMoney() {
    $('#moneyMonthTitle').textContent = monthLabel(state.moneyMonth);
    const records = moneyRecordsInMonth(state.moneyMonth);
    const summary = summarizeMoney(records);
    $('#moneyIncomeTotal').textContent = won(summary.income);
    $('#moneyExpenseTotal').textContent = won(summary.expense);
    $('#moneyBalanceTotal').textContent = won(summary.income - summary.expense);
    $('#moneyWasteTotal').textContent = won(summary.waste);
    renderMoneyMiniCalendar(records);
    renderMoneyRecords(records);
  }

  function renderMoneyMiniCalendar(records) {
    const grid = $('#moneyMiniCal');
    grid.innerHTML = '';
    ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach((w, i) => {
      const cell = document.createElement('div');
      cell.className = `moneyWd ${i >= 5 ? 'weekend' : ''}`;
      cell.textContent = w;
      grid.appendChild(cell);
    });
    const start = gridStartMonday(state.moneyMonth);
    const today = dateKey(new Date());
    const monthKeyValue = monthKey(state.moneyMonth);
    for (let i = 0; i < 42; i += 1) {
      const d = addDays(start, i);
      const key = dateKey(d);
      const dayRecords = records.filter(record => record.date === key);
      const hasIncome = dayRecords.some(record => record.type === 'income');
      const hasExpense = dayRecords.some(record => record.type === 'expense');
      const hasWaste = dayRecords.some(record => record.waste);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = `moneyDay ${monthKey(d) !== monthKeyValue ? 'mute' : ''} ${isWeekend(d) ? 'weekend' : ''} ${key === today ? 'today' : ''} ${key === state.selectedMoneyDate ? 'sel' : ''} ${hasIncome && hasExpense ? 'both' : hasIncome ? 'incomeOnly' : hasExpense ? 'expenseOnly' : ''} ${hasWaste ? 'wasteFlag' : ''}`;
      cell.innerHTML = `<span class="num">${d.getDate()}</span><span class="moneyDots">${hasIncome ? '<i class="moneyDot income"></i>' : ''}${hasExpense ? '<i class="moneyDot expense"></i>' : ''}${hasWaste ? '<i class="moneyDot waste"></i>' : ''}</span>`;
      cell.addEventListener('click', () => {
        state.selectedMoneyDate = key;
        renderMoney();
      });
      grid.appendChild(cell);
    }
  }

  function renderMoneyRecords(monthRecords) {
    const filtered = state.selectedMoneyDate ? monthRecords.filter(record => record.date === state.selectedMoneyDate) : monthRecords;
    const list = $('#moneyRecords');
    list.innerHTML = '';
    filtered.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.updatedAt).localeCompare(String(a.updatedAt))).forEach(record => {
      const li = document.createElement('li');
      li.innerHTML = `
        <button type="button">
          <strong>${escapeHtml(record.title)}</strong>${record.waste ? '<span class="wasteTag">낭비</span>' : ''}
          <small>${record.date} · ${escapeHtml(record.category || '미분류')} · ${escapeHtml(record.payment || '결제수단 없음')}${record.memo ? ` · ${escapeHtml(record.memo)}` : ''}</small>
        </button>
        <span class="amount ${record.type}">${record.type === 'income' ? '+' : '-'}${won(record.amount)}</span>
        <span class="tag">${record.type === 'income' ? '수입' : '지출'}</span>
      `;
      li.querySelector('button').addEventListener('click', () => openMoneySheet(record));
      list.appendChild(li);
    });
    $('#moneyEmpty').hidden = filtered.length > 0;
    $('#clearMoneyDateFilter').hidden = !state.selectedMoneyDate;
    $('#moneyFilterLabel').textContent = state.selectedMoneyDate ? `${formatKoreanDate(toDate(state.selectedMoneyDate))} 기록` : '전체 월 기록';
  }

  function openScheduleSheet(item = {}) {
    state.editingSchedule = item.id ? item : null;
    $('#scheduleSheetTitle').textContent = item.id ? '일정 수정' : '일정 추가';
    $('#deleteScheduleBtn').hidden = !item.id;
    $('#scheduleTitle').value = item.title || '';
    $('#scheduleDate').value = item.date || state.selectedDate || dateKey(new Date());
    $('#scheduleEndDate').value = item.originalEndDate || item.endDate || '';
    $('#scheduleTime').value = item.time || '';
    $('#scheduleCategory').value = item.category || '';
    $('#scheduleMemoTags').value = Array.isArray(item.memoTags) ? item.memoTags.join(', ') : '';
    $('#scheduleCanceled').checked = Boolean(item.canceled);
    $('#scheduleFormStatus').textContent = '';
    $('#scheduleSheet').hidden = false;
    setTimeout(() => $('#scheduleTitle').focus(), 80);
  }

  function closeScheduleSheet() {
    state.editingSchedule = null;
    $('#scheduleSheet').hidden = true;
    $('#scheduleForm').reset();
  }

  function openMoneySheet(item = {}) {
    state.editingMoney = item.id ? item : null;
    setMoneyType(item.type || 'expense');
    $('#moneySheetTitle').textContent = item.id ? '가계부 수정' : '가계부 입력';
    $('#deleteMoneyBtn').hidden = !item.id;
    $('#moneyDate').value = item.date || state.selectedMoneyDate || state.selectedDate || dateKey(new Date());
    $('#moneyTitle').value = item.title || '';
    $('#moneyAmount').value = item.amount || '';
    $('#moneyCategory').value = item.category || '';
    $('#moneyPayment').value = item.payment || '';
    $('#moneyMemo').value = item.memo || '';
    $('#moneyWaste').checked = Boolean(item.waste);
    $('#moneyFormStatus').textContent = '';
    $('#moneySheet').hidden = false;
    setTimeout(() => $('#moneyTitle').focus(), 80);
  }

  function closeMoneySheet() {
    state.editingMoney = null;
    $('#moneySheet').hidden = true;
    $('#moneyForm').reset();
    setMoneyType('expense');
  }

  function setMoneyType(type) {
    state.moneyType = type;
    $$('.typeBtn').forEach(btn => btn.classList.toggle('on', btn.dataset.moneyType === type));
    $('#wasteWrap').style.display = type === 'expense' ? 'inline-flex' : 'none';
  }

  function changeCalendarMonth(delta) {
    state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + delta, 1);
    state.selectedDate = dateKey(state.calendarMonth);
    loadCalendar(false);
    renderAll();
  }

  function changeMoneyMonth(delta) {
    state.moneyMonth = new Date(state.moneyMonth.getFullYear(), state.moneyMonth.getMonth() + delta, 1);
    state.selectedMoneyDate = '';
    renderAll();
  }

  function restoreSettingsForm() {
    const fixedWorker = $('#fixedWorkerUrl');
    fixedWorker.textContent = WORKER_URL || 'config.js에 Worker URL을 먼저 입력해 주세요.';
    fixedWorker.closest('.fixedInfo')?.classList.toggle('notReady', !isWorkerUrlReady());

    $('#settingAppKey').value = getAppKey();
    $('#settingRememberKey').checked = state.settings.rememberKey !== false;
    $('#settingStorePin').value = '';
    syncRememberPinField();
  }

  function syncRememberPinField() {
    const remember = $('#settingRememberKey').checked;
    $('#storePinWrap').hidden = !remember;
  }

  async function saveSettingsForm(event) {
    event.preventDefault();
    const appKey = $('#settingAppKey').value.trim();
    const rememberKey = $('#settingRememberKey').checked;
    const pin = $('#settingStorePin').value.trim();

    if (!isWorkerUrlReady()) {
      $('#settingsStatus').textContent = 'config.js의 WORKER_URL을 실제 Cloudflare Worker 주소로 바꿔 주세요.';
      return;
    }
    if (!appKey) {
      $('#settingsStatus').textContent = '앱 키를 입력해 주세요.';
      return;
    }

    if (rememberKey) {
      if (pin.length < 4) {
        $('#settingsStatus').textContent = '이 기기에 저장하려면 4자리 이상의 PIN이 필요해요.';
        return;
      }
      const encryptedAppKey = await encryptString(appKey, pin);
      state.settings = {
        rememberKey: true,
        encryptedAppKey,
        ...(await createPinFields(pin)),
      };
      state.runtimeAppKey = appKey;
      sessionStorage.setItem(SESSION_APP_KEY, appKey);
      $('#settingsStatus').textContent = '앱 키를 PIN으로 암호화해서 이 기기에 저장했어요. 다음 실행부터 PIN만 입력하면 됩니다.';
    } else {
      state.settings = { rememberKey: false };
      state.runtimeAppKey = appKey;
      sessionStorage.setItem(SESSION_APP_KEY, appKey);
      $('#settingsStatus').textContent = '앱 키를 이번 브라우저 세션에만 저장했어요. 앱을 닫으면 다시 입력해야 합니다.';
    }

    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    $('#settingStorePin').value = '';
    restoreSettingsForm();
    loadCalendar(false);
  }

  async function testConnection() {
    const status = $('#settingsStatus');
    if (!isWorkerUrlReady()) {
      status.textContent = 'config.js의 WORKER_URL을 실제 Cloudflare Worker 주소로 바꿔 주세요.';
      return;
    }
    if (!getAppKey()) {
      status.textContent = '앱 키를 먼저 입력하거나 PIN으로 잠금을 해제해 주세요.';
      return;
    }
    try {
      status.textContent = '연결 확인 중이에요.';
      const res = await apiFetch('/api/test');
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.message || data.error || '연결 실패');
      status.textContent = `연결 성공 · Schedule DB ${data.hasScheduleDb ? '확인' : '미설정'}`;
    } catch (error) {
      status.textContent = `연결 실패: ${error.message}`;
    }
  }

  function clearSettings() {
    if (!confirm('저장된 앱 키와 연결 설정을 삭제할까요?')) return;
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(LEGACY_SETTINGS_KEY);
    localStorage.removeItem(PIN_HASH_KEY);
    sessionStorage.removeItem(SESSION_APP_KEY);
    state.settings = loadSettings();
    state.runtimeAppKey = '';
    restoreSettingsForm();
    $('#settingsStatus').textContent = '저장된 앱 키와 설정을 삭제했어요.';
  }

  function loadSettings() {
    try {
      const current = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
      if (Object.keys(current).length) return current;

      // 이전 버전에서 저장된 평문 앱 키가 있으면 자동 사용하지 않고 삭제 유도용 상태만 반환합니다.
      const legacy = JSON.parse(localStorage.getItem(LEGACY_SETTINGS_KEY) || '{}') || {};
      if (legacy.appKey) {
        return { rememberKey: false, legacyNotice: true };
      }
      return {};
    } catch {
      return {};
    }
  }

  function isWorkerUrlReady() {
    return Boolean(WORKER_URL && !WORKER_URL.includes('YOUR-WORKER') && /^https:\/\//.test(WORKER_URL));
  }

  function hasApiConfig() {
    return Boolean(isWorkerUrlReady() && getAppKey());
  }

  function getAppKey() {
    return state.runtimeAppKey || '';
  }

  async function apiFetch(path, options = {}) {
    const url = `${WORKER_URL}${path}`;
    const headers = new Headers(options.headers || {});
    headers.set('Content-Type', 'application/json');
    headers.set('x-paper-log-key', getAppKey());
    return fetch(url, { ...options, headers });
  }

  async function exportJson() {
    const payload = {
      app: 'paper-log-local',
      version: 1,
      exportedAt: new Date().toISOString(),
      moneyRecords: state.moneyRecords,
      settings: { workerUrl: WORKER_URL, savedKey: Boolean(state.settings.encryptedAppKey) },
    };
    downloadText(`paper-log-backup-${dateKey(new Date())}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
    $('#backupStatus').textContent = 'JSON 백업 파일을 만들었어요.';
  }

  async function importJson(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const records = Array.isArray(data.moneyRecords) ? data.moneyRecords : [];
      if (!records.length) throw new Error('가져올 가계부 기록이 없어요.');
      const normalized = records.map(normalizeMoneyRecord).filter(Boolean);
      const replace = confirm(`가계부 ${normalized.length}건을 가져옵니다.\n확인을 누르면 기존 로컬 데이터를 모두 지우고 복원합니다.\n취소를 누르면 기존 데이터에 추가합니다.`);
      if (replace) await moneyDb.clear();
      await moneyDb.bulkPut(normalized);
      await loadMoney();
      renderAll();
      $('#backupStatus').textContent = `JSON 가져오기 완료 · ${normalized.length}건`;
    } catch (error) {
      $('#backupStatus').textContent = `가져오기 실패: ${error.message}`;
    }
  }

  function exportCsv(all) {
    const records = all ? state.moneyRecords : moneyRecordsInMonth(state.moneyMonth);
    const header = ['날짜','구분','내용','금액','분류','결제수단','낭비여부','메모'];
    const rows = records
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map(r => [r.date, r.type === 'income' ? '수입' : '지출', r.title, r.amount, r.category || '', r.payment || '', r.waste ? 'Y' : 'N', r.memo || '']);
    const csv = '\ufeff' + [header, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
    const suffix = all ? 'all' : monthKey(state.moneyMonth);
    downloadText(`money-log-${suffix}.csv`, csv, 'text/csv;charset=utf-8');
    $('#backupStatus').textContent = `${all ? '전체' : '현재 월'} CSV를 만들었어요.`;
  }

  async function clearMoneyData() {
    if (!confirm('가계부 로컬 데이터를 모두 삭제할까요? 이 작업은 되돌릴 수 없어요.')) return;
    await moneyDb.clear();
    await loadMoney();
    renderAll();
    $('#backupStatus').textContent = '가계부 로컬 데이터를 모두 삭제했어요.';
  }

  function normalizeMoneyRecord(record) {
    if (!record || !record.date || !record.title) return null;
    const now = new Date().toISOString();
    return {
      id: record.id || crypto.randomUUID(),
      type: record.type === 'income' ? 'income' : 'expense',
      date: String(record.date).slice(0, 10),
      title: String(record.title || '제목 없음'),
      amount: Number(record.amount || 0),
      category: String(record.category || ''),
      payment: String(record.payment || ''),
      memo: String(record.memo || ''),
      waste: Boolean(record.waste),
      createdAt: record.createdAt || now,
      updatedAt: record.updatedAt || now,
    };
  }

  function schedulesForDate(key) {
    return state.schedules.filter(item => item.date === key).sort(sortSchedule);
  }

  function sortSchedule(a, b) {
    return String(a.time || '99:99').localeCompare(String(b.time || '99:99')) || String(a.title).localeCompare(String(b.title));
  }

  function colorClass(item) {
    if (item.canceled) return 'canceled';
    const value = String(item.category || item.subject || '').toLowerCase();
    if (value.includes('업무') || value.includes('work')) return 'work';
    if (value.includes('약속') || value.includes('meeting')) return 'meeting';
    if (value.includes('교육') || value.includes('강의')) return 'education';
    if (value.includes('개인') || value.includes('personal')) return 'personal';
    return 'default';
  }

  function moneyRecordsInMonth(date) {
    const key = monthKey(date);
    return state.moneyRecords.filter(record => String(record.date || '').startsWith(key));
  }

  function summarizeMoney(records) {
    return records.reduce((acc, record) => {
      const amount = Number(record.amount || 0);
      if (record.type === 'income') acc.income += amount;
      else {
        acc.expense += amount;
        if (record.waste) acc.waste += amount;
      }
      return acc;
    }, { income: 0, expense: 0, waste: 0 });
  }

  function parseTags(value) {
    return String(value || '').split(/[,，\n]/).map(x => x.trim()).filter(Boolean);
  }

  function downloadText(filename, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function csvCell(value) {
    const s = String(value ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js').catch(console.warn);
  }

  function calendarGridRange(monthDate) {
    const start = gridStartMonday(monthDate);
    const end = addDays(start, 41);
    return { from: dateKey(start), to: dateKey(end) };
  }

  function gridStartMonday(monthDate) {
    const first = startOfMonth(monthDate);
    const offset = (first.getDay() + 6) % 7;
    return addDays(first, -offset);
  }

  function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
  function addDays(date, days) { const d = new Date(date); d.setDate(d.getDate() + days); return d; }
  function isWeekend(date) { const day = date.getDay(); return day === 0 || day === 6; }
  function toDate(key) { return new Date(`${key}T00:00:00+09:00`); }
  function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
  function monthKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
  function monthLabel(date) { return `${date.getFullYear()}년 ${date.getMonth() + 1}월`; }
  function formatKoreanDate(date) { return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`; }
  function won(value) { return Number(value || 0).toLocaleString('ko-KR'); }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
})();
