// One origin allow-list for the browser-facing gates that need it: the CSRF
// middleware on mutating /api routes and the session socket's handshake. Keeping
// it here means the socket cannot drift into accepting an origin the API refuses.

// Returns the serialized origin, or null for a value a browser reports as
// "null" (sandboxed iframe, opaque origin) or an unparseable string.
export function originOf(value: string): string | null {
  try {
    const origin = new URL(value).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

// A request's own host is trusted by the CSRF gate separately, so this is only
// the list of published app URLs. The dev server is included because Vite
// proxies /api (and now the socket) and keeps the browser on
// http://localhost:5173. LAN is only added when `make lan` wrote LAN_IP.
let allowedOrigins: Set<string> | null = null;
export function publishedOrigins(): Set<string> {
  if (allowedOrigins) return allowedOrigins;
  const values = [
    process.env.FRONTEND_URL,
    process.env.NGROK_FRONTEND_URL,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ];
  if (process.env.LAN_IP) {
    values.push(`https://${process.env.LAN_IP}:${process.env.HTTPS_PORT ?? '8443'}`);
  }
  const set = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const origin = originOf(value);
    if (origin) set.add(origin);
  }
  allowedOrigins = set;
  return set;
}

// Exact match, never a prefix or suffix test: `https://localhost:8443.evil.test`
// must not ride on `https://localhost:8443`. `undefined` means the client sent
// no Origin at all (curl, the harnesses), which is allowed because such a client
// has to present the httpOnly cookie anyway.
export function originAllowed(origin: string | undefined, allowed: Set<string>): boolean {
  if (!origin) return true;
  const presented = originOf(origin);
  return presented !== null && allowed.has(presented);
}
