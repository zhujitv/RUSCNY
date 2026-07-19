const copy = {
  zh: {
    title: '设置新密码', hint: '此一次性链接将在使用后立即失效，完成后所有设备需要重新登录。', password: '新密码', confirm: '确认新密码', submit: '确认重置',
    language: '语言', mismatch: '两次输入的密码不一致', missing: '链接无效，请让管理员重新签发', success: '密码已更新。请返回 App 使用新密码登录。', failed: '重置失败',
  },
  ru: {
    title: 'Новый пароль', hint: 'Одноразовая ссылка исчезнет после использования. На всех устройствах потребуется повторный вход.', password: 'Новый пароль', confirm: 'Подтвердите пароль', submit: 'Сбросить пароль',
    language: 'Язык', mismatch: 'Пароли не совпадают', missing: 'Ссылка недействительна. Попросите администратора выдать новую.', success: 'Пароль обновлён. Вернитесь в приложение и войдите с новым паролем.', failed: 'Не удалось сбросить пароль',
  },
};
let language = localStorage.getItem('translator.admin.language') || (navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'zh');
const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
const token = hash.get('token') || '';
history.replaceState({}, '', '/reset-password');

function applyLanguage() {
  document.documentElement.lang = language === 'ru' ? 'ru' : 'zh-CN';
  const values = copy[language];
  for (const [id, key] of [['title','title'],['hint','hint'],['passwordLabel','password'],['confirmLabel','confirm'],['submitButton','submit'],['languageLabel','language']]) {
    document.getElementById(id).textContent = values[key];
  }
  document.getElementById('languageSelect').value = language;
  if (!token) document.getElementById('result').textContent = values.missing;
}

document.getElementById('languageSelect').addEventListener('change', (event) => {
  language = event.target.value === 'ru' ? 'ru' : 'zh';
  localStorage.setItem('translator.admin.language', language);
  applyLanguage();
});

document.getElementById('resetForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = document.getElementById('result');
  const password = document.getElementById('newPassword').value;
  if (!token) { result.textContent = copy[language].missing; return; }
  if (password !== document.getElementById('confirmPassword').value) { result.textContent = copy[language].mismatch; return; }
  const button = document.getElementById('submitButton'); button.disabled = true; result.textContent = '';
  try {
    const response = await fetch('/v1/auth/password/reset', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, newPassword: password }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.message || copy[language].failed);
    document.getElementById('resetForm').classList.add('hidden');
    result.className = 'success-box'; result.textContent = copy[language].success;
  } catch (error) { result.textContent = error.message || copy[language].failed; button.disabled = false; }
});

applyLanguage();
