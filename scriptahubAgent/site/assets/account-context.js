function accountRoute(action, applicationRoot, currentPage) {
  const root = new URL(applicationRoot), current = new URL(currentPage);
  if (!['http:', 'https:'].includes(root.protocol) || root.username || root.password
    || current.origin !== root.origin || !root.pathname.endsWith('/') || !current.pathname.startsWith(root.pathname)) {
    throw new Error('The account return destination must belong to this application.');
  }
  const route = new URL('/auth/' + action, root);
  // Shared-origin agent-port mounts need an explicit auth selector. Dedicated
  // application hosts already bind the auth context in the Router.
  const mount = /^\/base-agent-additional-server\/([^/]+)\/\d+\//.exec(root.pathname);
  if (mount) route.searchParams.set('agent', decodeURIComponent(mount[1]));
  return { root, current, route };
}

export function accountLoginPath(applicationRoot, currentPage) {
  const { current, route } = accountRoute('login', applicationRoot, currentPage);
  route.searchParams.set('returnTo', current.pathname + current.search + current.hash);
  return route.pathname + route.search;
}

export function accountLogoutPath(applicationRoot, currentPage) {
  const { root, current, route } = accountRoute('logout', applicationRoot, currentPage);
  const home = new URL(root.pathname, root.origin);
  const language = current.searchParams.get('lang');
  if (language) home.searchParams.set('lang', language);
  route.searchParams.set('returnTo', home.pathname + home.search);
  route.searchParams.set('cancelTo', current.pathname + current.search + current.hash);
  return route.pathname + route.search;
}
