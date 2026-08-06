# Security Policy

AgentSync is early-stage software. Please treat it accordingly.

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead email
**dipakkr.co@gmail.com** with details and, if possible, a reproduction. We'll acknowledge
within a few days and keep you updated on a fix.

## Known limitations (by design, for now)

- **The hub auth is a single shared token.** Anyone with the URL + token can join a room,
  read chat, and claim tasks. Run the hub on a trusted network or behind a tunnel with
  access control. Real per-member auth is on the roadmap.
- **The hub is advisory.** It never blocks git. It can warn about overlaps; it cannot
  prevent a push. Git remains the source of truth.
- **No transport encryption is added by AgentSync.** Put TLS in front of the hub
  (reverse proxy / tunnel) for anything beyond localhost/LAN.
- **Protected-path guards are advisory** and depend on the installed git hook. They reduce
  accidents; they are not a secrets-management solution.

## Supported versions

Pre-1.0: only the latest `main` receives fixes.
