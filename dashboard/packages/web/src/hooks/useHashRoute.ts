import { useEffect, useState } from 'react';

export type Route =
  | { name: 'store' }
  | { name: 'cart' }
  | { name: 'ops' }
  | { name: 'sourcing' }
  | { name: 'finance' }
  | { name: 'incidents' }
  | { name: 'about' }
  | { name: 'order'; orderId: string };

/**
 * Hash routes only, so the public build needs no server rewrite rules. A page loaded without a
 * hash keeps rendering the control tower, which is what older links and embedded views expect.
 */
export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '');
  if (path === '') return { name: 'ops' };
  if (path === '/') return { name: 'store' };
  if (path === '/cart') return { name: 'cart' };
  if (path === '/ops') return { name: 'ops' };
  if (path === '/sourcing') return { name: 'sourcing' };
  if (path === '/finance') return { name: 'finance' };
  if (path === '/incidents') return { name: 'incidents' };
  if (path === '/about') return { name: 'about' };
  const order = /^\/orders\/([^/]+)$/.exec(path);
  if (order) return { name: 'order', orderId: decodeURIComponent(order[1]!) };
  return { name: 'store' };
}

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash;
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(currentHash()));

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

export function navigateTo(hash: string): void {
  window.location.hash = hash;
}
