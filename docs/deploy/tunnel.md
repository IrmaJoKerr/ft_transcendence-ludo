# Tunnel mode (ngrok)

Reaching the app from anywhere on the internet, via ngrok. Companion docs:
[`nginx.md`](./nginx.md), [`lan.md`](./lan.md).

Verified directly against the current repo (`Makefile`, `backend/src/secrets.ts`,
`backend/src/auth/oauth.guards.ts`, `backend/src/auth/auth.controller.ts`)
rather than copied from older docs — see [Known gotchas](#known-gotchas) at
the bottom for two places where a comment/config no longer matches what
actually runs.

## Commands

```
make ngrok-auth   # one-time: registers NGROK_AUTHTOKEN with the ngrok CLI
make tunnel       # = make all, then ngrok http https://localhost:$(NGROK_PORT)
make tunnel-url   # prints the current public URL from ngrok's local API (:4040)
make dev-tunnel   # opens two Terminal.app tabs: `make dev` + `make tunnel` (macOS only)
make stop-tunnel  # kills ngrok and stops the compose stack
```

## No separate hop — same nginx TLS listener

`make tunnel` points ngrok **straight at nginx's own TLS listener** —
`ngrok http https://localhost:$(NGROK_PORT)` (the `https://` scheme, not
`http://`, is deliberate: it tells ngrok to speak TLS to the local upstream
instead of forwarding plain HTTP at a TLS-only port). There is no separate
plain-HTTP hop for tunnel mode — the public ngrok URL, the LAN URL, and the
local URL all terminate at the exact same nginx TLS listener described in
[`nginx.md`](./nginx.md). ngrok doesn't verify the self-signed cert by
default, so that's not an issue.

If `NGROK_DOMAIN` is set in `.env`, `make tunnel` passes
`--url=https://$(NGROK_DOMAIN)` so you get a stable, reusable ngrok domain
instead of a random one each run.

## Why OAuth needs two apps per provider

Google/GitHub/42 OAuth apps are registered with a fixed, whitelisted
callback URL. A tunnel's public URL is a different origin from
`https://localhost:8443`, so **one** OAuth app can't cover both — you'd have
to reconfigure the provider's callback URL every time you switched modes.
Instead, this app registers **two full sets** of OAuth credentials per
provider (`GOOGLE_CLIENT_ID` / `NGROK_GOOGLE_CLIENT_ID`, etc. — all required
in `.env`, see `TUNNEL_VARS` in the `Makefile`) and both Passport strategies
are active on the backend **at the same time**.

Which one handles a given request is resolved **per request**, not at boot,
because a local client and a tunnelled client can both be live against the
same running backend simultaneously:

```ts
// backend/src/secrets.ts
export function isTunnelRequest(host: string | undefined): boolean {
  return !!host && host.includes('ngrok')
}
```

ngrok forwards the browser's original `Host` header unmodified, so a request
that came in through the tunnel carries the public `*.ngrok-free.dev` host;
a local or LAN request carries `localhost`/the LAN IP. `oauth.guards.ts`
checks this on every OAuth kickoff to pick the matching Passport strategy
(`google` vs `google-tunnel`, etc.), and `auth.controller.ts` uses the same
check to decide which `FRONTEND_URL` to redirect back to after login
(`FRONTEND_URL` vs `NGROK_FRONTEND_URL`).

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `NGROK_AUTHTOKEN` | yes | Required by `make ngrok-auth`, which `tunnel` depends on |
| `NGROK_DOMAIN` | no | Reserved ngrok domain, for a stable URL across restarts |
| `NGROK_PORT` | no | Default `8443` — the local port ngrok tunnels (nginx's published port); `make env` seeds it |
| `NGROK_FRONTEND_URL` | yes | Post-login redirect target for tunnelled requests |
| `GOOGLE_/GITHUB_/FORTYTWO_CLIENT_ID` + `_SECRET` + `_CALLBACK_URL` | yes | Local OAuth apps |
| `NGROK_GOOGLE_/GITHUB_/FORTYTWO_CLIENT_ID` + `_SECRET` + `_CALLBACK_URL` | yes | Tunnel OAuth apps — separate credentials, separate callback URLs registered with each provider |

`make env` (a prerequisite of `make build`, so it runs on every path) reads
`.env`, validates that every required value (core secrets/DB URLs, OAuth apps,
tunnel credentials) is present and non-empty — failing hard with the missing
list otherwise — and refreshes `LAN_IP` to the machine's current address.
Nothing is auto-generated: copy a real `.env` from a teammate.

## Known gotchas

One place where a comment/default in the code describes different behavior
than what actually runs — found by tracing the config directly rather than
trusting the comments:

1. **`TUNNEL_MODE` (in `compose.yaml`'s `backend.environment`) is never read
   by the backend.** `grep -rn TUNNEL_MODE backend/` turns up nothing outside
   `compose.yaml` itself. The actual local/tunnel switch is the per-request
   `isTunnelRequest(host)` check above — `make tunnel`'s
   `TUNNEL_MODE=true docker compose up -d --no-deps backend` step recreates
   the backend container, which may still be useful for picking up fresh
   `.env` values, but the env var it sets does nothing on its own.

This one is not fixed here — flagging it rather than silently patching the
Makefile, since fixing wasn't asked for and other people may be relying on
this behavior as-is.
