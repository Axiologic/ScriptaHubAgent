import crypto from 'node:crypto';
import { PublicationAccessStore, validPublicationToken } from './publication-access.mjs';
import { githubClientId, githubProfile, beginGithub, pollGithub } from './publication-github.mjs';
import { assertSettingsAdmin } from './settings.mjs';
import { publicationConfig } from './publication-config.mjs';

export function publicPublication(config) {
  return config.publication ? {authorName:config.publication.authorName, authorEmail:config.publication.authorEmail} : null;
}
function currentConnection(state, now) {
  return state.connection && (!state.connection.expiresAt || state.connection.expiresAt > now) ? state.connection : null;
}
function present(state, owner, now) {
  const connection = currentConnection(state, now);
  const pending = state.pending?.owner === owner && state.pending.expiresAt > now && state.pending.userCode ? state.pending : null;
  return {connected:Boolean(connection), method:connection?.source || null, user:connection?.user || null,
    publication:connection?.publication || null,
    pending:pending ? {userCode:pending.userCode, verificationUri:pending.verificationUri, interval:pending.interval} : null};
}

export async function publicationAuthentication(auth, input, deps = {}) {
  assertSettingsAdmin(auth);
  const owner = auth.user.id;
  if (typeof owner !== 'string' || !owner.trim()) throw new Error('Authenticated administrator identity is required');
  if (!['status','begin','poll','token','connect','disconnect'].includes(input.action)) throw new Error('Unknown publication authentication action');
  const now = deps.now || Date.now;
  const store = deps.store || new PublicationAccessStore(deps.dataDir);
  try {
    if (input.action === 'status') return present(store.read(), owner, now());
    if (input.action === 'disconnect') {
      store.update(state => { state.generation++; state.connection = null; state.pending = null; });
      return {connected:false, method:null, publication:null, pending:null};
    }
    if (input.action === 'begin') {
      const nonce = crypto.randomUUID(), clientId = githubClientId();
      store.update(state => { state.pending = {owner, nonce}; });
      let result;
      try { result = await beginGithub(clientId, deps.fetchImpl); }
      catch (error) { store.update(state => { if (state.pending?.nonce === nonce) state.pending = null; }); throw error; }
      const url = new URL(result.verification_uri);
      if (url.href !== 'https://github.com/login/device' || typeof result.device_code !== 'string' || !result.device_code
        || typeof result.user_code !== 'string' || !result.user_code || !Number.isSafeInteger(result.expires_in)
        || result.expires_in < 1 || result.expires_in > 3600 || !Number.isSafeInteger(result.interval) || result.interval < 1 || result.interval > 60) {
        store.update(state => { if (state.pending?.nonce === nonce) state.pending = null; });
        throw new Error('GitHub returned an invalid device authorization');
      }
      store.update(state => {
        if (state.pending?.nonce !== nonce) throw new Error('Git authorization was replaced. Start again.');
        state.pending = {owner, nonce, clientId, deviceCode:result.device_code, userCode:result.user_code, verificationUri:url.href,
          expiresAt:now()+result.expires_in*1000, interval:result.interval, nextPollAt:now()+result.interval*1000};
      });
      return present(store.read(), owner, now());
    }
    let token, user, expiresAt = null, pendingNonce, source;
    const generation = store.read().generation;
    if (input.action === 'poll') {
      const pending = store.update(state => {
        const value = state.pending;
        if (!value || value.owner !== owner) throw new Error('Start GitHub authorization from this administrator account first');
        if (value.expiresAt <= now()) { state.pending = null; return null; }
        if (!value.deviceCode || value.nextPollAt > now()) return null;
        value.nextPollAt = now() + value.interval*1000;
        return {...value};
      });
      if (!pending) return present(store.read(), owner, now());
      pendingNonce = pending.nonce;
      const result = await pollGithub(pending.clientId, pending.deviceCode, deps.fetchImpl);
      if (result.error) {
        if (['authorization_pending','slow_down'].includes(result.error)) {
          if (result.error === 'slow_down') store.update(state => {
            if (state.pending?.nonce === pendingNonce) { state.pending.interval += 5; state.pending.nextPollAt = now()+state.pending.interval*1000; }
          });
          return present(store.read(), owner, now());
        }
        store.update(state => { if (state.pending?.nonce === pendingNonce) state.pending = null; });
        throw new Error('GitHub authorization was denied or expired. Start again.');
      }
      token = validPublicationToken(result.access_token); source = 'github';
      if (result.expires_in !== undefined) {
        if (!Number.isSafeInteger(result.expires_in) || result.expires_in <= 0) throw new Error('GitHub returned an invalid token expiry');
        expiresAt = now()+result.expires_in*1000;
      }
      user = await githubProfile(token, deps.fetchImpl);
    } else if (input.action === 'token') {
      token = validPublicationToken(input.token); source = 'token';
      user = await githubProfile(token, deps.fetchImpl);
    } else {
      const connection = currentConnection(store.read(), now());
      if (!connection) throw new Error('Connect GitHub or save a token first');
      ({token, user, expiresAt, source} = connection);
    }
    const authorName = input.authorName?.trim() || user.name || user.login;
    const authorEmail = input.authorEmail?.trim() || user.email;
    const needsIdentity = !authorName || !authorEmail;
    const publication = needsIdentity ? null : publicationConfig({authorName, authorEmail});
    store.update(state => {
      if (state.generation !== generation || (pendingNonce && state.pending?.nonce !== pendingNonce)) throw new Error('Git authorization changed during this request. Check its current status.');
      state.generation++; state.connection = {token, user, expiresAt, publication, source, configuredBy:owner}; state.pending = null;
    });
    return {...present(store.read(), owner, now()), authorized:!needsIdentity, needsIdentity};
  } finally { if (!deps.store) store.close(); }
}
