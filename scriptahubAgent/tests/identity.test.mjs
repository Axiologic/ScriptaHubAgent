import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyRouterUser } from '../identity.mjs';

test('signed UserPersisto delegation supplies the contact identity', async () => {
  const req = { method: 'GET', headers: { 'x-ploinky-auth-info': 'signed' } };
  const url = new URL('http://localhost/api/session');
  const verifier = { verifyHttpRouteAuthInfoFromHeaders: () => ({ ok: true, payload: { sub: 'user:alice', actor: { kind: 'user', id: 'user:alice' } }, authInfo: { delegations: { identity: { token: 'grant' } } } }) };
  const calls = [];
  const createClient = async (agent, options) => {
    calls.push({ agent, options });
    return { callTool: async () => ({ content: [{ type: 'text', text: JSON.stringify({ user: { id: 'alice', status: 'active', email: 'alice@example.test', displayName: 'Alice' }, roles: ['user'], installationAdministratorId: 'system' }) }] }), close: async () => {} };
  };
  const user = await verifyRouterUser(req, url, Buffer.alloc(0), { verifier, createClient });
  assert.deepEqual({ id: user.id, email: user.email }, { id: 'user:alice', email: 'alice@example.test' });
  assert.equal(user.installationAdministratorId, 'user:system');
  assert.deepEqual(calls, [{ agent: 'userPersistoAgent', options: { userDelegationToken: 'grant' } }]);
  assert.equal(await verifyRouterUser(req, url, Buffer.alloc(0), { verifier: { verifyHttpRouteAuthInfoFromHeaders: () => ({ ...verifier.verifyHttpRouteAuthInfoFromHeaders(), payload: { sub: 'user:bob', actor: { kind: 'user', id: 'user:alice' } } }) }, createClient }), null);
  assert.equal(calls.length, 1);
});
