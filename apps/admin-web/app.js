const translations = {
  zh: {
    loginTitle: '服务器管理后台', loginHint: '请使用已授权的正式账号登录。管理员权限由服务器校验。',
    email: '邮箱', password: '密码', signIn: '登录管理后台', language: '语言', overview: '概览', users: '用户管理',
    meetings: '会议管理', audit: '审计记录', logout: '退出登录', systemOperations: '系统运营', refresh: '刷新', usage30: '最近 30 天',
    translationUsage: '翻译用量', recentErrors: '最近错误', failureOverview: '失败概览', nonDeleted: '未注销', active: '正常', disabled: '已停用',
    deleted: '已注销', search: '查询', searchUsers: '搜索姓名、公司、邮箱或电话', identity: '用户', adminPermission: '管理权限', status: '状态', lastSeen: '最近活动',
    devices: '设备', actions: '操作', searchMeetings: '搜索会议、主持人、客户或 ID', allStatuses: '全部状态', waiting: '等待中', inProgress: '进行中',
    ended: '已结束', expired: '已过期', meeting: '会议', host: '主持人', participants: '参会者', messages: '消息', immutableTrail: '不可变更记录',
    privilegedActions: '管理操作记录', time: '时间', operator: '操作人', action: '动作', target: '对象', details: '详情', oneTimeReset: '一次性密码重置',
    resetWarning: '该链接只显示一次。请通过受信渠道发送给用户，切勿写入工单或聊天群。', resetLink: '重置链接', copyLink: '复制链接', close: '关闭',
    totalUsers: '用户总数', activeMeetings: '活跃会议', onlineNow: '当前在线', failedTranslations: '翻译失败', activeAccounts: '正常账号', newToday: '24 小时新增',
    allMeetings: '全部会议', processing: '处理中', noData: '暂无数据', finalMessages: '完成消息', providers: '服务商', sourceLanguages: '原文语言',
    newUsers: '新增用户', newMeetings: '新增会议', previous: '上一页', next: '下一页', pageOf: '第 {page} / {total} 页', online: '在线', offline: '离线',
    admin: '系统管理员', regularUser: '普通用户', enable: '启用', disable: '停用', revoke: '强制退出', reset: '重置密码',
    view: '查看', endMeeting: '结束会议', confirmDisable: '确定立即停用该账号并撤销所有会话吗？', confirmEnable: '确定启用该账号吗？',
    confirmRevoke: '确定让该用户的所有设备立即退出吗？', confirmReset: '确定签发新的一次性密码重置链接吗？', confirmEnd: '确定立即结束该会议吗？所有参会者将无法继续发言。',
    operationDone: '操作已完成', linkCopied: '链接已复制', loginFailed: '登录失败', adminRequired: '该账号没有服务器管理员权限',
    networkError: '网络请求失败', sessionExpired: '登录已失效，请重新登录', participantsList: '参会人员', createdAt: '创建时间', expiresAt: '过期时间', company: '公司', languageShort: '语言',
  },
  ru: {
    loginTitle: 'Панель управления сервером', loginHint: 'Войдите с разрешённой учётной записью. Права администратора проверяет сервер.',
    email: 'Email', password: 'Пароль', signIn: 'Войти', language: 'Язык', overview: 'Обзор', users: 'Пользователи', meetings: 'Конференции',
    audit: 'Аудит', logout: 'Выйти', systemOperations: 'Системные операции', refresh: 'Обновить', usage30: 'Последние 30 дней', translationUsage: 'Объём перевода',
    recentErrors: 'Недавние ошибки', failureOverview: 'Обзор сбоев', nonDeleted: 'Не удалены', active: 'Активен', disabled: 'Отключён', deleted: 'Удалён',
    search: 'Найти', searchUsers: 'Имя, компания, email или телефон', identity: 'Пользователь', adminPermission: 'Права управления', status: 'Статус', lastSeen: 'Последняя активность',
    devices: 'Устройства', actions: 'Действия', searchMeetings: 'Конференция, ведущий, клиент или ID', allStatuses: 'Все статусы', waiting: 'Ожидание', inProgress: 'Идёт',
    ended: 'Завершена', expired: 'Истекла', meeting: 'Конференция', host: 'Ведущий', participants: 'Участники', messages: 'Сообщения', immutableTrail: 'Неизменяемый журнал',
    privilegedActions: 'Административные действия', time: 'Время', operator: 'Оператор', action: 'Действие', target: 'Объект', details: 'Детали', oneTimeReset: 'Одноразовый сброс пароля',
    resetWarning: 'Ссылка показывается один раз. Передайте её по доверенному каналу.', resetLink: 'Ссылка сброса', copyLink: 'Копировать', close: 'Закрыть',
    totalUsers: 'Всего пользователей', activeMeetings: 'Активные встречи', onlineNow: 'Сейчас онлайн', failedTranslations: 'Ошибки перевода', activeAccounts: 'Активные учётные записи',
    newToday: 'Новые за 24 часа', allMeetings: 'Все конференции', processing: 'В обработке', noData: 'Нет данных', finalMessages: 'Готовые сообщения', providers: 'Провайдеры',
    sourceLanguages: 'Языки исходного текста', newUsers: 'Новые пользователи', newMeetings: 'Новые конференции', previous: 'Назад', next: 'Далее', pageOf: 'Стр. {page} / {total}', online: 'Онлайн', offline: 'Офлайн',
    admin: 'Системный администратор', regularUser: 'Обычный пользователь', enable: 'Включить', disable: 'Отключить', revoke: 'Завершить сессии', reset: 'Сбросить пароль',
    view: 'Открыть', endMeeting: 'Завершить', confirmDisable: 'Отключить учётную запись и завершить все сессии?', confirmEnable: 'Включить учётную запись?',
    confirmRevoke: 'Немедленно завершить все сесии этого пользователя?', confirmReset: 'Выдать новую одноразовую ссылку сброса?', confirmEnd: 'Завершить конференцию? Участники больше не смогут говорить.',
    operationDone: 'Операция выполнена', linkCopied: 'Ссылка скопирована', loginFailed: 'Не удалось войти', adminRequired: 'Нет прав системного администратора',
    networkError: 'Сбой сетевого запроса', sessionExpired: 'Сессия истекла. Войдите снова.', participantsList: 'Список участников', createdAt: 'Создана', expiresAt: 'Истекает', company: 'Компания', languageShort: 'Язык',
  },
};

