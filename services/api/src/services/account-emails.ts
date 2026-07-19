import { config } from '../config.js';
import { secretHash } from '../lib/crypto.js';
import { sendTransactionalEmail } from './email-provider.js';

const EMAIL_VERIFICATION_CONTEXT = 'email-verification-v1:';
const PASSWORD_RESET_CONTEXT = 'user-password-reset-v1:';

export function emailVerificationTokenHash(token: string): string {
  return secretHash(`${EMAIL_VERIFICATION_CONTEXT}${token}`, config.PASSWORD_PEPPER);
}

export function userPasswordResetTokenHash(token: string): string {
  return secretHash(`${PASSWORD_RESET_CONTEXT}${token}`, config.PASSWORD_PEPPER);
}

export function emailHint(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(3, Math.min(8, local.length - visible.length)))}@${domain}`;
}

export async function sendAccountVerificationEmail(input: {
  to: string;
  displayName: string;
  token: string;
  tokenId: string;
  expiresAt: Date;
}): Promise<void> {
  const activationUrl = `${config.PUBLIC_APP_URL.replace(/\/$/, '')}/account?mode=verify#token=${encodeURIComponent(input.token)}`;
  const name = input.displayName.trim() || 'RUSCNY user';
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(activationUrl);
  const expires = input.expiresAt.toISOString();
  await sendTransactionalEmail({
    to: input.to,
    subject: '激活您的 RUSCNY 账号 / Подтвердите email',
    idempotencyKey: `account-verification-${input.tokenId}`,
    text: [
      `${name}，您好：`,
      '',
      '请打开以下链接激活 RUSCNY 账号：',
      activationUrl,
      `链接将在 ${expires} 前有效，且只能使用一次。若并非您本人注册，请忽略本邮件。`,
      '',
      `${name},`,
      '',
      'Откройте ссылку ниже, чтобы подтвердить email и активировать аккаунт RUSCNY:',
      activationUrl,
      `Ссылка действует до ${expires} и может быть использована только один раз.`,
    ].join('\n'),
    html: `<!doctype html><html><body style="margin:0;background:#f2f7f4;color:#163c33;font-family:Arial,sans-serif"><div style="max-width:620px;margin:0 auto;padding:32px 20px"><div style="background:#fff;border:1px solid #d8e5de;border-radius:20px;padding:32px"><p style="margin:0 0 18px;font-size:13px;letter-spacing:.14em;color:#39725f">RUSCNY</p><h1 style="margin:0 0 16px;font-size:25px">激活账号 · Подтвердите email</h1><p>${safeName}，您好。请确认此邮箱属于您，以启用登录和会议功能。</p><p>${safeName}, подтвердите адрес электронной почты, чтобы активировать вход и функции конференций.</p><p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;padding:13px 22px;border-radius:10px;background:#114d40;color:#fff;text-decoration:none;font-weight:700">激活账号 / Подтвердить</a></p><p style="font-size:12px;line-height:1.7;color:#6e7d76">链接只能使用一次，并将在 ${escapeHtml(expires)} 前失效。若并非您本人注册，请忽略本邮件。<br>Ссылка одноразовая и действует до ${escapeHtml(expires)}.</p></div></div></body></html>`,
  });
}

export async function sendAccountPasswordResetEmail(input: {
  to: string;
  displayName: string;
  token: string;
  tokenId: string;
  expiresAt: Date;
}): Promise<void> {
  const resetUrl = `${config.PUBLIC_APP_URL.replace(/\/$/, '')}/account?mode=reset#token=${encodeURIComponent(input.token)}`;
  const name = input.displayName.trim() || 'RUSCNY user';
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(resetUrl);
  const expires = input.expiresAt.toISOString();
  await sendTransactionalEmail({
    to: input.to,
    subject: '重置您的 RUSCNY 密码 / Сброс пароля',
    idempotencyKey: `account-password-reset-${input.tokenId}`,
    text: [
      `${name}，您好：`,
      '',
      '请打开以下链接设置新的 RUSCNY 密码：',
      resetUrl,
      `链接将在 ${expires} 前有效，且只能使用一次。重置后所有设备需要重新登录。`,
      '如果您没有申请重置密码，请忽略本邮件，原密码不会改变。',
      '',
      `${name},`,
      '',
      'Откройте ссылку ниже, чтобы установить новый пароль RUSCNY:',
      resetUrl,
      `Ссылка действует до ${expires} и может быть использована только один раз. После сброса потребуется повторный вход на всех устройствах.`,
    ].join('\n'),
    html: `<!doctype html><html><body style="margin:0;background:#f2f7f4;color:#163c33;font-family:Arial,sans-serif"><div style="max-width:620px;margin:0 auto;padding:32px 20px"><div style="background:#fff;border:1px solid #d8e5de;border-radius:20px;padding:32px"><p style="margin:0 0 18px;font-size:13px;letter-spacing:.14em;color:#39725f">RUSCNY</p><h1 style="margin:0 0 16px;font-size:25px">重置密码 · Сброс пароля</h1><p>${safeName}，您好。点击按钮设置新密码；完成后，所有已登录设备都会下线。</p><p>${safeName}, установите новый пароль. После завершения все активные сеансы будут завершены.</p><p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;padding:13px 22px;border-radius:10px;background:#114d40;color:#fff;text-decoration:none;font-weight:700">设置新密码 / Новый пароль</a></p><p style="font-size:12px;line-height:1.7;color:#6e7d76">链接只能使用一次，并将在 ${escapeHtml(expires)} 前失效。若您未申请重置，请忽略本邮件。<br>Ссылка одноразовая и действует до ${escapeHtml(expires)}.</p></div></div></body></html>`,
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}
