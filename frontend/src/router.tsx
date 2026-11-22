import { useSyncExternalStore } from 'react';

export type Route = { path: string; query: URLSearchParams };

const listeners = new Set<() => void>();
let snapshot: Route = read();

function read(): Route {
  return {
    path: window.location.pathname.replace(/\/+$/, '') || '/',
    query: new URLSearchParams(window.location.search),
  };
}

function emit() {
  snapshot = read();
  for (const l of listeners) l();
}

// Push (or replace) a new URL and re-render. Every nav resets scroll to top.
export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  window.scrollTo(0, 0);
  emit();
}

window.addEventListener('popstate', emit);

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
  );
}