const $ = (selector) => document.querySelector(selector);
const state = {
  language: localStorage.getItem('translator.admin.language') || (navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'zh'),
  view: 'overview',
  admin: null,
  usersPage: 1,
  conversationsPage: 1,
  auditPage: 1,
};
const tokenKeys = { access: 'translator.admin.access', refresh: 'translator.admin.refresh' };

function t(key, values = {}) {
  let value = translations[state.language]?.[key] || translations.zh[key] || key;
  for (const [name, replacement] of Object.entries(values)) value = value.replace(`{${name}}`, String(replacement));
  return value;
}

function applyLanguage() {
  document.documentElement.lang = state.language === 'ru' ? 'ru' : 'zh-CN';
  document.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => { node.placeholder = t(node.dataset.i18nPlaceholder); });
  document.querySelectorAll('.languageSelect').forEach((select) => { select.value = state.language; });
  $('#pageTitle').textContent = t(state.view === 'conversations' ? 'meetings' : state.view);
}

function setLanguage(language) {
  state.language = language === 'ru' ? 'ru' : 'zh';
  localStorage.setItem('translator.admin.language', state.language);
  applyLanguage();
  if (!$('#consoleView').classList.contains('hidden')) void loadCurrentView();
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(state.language === 'ru' ? 'ru-RU' : 'zh-CN', {
    dateStyle: 'short', timeStyle: 'short',
  }).format(date);
}

function stored(key) { return sessionStorage.getItem(key); }
function clearCredentials() { sessionStorage.removeItem(tokenKeys.access); sessionStorage.removeItem(tokenKeys.refresh); }
function deviceId() {
  const key = 'translator.admin.device';
  let id = localStorage.getItem(key);
  if (!id) {
    id = `admin-web-${crypto.randomUUID()}`;
    localStorage.setItem(key, id);
  }
  return id;
}

let refreshInFlight = null;
let terminalAuthFailureHandled = false;

function refreshSession() {
  if (refreshInFlight) return refreshInFlight;
  const request = performRefresh().finally(() => {
    if (refreshInFlight === request) refreshInFlight = null;
  });
  refreshInFlight = request;
  return request;
}

