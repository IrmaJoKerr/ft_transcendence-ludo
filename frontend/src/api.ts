import i18n from './i18n';
import { createRefreshLock } from './authRefreshLock';

// Auth API helpers: on a 401, refresh once (shared across all callers) and
// retry. An expired refresh token means signed out; a blocked one returns its own
// status.

// ngrok needs this header to skip its first-request interstitial; other hosts
// ignore it. Headers go through the Headers constructor because spreading a
// Headers instance yields {}.
function withNgrokHeader(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set('ngrok-skip-browser-warning', 'true');
  return { ...init, headers };
}

// Refresh outcomes: 'ok' → retry the call; 'expired' → signed out; 'blocked' →
// refresh failed (rate limit/server/offline), keeping its status/retryAfter so
// callers don't mistake it for a logout.
type RefreshResult =
  | { outcome: 'ok' }
  | { outcome: 'expired' }
  | { outcome: 'blocked'; status: number; retryAfter: string | null };

// One refresh per browser, not per page, so no two tabs send the same refresh
// token (see authRefreshLock.ts). A lost race also gets a second look from the
// /me probe below before it is called an ended session.
const refreshLock = createRefreshLock();
// The winner's response has to land before /me can see the new session, so a 401
// there is retried a few times before it counts as signed out.
const PROBE_ATTEMPTS = 3;
const PROBE_GAP_MS = 250;

let refreshing: Promise<RefreshResult> | null = null;

// Exported so callers (e.g. the store's refresh timer) can refresh before the
// token expires, sharing apiFetch's single in-flight request.
export function refreshOnce(): Promise<RefreshResult> {
  const pending = refreshing;
  if (pending !== null) return pending;
  refreshing = coordinatedRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

// The tab holding the cross-tab lock posts; the others reuse its outcome, because
// the rotated cookies are shared at browser level. A tab that hears nothing (no
// BroadcastChannel, or the leader died mid-flight) posts as well: a duplicate is
// the pre-fix behaviour, and postRefresh's probe keeps it from reading as a
// logout.
async function coordinatedRefresh(): Promise<RefreshResult> {
  const lease = refreshLock.acquire<RefreshResult>();
  if (lease.role === 'follower') {
    const mirrored = await lease.awaitResult();
    if (mirrored !== null) return mirrored;
  }
  const result = await postRefresh();
  if (lease.role === 'leader') {
    lease.publish(result);
    lease.release();
  }
  return result;
}

// Ask the server to rotate the session cookies.
async function postRefresh(): Promise<RefreshResult> {
  const res = await fetch('/api/auth/refresh', withNgrokHeader({ method: 'POST' })).catch(
    () => null,
  );
  if (!res) return { outcome: 'blocked', status: 503, retryAfter: null };
  if (res.ok) return { outcome: 'ok' };
  if (res.status !== 401 && res.status !== 403) {
    return { outcome: 'blocked', status: res.status, retryAfter: res.headers.get('Retry-After') };
  }
  // Two 401s that need telling apart. AUTH_NOT_AUTHENTICATED is "no refresh
  // cookie at all": nothing to have raced with, so the session is over.
  // AUTH_SESSION_EXPIRED is an unknown token, which a second tab's rotation
  // produces as well, so it goes to the probe.
  const body = (await res.json().catch(() => null)) as { code?: string } | null;
  if (body?.code === 'AUTH_NOT_AUTHENTICATED') return { outcome: 'expired' };
  return probeSession();
}

// Tie-breaker for a lost rotation race: the cookies are shared, so once the
// winning tab's response has landed /me answers 200 on the fresh access token.
// Only a run of 401s means the session really is over; anything else (network,
// throttle, server error) is reported as blocked, which no caller reads as a
// logout.
async function probeSession(): Promise<RefreshResult> {
  for (let attempt = 1; attempt <= PROBE_ATTEMPTS; attempt += 1) {
    const res = await fetch('/api/auth/me', withNgrokHeader()).catch(() => null);
    if (!res) return { outcome: 'blocked', status: 503, retryAfter: null };
    if (res.ok) return { outcome: 'ok' };
    if (res.status !== 401 && res.status !== 403) {
      return { outcome: 'blocked', status: res.status, retryAfter: res.headers.get('Retry-After') };
    }
    if (attempt < PROBE_ATTEMPTS) await new Promise((r) => setTimeout(r, PROBE_GAP_MS));
  }
  return { outcome: 'expired' };
}

// fetch() for authenticated endpoints: on a 401 it refreshes once and retries.
// Expired refresh returns the 401 (signed out); blocked refresh returns its own
// status. Retries reuse `init`, so keep bodies as plain values, not streams.
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const finalInit = withNgrokHeader(init);
  const res = await fetch(input, finalInit);
  if (res.status !== 401) return res;

  const result = await refreshOnce();
  if (result.outcome === 'ok') return fetch(input, finalInit);
  if (result.outcome === 'expired') return res;

  return new Response(null, {
    status: result.status,
    headers: result.retryAfter ? { 'Retry-After': result.retryAfter } : undefined,
  });
}

// Maps a backend error `code` to a localized message (errors.<CODE>), with a few
// overrides that reuse existing keys. Returns null when there is no mapping, so
// callers fall back to the server's English message.
const ERROR_KEY_OVERRIDES: Record<string, string> = {
  AVATAR_INVALID_TYPE: 'profile.fileTypeError',
};

export function translateErrorCode(code: unknown): string | null {
  if (typeof code !== 'string' || code.length === 0) return null;
  const key = ERROR_KEY_OVERRIDES[code] ?? `errors.${code}`;
  return i18n.exists(key) ? i18n.t(key) : null;
}

// Typed JSON REST helpers built on apiFetch.
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await apiFetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const b = body as { code?: string; message?: string | string[] } | null;
    const msg = b?.message;
    const localized = translateErrorCode(b?.code);
    const error = new Error(
      localized ??
        (Array.isArray(msg)
          ? msg.join('. ')
          : (msg ?? i18n.t('common.requestFailed', { status: res.status }))),
    );
    // Carry the backend code so callers can react to it (e.g. field-level errors).
    (error as { code?: string }).code = b?.code;
    throw error;
  }
  return res.json() as Promise<T>;
}

export const getApi = <T>(path: string) => request<T>(path);
export const postApi = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body != null ? JSON.stringify(body) : undefined });
export const deleteApi = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'DELETE', body: body != null ? JSON.stringify(body) : undefined });
export const patchApi = <T>(path: string, body?: unknown) =>
  request<T>(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
