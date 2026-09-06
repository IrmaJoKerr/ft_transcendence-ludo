/**
 * Config/secrets live in the root .env now — loaded into containers via
 * compose's env_file, and via dotenv for host-side scripts. Kept as a single
 * lookup point so call sites didn't need to change when file-based secrets
 * were retired.
 */

/** Read a config value by its env var name. Returns undefined if unset. */
export function secret(name: string): string | undefined {
  return process.env[name] || undefined;
}

// Per-request check used by oauth.guards.ts (which OAuth app's strategy to
// run) and AuthController (which frontend origin to redirect back to) — both
// switch on which origin a given browser actually came in on. ngrok forwards
// the original Host header unmodified (no --host-header=rewrite in
// NGROK_FLAGS), so a request that hit the tunnel carries the public ngrok
// host; a local request carries localhost. Both a local and a
// tunnelled client can be live against the same running backend at once, so
// this has to be resolved per request rather than from a boot-time flag.
export function isTunnelRequest(host: string | undefined): boolean {
  return !!host && host.includes('ngrok');
}

/** Same as secret(), but fails fast instead of silently signing with undefined. */
export function requireSecret(name: string): string {
  const value = secret(name);
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}