async function performRefresh() {
  const refreshToken = stored(tokenKeys.refresh);
  if (!refreshToken) {
    clearCredentials();
    return false;
  }
  const response = await fetch('/v1/auth/refresh', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken, deviceId: deviceId() }),
  });
  if (!response.ok) {
    clearCredentials();
    return false;
  }
  let result;
  try { result = await response.json(); } catch { result = null; }
  if (
    result?.ok !== true ||
    typeof result.data?.accessToken !== 'string' || !result.data.accessToken ||
    typeof result.data?.refreshToken !== 'string' || !result.data.refreshToken
  ) {
    clearCredentials();
    return false;
  }
  sessionStorage.setItem(tokenKeys.access, result.data.accessToken);
  sessionStorage.setItem(tokenKeys.refresh, result.data.refreshToken);
  terminalAuthFailureHandled = false;
  return true;
}

async function api(path, options = {}, allowRefresh = true) {
  const headers = new Headers(options.headers || {});
  const token = stored(tokenKeys.access);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body !== undefined && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  let response;
  try {
    response = await fetch(path, { ...options, headers, body: options.body === undefined || options.body instanceof FormData ? options.body : JSON.stringify(options.body) });
  } catch {
    throw new Error(t('networkError'));
  }
  if (response.status === 401 && allowRefresh && await refreshSession()) return api(path, options, false);
  let result;
  try { result = await response.json(); } catch { result = { ok: false, message: response.statusText }; }
  if (!response.ok || !result.ok) {
    const error = new Error(result.message || `${response.status}`);
    error.code = result.code;
    error.status = response.status;
    if (response.status === 401 || (response.status === 403 && error.code === 'SYSTEM_ADMIN_REQUIRED')) {
      handleAdminAuthFailure(error);
    }
    throw error;
  }
  return result.data;
}

