# LAN mode

Reaching the app from another device on the same WiFi. Companion docs:
[`nginx.md`](./nginx.md), [`tunnel.md`](./tunnel.md).

## Local mode (baseline)

```
make all      # = make build && make start
```

Nothing special: the whole compose stack comes up, and `https://localhost:8443`
resolves to nginx on your own machine. LAN mode is this plus one more step.

## LAN mode

```
make lan      # = make all, then prints the LAN URL
```

There is genuinely no extra configuration here — nginx already single-origins
everything (the SPA calls relative `/api/` paths, not an absolute
`localhost:...` URL — see [`nginx.md`](./nginx.md)), so whatever hostname or
IP a client typed into their browser is what those relative calls resolve
against. `make lan` just:

1. Runs `make all` (the same stack as local mode).
2. Detects your LAN IP (`LAN_IP` in `.env` if set, else auto-detected via
   `ip route get 1.1.1.1` on Linux or `ipconfig getifaddr en0/en1` on macOS).
3. Prints `https://<LAN_IP>:8443` for other devices on the same WiFi to open.

Because nginx's `"8443:443"` port mapping is published on all interfaces
(not loopback-only like every other service — see `compose.yaml`), any
device on the same network can reach it directly — same self-signed cert,
same "tap through the browser warning" step as local mode.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `LAN_IP` | no | Auto-detected from `en0`/`en1` (macOS) or the default route (Linux) if unset |
| `HTTPS_PORT` | no | Default `8443` — used in the printed URL; the actual nginx port mapping in `compose.yaml` is hardcoded to `8443:443` regardless of this value |
| `FRONTEND_URL` | yes | Default `https://localhost:8443` — used by OAuth post-login redirects, not LAN routing itself (LAN clients hit the same nginx origin they typed) |

## Known caveat

Campus/corporate WiFi with client isolation blocks device-to-device traffic
entirely — nothing will show up for other devices in that case (this is
called out directly in the Makefile's own `lan` target output). A phone
hotspot is the fallback for testing when that happens.
