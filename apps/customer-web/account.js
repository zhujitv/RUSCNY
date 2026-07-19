(() => {
  'use strict';

  const storageKeys = {
    device: 'ruscny.web.device',
    session: 'ruscny.account.session',
  };
  const authForm = document.querySelector('#account-form');
  const authPanel = document.querySelector('#auth-panel');
  const sessionPanel = document.querySelector('#session-panel');
  const statusBox = document.querySelector('.form-status');
  const submitButton = document.querySelector('.auth-submit');
  const passwordInput = document.querySelector('#account-password');
  const confirmPasswordInput = document.querySelector('#confirm-password');
  const logoutButton = document.querySelector('#logout-button');
  let mode = 'register';
  let session = readSession();
  let refreshInFlight = null;

  const messages = {
    zh: {
      loading: '正在提交…', restoring: '正在恢复当前网页账号…', registered: '注册成功，账号已建立。', loggedIn: '登录成功。',
      requiredName: '请输入姓名或显示名称。', invalidEmail: '请输入有效邮箱。', invalidPassword: '密码必须为 8 至 128 位。', mismatch: '两次输入的密码不一致。', consent: '请先阅读并同意用户协议和隐私政策。',
      EMAIL_EXISTS: '该邮箱已注册，请直接登录。', INVALID_CREDENTIALS: '邮箱或密码错误。', RATE_LIMITED: '操作过于频繁，请稍后再试。', VALIDATION_ERROR: '填写内容不符合要求，请检查后重试。', ACCOUNT_DISABLED: '账号不存在或已停用。',
      network: '无法连接服务器，请检查网络后重试。', generic: '暂时无法完成操作，请稍后重试。', notSet: '未填写', chinese: '中文', russian: 'Русский', loggingOut: '正在退出…'
    },
    ru: {
      loading: 'Отправка…', restoring: 'Восстанавливаем вход…', registered: 'Регистрация завершена. Аккаунт создан.', loggedIn: 'Вход выполнен.',
      requiredName: 'Укажите имя или отображаемое имя.', invalidEmail: 'Введите корректный email.', invalidPassword: 'Пароль должен содержать от 8 до 128 символов.', mismatch: 'Пароли не совпадают.', consent: 'Сначала примите условия использования и политику конфиденциальности.',
      EMAIL_EXISTS: 'Этот email уже зарегистрирован. Выполните вход.', INVALID_CREDENTIALS: 'Неверный email или пароль.', RATE_LIMITED: 'Слишком много попыток. Повторите позже.', VALIDATION_ERROR: 'Проверьте заполненные данные и повторите попытку.', ACCOUNT_DISABLED: 'Аккаунт не найден или отключён.',
      network: 'Не удалось подключиться к серверу. Проверьте сеть.', generic: 'Не удалось выполнить операцию. Повторите позже.', notSet: 'Не указано', chinese: '中文', russian: 'Русский', loggingOut: 'Выход…'
    }
  };

  function currentMessages() {
    return messages[document.documentElement.lang === 'ru' ? 'ru' : 'zh'];
  }

  function storageGet(storage, key) {
    try { return storage.getItem(key); } catch (_) { return null; }
  }

  function storageSet(storage, key, value) {
    try { storage.setItem(key, value); return true; } catch (_) { return false; }
  }

  function storageRemove(storage, key) {
    try { storage.removeItem(key); } catch (_) { /* Storage is optional. */ }
  }

  function readSession() {
    const raw = storageGet(sessionStorage, storageKeys.session);
    if (!raw || raw.length > 20_000) return null;
    try {
      const value = JSON.parse(raw);
      if (!value || typeof value.accessToken !== 'string' || typeof value.refreshToken !== 'string' || typeof value.deviceId !== 'string') return null;
      return value;
    } catch (_) {
      return null;
    }
  }

  function storeSession(value) {
    session = value;
    storageSet(sessionStorage, storageKeys.session, JSON.stringify(value));
  }

  function clearSession() {
    session = null;
    storageRemove(sessionStorage, storageKeys.session);
  }

  function deviceId() {
    const stored = storageGet(localStorage, storageKeys.device);
    if (stored && stored.length >= 8 && stored.length <= 200) return stored;
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    const value = `web-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    storageSet(localStorage, storageKeys.device, value);
    return value;
  }

  function showStatus(message, error = false) {
    statusBox.textContent = message;
    statusBox.classList.toggle('error', error);
    statusBox.hidden = !message;
  }

  function setBusy(busy, message = '') {
    submitButton.disabled = busy;
    document.querySelectorAll('[data-auth-mode], [data-switch-mode]').forEach((button) => { button.disabled = busy; });
    if (message) showStatus(message);
  }

  function apiError(code) {
    const dictionary = currentMessages();
    return dictionary[code] || dictionary.generic;
  }

  async function apiRequest(path, options = {}) {
    let response;
    try {
      response = await fetch(path, {
        method: options.method || 'GET',
        headers: {
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch (_) {
      const error = new Error(currentMessages().network);
      error.code = 'NETWORK_ERROR';
      throw error;
    }
    let payload = null;
    try { payload = await response.json(); } catch (_) { /* A stable fallback is shown below. */ }
    if (!response.ok || !payload?.ok) {
      const error = new Error(apiError(payload?.code));
      error.code = payload?.code || 'REQUEST_FAILED';
      error.status = response.status;
      throw error;
    }
    return payload.data;
  }

  async function refreshSession() {
    if (refreshInFlight) return refreshInFlight;
    if (!session?.refreshToken || !session?.deviceId) throw new Error(currentMessages().generic);
    refreshInFlight = apiRequest('/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken: session.refreshToken, deviceId: session.deviceId },
    }).then((data) => {
      const next = { accessToken: data.accessToken, refreshToken: data.refreshToken, deviceId: session.deviceId, user: data.user };
      storeSession(next);
      return next;
    }).finally(() => { refreshInFlight = null; });
    return refreshInFlight;
  }

  async function authenticatedMe() {
    try {
      return await apiRequest('/v1/auth/me', { accessToken: session.accessToken });
    } catch (error) {
      if (error.status !== 401) throw error;
      const refreshed = await refreshSession();
      return apiRequest('/v1/auth/me', { accessToken: refreshed.accessToken });
    }
  }

  function setMode(nextMode) {
    mode = nextMode === 'login' ? 'login' : 'register';
    document.querySelectorAll('[data-mode-section]').forEach((element) => {
      element.hidden = element.dataset.modeSection !== mode;
    });
    document.querySelectorAll('[data-auth-mode]').forEach((button) => {
      const selected = button.dataset.authMode === mode;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    document.querySelector('#display-name').required = mode === 'register';
    confirmPasswordInput.required = mode === 'register';
    document.querySelector('#account-consent').required = mode === 'register';
    passwordInput.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    showStatus('');
    const url = new URL(globalThis.location.href);
    url.searchParams.set('mode', mode);
    globalThis.history.replaceState(null, '', `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
  }

  function formValue(name, trim = true) {
    const value = new FormData(authForm).get(name)?.toString() || '';
    return trim ? value.trim() : value;
  }

  function validateForm() {
    const dictionary = currentMessages();
    const email = formValue('email');
    const password = formValue('password', false);
    if (mode === 'register' && !formValue('displayName')) return dictionary.requiredName;
    if (!email || !document.querySelector('#account-email').validity.valid) return dictionary.invalidEmail;
    if (password.length < 8 || password.length > 128) return dictionary.invalidPassword;
    if (mode === 'register' && password !== formValue('confirmPassword', false)) return dictionary.mismatch;
    if (mode === 'register' && !document.querySelector('#account-consent').checked) return dictionary.consent;
    return '';
  }

  function renderProfile(user) {
    const dictionary = currentMessages();
    const values = {
      displayName: user?.displayName || dictionary.notSet,
      email: user?.email || dictionary.notSet,
      company: user?.company || dictionary.notSet,
      preferredLanguage: user?.preferredLanguage === 'ru' ? dictionary.russian : dictionary.chinese,
    };
    document.querySelectorAll('[data-profile]').forEach((element) => {
      element.textContent = values[element.dataset.profile] || dictionary.notSet;
    });
    authPanel.hidden = true;
    sessionPanel.hidden = false;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const validationError = validateForm();
    if (validationError) {
      showStatus(validationError, true);
      return;
    }
    setBusy(true, currentMessages().loading);
    const registration = mode === 'register';
    const body = {
      email: formValue('email').toLowerCase(),
      password: formValue('password', false),
      deviceId: deviceId(),
      platform: 'UNKNOWN',
      ...(registration ? {
        displayName: formValue('displayName'),
        ...(formValue('company') ? { company: formValue('company') } : {}),
        preferredLanguage: formValue('preferredLanguage'),
      } : {}),
    };
    try {
      const data = await apiRequest(registration ? '/v1/auth/register' : '/v1/auth/login', { method: 'POST', body });
      const nextSession = { accessToken: data.accessToken, refreshToken: data.refreshToken, deviceId: body.deviceId, user: data.user };
      storeSession(nextSession);
      authForm.reset();
      renderProfile(data.user);
      showStatus(registration ? currentMessages().registered : currentMessages().loggedIn);
    } catch (error) {
      showStatus(error.message || currentMessages().generic, true);
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!session) return;
    authPanel.hidden = false;
    showStatus(currentMessages().restoring);
    try {
      const user = await authenticatedMe();
      session.user = user;
      storeSession(session);
      renderProfile(user);
    } catch (_) {
      clearSession();
      sessionPanel.hidden = true;
      authPanel.hidden = false;
      showStatus('');
    }
  }

  async function logout() {
    const activeSession = session;
    const originalLabel = logoutButton.textContent;
    logoutButton.disabled = true;
    logoutButton.textContent = currentMessages().loggingOut;
    try {
      if (activeSession) {
        await apiRequest('/v1/auth/logout', {
          method: 'POST',
          accessToken: activeSession.accessToken,
          body: { refreshToken: activeSession.refreshToken },
        });
      }
    } catch (_) {
      // Local sign-out still wins when the network is unavailable.
    } finally {
      clearSession();
      sessionPanel.hidden = true;
      authPanel.hidden = false;
      logoutButton.disabled = false;
      logoutButton.textContent = originalLabel;
      setMode('login');
    }
  }

  document.querySelectorAll('[data-auth-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.authMode)));
  document.querySelectorAll('[data-switch-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.switchMode)));
  document.querySelectorAll('.locale-select').forEach((select) => select.addEventListener('change', () => {
    showStatus('');
    if (!sessionPanel.hidden && session?.user) renderProfile(session.user);
  }));
  authForm.addEventListener('submit', handleSubmit);
  logoutButton.addEventListener('click', logout);

  const requestedMode = new URL(globalThis.location.href).searchParams.get('mode');
  setMode(globalThis.location.pathname === '/login' || requestedMode === 'login' ? 'login' : 'register');
  restore();
})();
