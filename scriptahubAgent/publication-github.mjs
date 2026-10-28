// Standard GitHub provider endpoints, never deployment-specific Router URLs.
const API = 'https://api.github.com';
const OAUTH = 'https://github.com/login';
// Existing Ploinky OAuth application's public identifier; deployments may use their own.
export const githubClientId = () => process.env.SCRIPTA_GITHUB_CLIENT_ID || 'Ov23liRKJjJHqo3zOOI6';
export async function githubRequest(url, {token, form, fetchImpl = fetch} = {}) {
  let response;
  try {
    response = await fetchImpl(url, {method:form ? 'POST' : 'GET', redirect:'error', signal:AbortSignal.timeout(20000),
      headers:{Accept:'application/json', 'User-Agent':'ScriptaHub', ...(token ? {Authorization:`Bearer ${token}`} : {}), ...(form ? {'Content-Type':'application/x-www-form-urlencoded'} : {})},
      ...(form ? {body:new URLSearchParams(form)} : {})});
    if (!response.ok) throw new Error('Provider rejected request');
    return await response.json();
  } catch { throw new Error('GitHub authentication failed. Check the token, connection and repository permissions.'); }
}
export async function githubProfile(token, fetchImpl) {
  const user = await githubRequest(API+'/user', {token, fetchImpl});
  if (typeof user.login !== 'string' || !user.login) throw new Error('GitHub returned an invalid account');
  let email = user.email || '';
  if (!email) {
    const emails = await githubRequest(API+'/user/emails', {token, fetchImpl}).catch(() => []);
    email = Array.isArray(emails) ? emails.find(item => item.primary && item.verified)?.email || '' : '';
  }
  return {login:user.login, name:typeof user.name === 'string' ? user.name : '', email};
}
export function beginGithub(clientId, fetchImpl) {
  return githubRequest(OAUTH+'/device/code', {form:{client_id:clientId, scope:'repo read:user user:email'}, fetchImpl});
}
export function pollGithub(clientId, deviceCode, fetchImpl) {
  return githubRequest(OAUTH+'/oauth/access_token', {form:{client_id:clientId, device_code:deviceCode, grant_type:'urn:ietf:params:oauth:grant-type:device_code'}, fetchImpl});
}
