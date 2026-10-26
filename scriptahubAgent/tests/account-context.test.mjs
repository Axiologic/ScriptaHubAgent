import test from 'node:test';
import assert from 'node:assert/strict';
import { accountLogoutPath } from '../site/assets/account-context.js';

test('logout retains application identity and separates public return from cancel destination', () => {
  for (const origin of ['https://library.example', 'http://192.0.2.1:8093']) {
    const root = `${origin}/base-agent-additional-server/library/3210/`;
    const page = root + 'account/index.html?lang=ro';
    const logout = new URL(accountLogoutPath(root, page), origin);
    assert.equal(logout.pathname, '/auth/logout');
    assert.equal(logout.searchParams.get('agent'), 'library');
    assert.equal(logout.searchParams.get('returnTo'), '/base-agent-additional-server/library/3210/?lang=ro');
    assert.equal(logout.searchParams.get('cancelTo'), '/base-agent-additional-server/library/3210/account/index.html?lang=ro');
    assert.equal(logout.origin, origin);
  }
});

test('dedicated hosts and custom prefixes do not invent an agent selector or foreign redirect', () => {
  const logout = new URL(accountLogoutPath('https://books.example/library/', 'https://books.example/library/account/?lang=en'), 'https://books.example');
  assert.equal(logout.searchParams.has('agent'), false);
  assert.equal(logout.searchParams.get('returnTo'), '/library/?lang=en');
  assert.throws(() => accountLogoutPath('https://books.example/library/', 'https://evil.example/library/account/'), /must belong/);
  assert.throws(() => accountLogoutPath('https://books.example/library/', 'https://books.example/other/'), /must belong/);
  assert.throws(() => accountLogoutPath('javascript:alert(1)', 'https://books.example/'), /must belong/);
});
