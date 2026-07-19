import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const directory = new URL('./', import.meta.url);
const pageNames = ['index.html', 'account.html', 'privacy.html', 'terms.html', 'unavailable.html'];

async function translations() {
  const source = await readFile(new URL('app.js', directory), 'utf8');
  const context = {
    document: {
      body: { dataset: {} },
      documentElement: {},
      querySelectorAll: () => [],
      querySelector: () => null,
    },
    localStorage: { getItem: () => null, setItem: () => undefined },
    navigator: { language: 'zh-CN' },
    globalThis: {},
  };
  vm.runInNewContext(`${source}\n;globalThis.translations = translations;`, context);
  return context.globalThis.translations;
}

test('every customer website string exists in Chinese and Russian', async () => {
  const dictionaries = await translations();
  const required = new Set();
  for (const name of pageNames) {
    const html = await readFile(new URL(name, directory), 'utf8');
    for (const match of html.matchAll(/data-i18n="([A-Za-z0-9]+)"/g)) required.add(match[1]);
  }

  assert.ok(required.size > 70);
  for (const locale of ['zh', 'ru']) {
    for (const key of required) {
      assert.equal(typeof dictionaries[locale][key], 'string', `${locale}.${key} is missing`);
      assert.ok(dictionaries[locale][key].trim(), `${locale}.${key} is empty`);
    }
  }
});

test('public pages keep customer navigation separate from administration', async () => {
  const home = await readFile(new URL('index.html', directory), 'utf8');
  assert.match(home, /href="\/join"/);
  assert.match(home, /href="\/account"/);
  assert.match(home, /href="\/privacy"/);
  assert.match(home, /href="\/terms"/);
  assert.doesNotMatch(home, /href="\/admin/);
  assert.doesNotMatch(home, /http:\/\//);
});

test('account page submits the complete registered-user profile to same-origin auth APIs', async () => {
  const [page, source] = await Promise.all([
    readFile(new URL('account.html', directory), 'utf8'),
    readFile(new URL('account.js', directory), 'utf8'),
  ]);

  for (const field of ['displayName', 'company', 'preferredLanguage', 'email', 'password']) {
    assert.match(page, new RegExp(`name="${field}"`), `${field} field is missing`);
  }
  assert.match(page, /href="\/terms"/);
  assert.match(page, /href="\/privacy"/);
  assert.doesNotMatch(page, /name="role"|账号类型|Тип аккаунта/);
  assert.match(source, /'\/v1\/auth\/register'/);
  assert.match(source, /'\/v1\/auth\/login'/);
  assert.match(source, /'\/v1\/auth\/refresh'/);
  assert.match(source, /'\/v1\/auth\/logout'/);
  assert.match(source, /SERVICE_PREPARING/);
  assert.match(source, /storageSet\(sessionStorage, storageKeys\.session/);
  assert.match(source, /storageSet\(localStorage, storageKeys\.device/);
});

test('account client keeps bearer credentials out of persistent storage and unsafe DOM sinks', async () => {
  const source = await readFile(new URL('account.js', directory), 'utf8');

  assert.doesNotMatch(source, /storageSet\(localStorage,\s*storageKeys\.session/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|eval\s*\(/);
  assert.doesNotMatch(source, /console\.(?:log|info|debug|error)/);
  assert.match(source, /element\.textContent = values/);
});

test('social preview has the expected link-unfurl dimensions', async () => {
  const image = await readFile(new URL('og.png', directory));
  assert.equal(image.toString('ascii', 1, 4), 'PNG');
  assert.equal(image.readUInt32BE(16), 1200);
  assert.equal(image.readUInt32BE(20), 630);
});

test('mobile layout uses fluid widths for large visual modules', async () => {
  const styles = await readFile(new URL('styles.css', directory), 'utf8');
  const mobile = styles.match(/@media \(max-width: 680px\) \{([\s\S]*?)\n\}\n\n@media \(prefers-reduced-motion/);

  assert.ok(mobile, 'mobile breakpoint is missing');
  assert.doesNotMatch(mobile[1], /\.product-window\s*\{[^}]*width:\s*580px/);
  assert.doesNotMatch(mobile[1], /\.language-bridge\s*\{[^}]*width:\s*720px/);
  assert.match(mobile[1], /\.product-window\s*\{[^}]*width:100%/);
  assert.match(mobile[1], /\.language-bridge\s*\{[^}]*width:100%/);
  assert.match(mobile[1], /\.final-actions\s*\{[^}]*grid-template-columns:1fr/);
});