let toastTimer;
function toast(message, error = false) {
  const node = $('#toast');
  node.textContent = message;
  node.className = `toast${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.add('hidden'), 3800);
}

function showLogin(message = '') {
  state.admin = null;
  $('#consoleView').classList.add('hidden');
  $('#loginView').classList.remove('hidden');
  $('#loginStatus').textContent = message;
  $('#loginPassword').value = '';
}

function handleAdminAuthFailure(error) {
  // Concurrent API calls share one refresh. Only the first terminal auth
  // failure transitions the visible console; later failures are marked as
  // handled so they cannot overwrite the login page with duplicate toasts.
  clearCredentials();
  error.authHandled = true;
  if (terminalAuthFailureHandled) return;
  terminalAuthFailureHandled = true;
  showLogin(error.code === 'SYSTEM_ADMIN_REQUIRED' ? t('adminRequired') : t('sessionExpired'));
}

function showConsole(admin) {
  terminalAuthFailureHandled = false;
  state.admin = admin;
  $('#loginView').classList.add('hidden');
  $('#consoleView').classList.remove('hidden');
  const box = $('#adminIdentity');
  box.replaceChildren(element('strong', '', admin.displayName), element('span', '', admin.email || ''));
  applyLanguage();
  void loadCurrentView();
}

async function authenticateConsole() {
  if (!stored(tokenKeys.access) && !stored(tokenKeys.refresh)) return showLogin();
  try { showConsole(await api('/v1/admin/me')); }
  catch (error) {
    if (error.authHandled) return;
    clearCredentials();
    showLogin(error.code === 'SYSTEM_ADMIN_REQUIRED' ? t('adminRequired') : error.message);
  }
}

function metricCard(label, value, note, alert = false) {
  const card = element('article', `metric-card${alert ? ' alert' : ''}`);
  card.append(element('div', 'metric-label', label), element('div', 'metric-value', value), element('div', 'metric-note', note));
  return card;
}

function listRow(label, value, kind = 'usage') {
  const row = element('div', `${kind}-row`);
  row.append(element('span', '', label), element('strong', '', value));
  return row;
}

async function loadOverview() {
  const [overview, metrics] = await Promise.all([api('/v1/admin/overview'), api('/v1/admin/metrics?days=30')]);
  $('#overviewCards').replaceChildren(
    metricCard(t('totalUsers'), overview.users.total, `${t('activeAccounts')}: ${overview.users.active} · ${t('newToday')}: ${overview.users.new24h}`),
    metricCard(t('activeMeetings'), overview.conversations.active, `${t('allMeetings')}: ${overview.conversations.total} · ${t('waiting')}: ${overview.conversations.waiting}`),
    metricCard(t('onlineNow'), overview.participants.online, `${t('processing')}: ${overview.messages.processing}`),
    metricCard(t('failedTranslations'), overview.messages.failed, `${t('messages')}: ${overview.messages.total}`, overview.messages.failed > 0),
  );
  const usage = $('#usageMetrics');
  const finalCount = metrics.messages.byStatus.find((item) => item.status === 'FINAL')?.count || 0;
  usage.replaceChildren(
    listRow(t('finalMessages'), finalCount),
    listRow(t('newUsers'), metrics.newUsers),
    listRow(t('newMeetings'), metrics.newConversations),
    ...metrics.messages.byProvider.map((item) => listRow(`${t('providers')} · ${item.provider || '—'}`, item.count)),
    ...metrics.messages.bySourceLanguage.map((item) => listRow(`${t('sourceLanguages')} · ${item.sourceLanguage}`, item.count)),
  );
  const errors = $('#errorMetrics');
  const rows = metrics.errors.byCode.map((item) => listRow(item.errorCode || 'UNKNOWN', item.count, 'error'));
  errors.replaceChildren(...(rows.length ? rows : [element('div', 'empty', t('noData'))]));
}

function badge(value, extra = '') {
  const labels = { ACTIVE: t('active'), DISABLED: t('disabled'), DELETED: t('deleted'), WAITING: t('waiting'), ENDED: t('ended'), EXPIRED: t('expired') };
  return element('span', `badge ${String(value).toLowerCase()} ${extra}`, labels[value] || value);
}

function actionButton(label, action, id, danger = false) {
  const button = element('button', danger ? 'danger' : 'ghost', label);
  button.type = 'button'; button.dataset.action = action; button.dataset.id = id;
  return button;
}

function identityCell(title, subtitle, id) {
  const cell = element('td', 'identity-cell');
  cell.append(element('strong', '', title || '—'), element('span', '', subtitle || '—'));
  if (id) cell.append(element('span', 'mono', id));
  return cell;
}

function renderPagination(container, payload, kind) {
  const previous = actionButton(t('previous'), `${kind}-page`, String(payload.page - 1));
  previous.disabled = payload.page <= 1;
  const next = actionButton(t('next'), `${kind}-page`, String(payload.page + 1));
  next.disabled = payload.page >= Math.max(1, payload.totalPages);
  container.replaceChildren(previous, element('span', '', t('pageOf', { page: payload.page, total: Math.max(1, payload.totalPages) })), next);
}

async function loadUsers() {
  const query = new URLSearchParams({ page: String(state.usersPage), pageSize: '25' });
  const q = $('#userSearch').value.trim(); const status = $('#userStatus').value;
  if (q) query.set('q', q); if (status) query.set('status', status);
  const data = await api(`/v1/admin/users?${query}`);
  const body = $('#usersBody'); body.replaceChildren();
  for (const user of data.items) {
    const row = element('tr');
    row.append(identityCell(user.displayName, [user.company, user.email].filter(Boolean).join(' · '), user.id));
    const permission = element('td'); permission.append(badge(user.isSystemAdmin ? t('admin') : t('regularUser'))); row.append(permission);
    const statusCell = element('td'); statusCell.append(badge(user.status), document.createTextNode(' '), badge(user.online ? t('online') : t('offline'), user.online ? 'online' : '')); row.append(statusCell);
    row.append(element('td', '', formatDate(user.lastSeenAt)), element('td', '', String(user.activeDeviceCount)));
    const actions = element('td', 'actions');
    if (user.status !== 'DELETED') {
      if (user.status === 'ACTIVE' && !user.isSystemAdmin && user.id !== state.admin.id) actions.append(actionButton(t('disable'), 'disable-user', user.id, true));
      if (user.status === 'DISABLED') actions.append(actionButton(t('enable'), 'enable-user', user.id));
      actions.append(actionButton(t('revoke'), 'revoke-user', user.id), actionButton(t('reset'), 'reset-user', user.id));
    }
    row.append(actions); body.append(row);
  }
  if (!data.items.length) { const row = element('tr'); const cell = element('td', 'empty', t('noData')); cell.colSpan = 6; row.append(cell); body.append(row); }
  renderPagination($('#usersPagination'), data, 'users');
}

async function loadConversations() {
  const query = new URLSearchParams({ page: String(state.conversationsPage), pageSize: '25' });
  const q = $('#conversationSearch').value.trim(); const status = $('#conversationStatus').value;
  if (q) query.set('q', q); if (status) query.set('status', status);
  const data = await api(`/v1/admin/conversations?${query}`);
  const body = $('#conversationsBody'); body.replaceChildren();
  for (const meeting of data.items) {
    const row = element('tr');
    row.append(identityCell(meeting.title || meeting.contact?.displayName || '—', formatDate(meeting.createdAt), meeting.id));
    row.append(identityCell(meeting.owner?.displayName, meeting.owner?.email));
    const statusCell = element('td'); statusCell.append(badge(meeting.status)); row.append(statusCell);
    row.append(element('td', '', meeting.participantCount), element('td', '', meeting.messageCount));
    const actions = element('td', 'actions'); actions.append(actionButton(t('view'), 'view-meeting', meeting.id));
    if (meeting.status === 'ACTIVE' || meeting.status === 'WAITING') actions.append(actionButton(t('endMeeting'), 'end-meeting', meeting.id, true));
    row.append(actions); body.append(row);
  }
  if (!data.items.length) { const row = element('tr'); const cell = element('td', 'empty', t('noData')); cell.colSpan = 6; row.append(cell); body.append(row); }
  renderPagination($('#conversationsPagination'), data, 'conversations');
}

async function loadAudit() {
  const data = await api(`/v1/admin/audit-logs?page=${state.auditPage}&pageSize=25`);
  const body = $('#auditBody'); body.replaceChildren();
  for (const log of data.items) {
    const row = element('tr');
    row.append(element('td', '', formatDate(log.createdAt)), identityCell(log.actor?.displayName, log.actor?.email));
    row.append(element('td', 'mono', log.action), element('td', 'mono', `${log.targetType}${log.targetId ? ` · ${log.targetId}` : ''}`), element('td', 'mono', JSON.stringify(log.metadata || {})));
    body.append(row);
  }
  if (!data.items.length) { const row = element('tr'); const cell = element('td', 'empty', t('noData')); cell.colSpan = 5; row.append(cell); body.append(row); }
  renderPagination($('#auditPagination'), data, 'audit');
}

async function loadCurrentView() {
  try {
    if (state.view === 'overview') await loadOverview();
    if (state.view === 'users') await loadUsers();
    if (state.view === 'conversations') await loadConversations();
    if (state.view === 'audit') await loadAudit();
  } catch (error) {
    if (error.authHandled) return;
    if (error.status === 401 || error.code === 'SYSTEM_ADMIN_REQUIRED') { handleAdminAuthFailure(error); return; }
    toast(error.message, true);
  }
}

function selectView(view) {
  state.view = view;
  document.querySelectorAll('.nav-button').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  document.querySelectorAll('.view-panel').forEach((panel) => panel.classList.toggle('hidden', panel.id !== `view-${view}`));
  $('#pageTitle').textContent = t(view === 'conversations' ? 'meetings' : view);
  void loadCurrentView();
}

async function updateUserStatus(id, status) {
  const question = status === 'DISABLED' ? t('confirmDisable') : t('confirmEnable');
  if (!confirm(question)) return;
  await api(`/v1/admin/users/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: { status } });
  toast(t('operationDone')); await loadUsers();
}

async function revokeUser(id) {
  if (!confirm(t('confirmRevoke'))) return;
  await api(`/v1/admin/users/${encodeURIComponent(id)}/revoke-sessions`, { method: 'POST', body: {} });
  toast(t('operationDone')); await loadUsers();
}

async function resetUser(id) {
  if (!confirm(t('confirmReset'))) return;
  const data = await api(`/v1/admin/users/${encodeURIComponent(id)}/password-reset`, { method: 'POST', body: {} });
  $('#resetUrl').value = data.resetUrl;
  $('#resetDialog').showModal();
}

function detailItem(label, value) {
  const item = element('div', 'detail-item'); item.append(element('span', '', label), element('strong', '', value ?? '—')); return item;
}

async function viewMeeting(id) {
  const data = await api(`/v1/admin/conversations/${encodeURIComponent(id)}`);
  $('#dialogTitle').textContent = data.title || data.contact?.displayName || data.id;
  const content = $('#dialogContent');
  const grid = element('div', 'detail-grid');
  grid.append(
    detailItem('ID', data.id), detailItem(t('status'), data.status), detailItem(t('host'), data.owner?.displayName),
    detailItem(t('messages'), data.messageCount), detailItem(t('createdAt'), formatDate(data.createdAt)), detailItem(t('expiresAt'), formatDate(data.expiresAt)),
  );
  const heading = element('h3', '', t('participantsList'));
  const roster = element('div', 'roster');
  for (const participant of data.participants) {
    const row = element('div', 'roster-row');
    row.append(element('span', '', `${participant.displayName}${participant.company ? ` · ${participant.company}` : ''}`), element('span', '', `${participant.preferredLanguage} · ${participant.presence}`));
    roster.append(row);
  }
  content.replaceChildren(grid, heading, roster);
  $('#detailDialog').showModal();
}

async function endMeeting(id) {
  if (!confirm(t('confirmEnd'))) return;
  await api(`/v1/admin/conversations/${encodeURIComponent(id)}/end`, { method: 'POST', body: {} });
  toast(t('operationDone')); await loadConversations();
}

document.querySelectorAll('.languageSelect').forEach((select) => select.addEventListener('change', (event) => setLanguage(event.target.value)));
$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault(); $('#loginStatus').textContent = '';
  const submit = event.submitter; if (submit) submit.disabled = true;
  try {
    const response = await fetch('/v1/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('#loginEmail').value.trim(), password: $('#loginPassword').value, deviceId: deviceId(), platform: 'UNKNOWN' }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.message || t('loginFailed'));
    sessionStorage.setItem(tokenKeys.access, result.data.accessToken);
    sessionStorage.setItem(tokenKeys.refresh, result.data.refreshToken);
    terminalAuthFailureHandled = false;
    const admin = await api('/v1/admin/me'); showConsole(admin);
  } catch (error) {
    if (!error.authHandled) {
      clearCredentials();
      $('#loginStatus').textContent = error.code === 'SYSTEM_ADMIN_REQUIRED' ? t('adminRequired') : error.message;
    }
  } finally { if (submit) submit.disabled = false; }
});

$('#logoutButton').addEventListener('click', async () => {
  const refreshToken = stored(tokenKeys.refresh);
  try { await api('/v1/auth/logout', { method: 'POST', body: { refreshToken } }, false); } catch { /* local logout remains deterministic */ }
  clearCredentials(); terminalAuthFailureHandled = true; showLogin();
});
$('#refreshButton').addEventListener('click', () => void loadCurrentView());
$('#nav').addEventListener('click', (event) => { const button = event.target.closest('[data-view]'); if (button) selectView(button.dataset.view); });
$('#userFilters').addEventListener('submit', (event) => { event.preventDefault(); state.usersPage = 1; void loadCurrentView(); });
$('#conversationFilters').addEventListener('submit', (event) => { event.preventDefault(); state.conversationsPage = 1; void loadCurrentView(); });

document.body.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  try {
    const id = button.dataset.id; const action = button.dataset.action;
    if (action === 'disable-user') await updateUserStatus(id, 'DISABLED');
    if (action === 'enable-user') await updateUserStatus(id, 'ACTIVE');
    if (action === 'revoke-user') await revokeUser(id);
    if (action === 'reset-user') await resetUser(id);
    if (action === 'view-meeting') await viewMeeting(id);
    if (action === 'end-meeting') await endMeeting(id);
    if (action === 'users-page') { state.usersPage = Number(id); await loadUsers(); }
    if (action === 'conversations-page') { state.conversationsPage = Number(id); await loadConversations(); }
    if (action === 'audit-page') { state.auditPage = Number(id); await loadAudit(); }
  } catch (error) { if (!error.authHandled) toast(error.message, true); }
});

$('#copyResetUrl').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#resetUrl').value); toast(t('linkCopied')); }
  catch { $('#resetUrl').select(); document.execCommand('copy'); toast(t('linkCopied')); }
});

applyLanguage();
void authenticateConsole();
