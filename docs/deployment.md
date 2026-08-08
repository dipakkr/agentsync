# Deploying the hub

The hub is a single plain-Node process — no database, no build step. Anywhere Node ≥ 22
runs, `agentsync hub` runs. State lives in one append-only NDJSON file, so "persistence"
just means keeping that file on a disk that survives restarts.

For a LAN hackathon you don't need any of this: `npx agentsync hub` on one laptop and
share the printed LAN URL. This page is for hubs that outlive a table.

The repo ships ready-made manifests for the common hosts — `render.yaml` (the "Deploy to
Render" button), `railway.json`, a `Dockerfile` (Fly.io / any container host), and a
`Procfile` — see the README's *Host your own hub* section for the one-click paths. This
page covers the knobs behind them and the DIY setups.

> **Not Vercel.** The hub is a stateful, long-running WebSocket server — serverless
> platforms can't host it.

## The three knobs

| Knob | How |
|---|---|
| Port | `--port` or the `PORT` env var (default 7777) — most PaaS platforms set `PORT` for you |
| Auth | `--token <secret>` or `AGENTSYNC_TOKEN` — members must then join with `--token` |
| Event log | `--log <path>` (default `.agentsync/events.ndjson`) — point it at persistent storage |

After deploying, commit the public URL as `hub_url` in `agentsync.config.yaml` so
teammates join with zero arguments, and share the token out-of-band (never commit it).

## Render (one click)

The **Deploy to Render** button in the README uses the bundled `render.yaml`: it
provisions a web service, generates a strong `AGENTSYNC_TOKEN` for you, and health-checks
`/health`. Note the free plan sleeps after ~15 min idle — first request after that is a
cold start.

## Railway

The bundled `railway.json` sets the start command and `/health` check; Railway injects
`PORT` automatically and the hub honors it.

1. New project → **Deploy from GitHub repo** (your fork, or a repo containing agentsync).
2. Variables: `AGENTSYNC_TOKEN=<secret>` if you want auth.
3. For durable state, attach a **Volume** (e.g. mounted at `/data`) and override the start
   command to `node src/cli/index.js hub --log /data/events.ndjson`.
4. **Settings → Networking → Generate Domain**, then commit it as `hub_url`.

Members join with the HTTPS URL; the client upgrades it to `wss://` automatically:

```bash
npx agentsync join https://your-app.up.railway.app/ --name you --machine laptop --agent claude
```

## Any VPS (systemd)

```ini
# /etc/systemd/system/agentsync.service
[Unit]
Description=AgentSync hub
After=network.target

[Service]
WorkingDirectory=/opt/agentsync
ExecStart=/usr/bin/node src/cli/index.js hub --port 7777 --log /var/lib/agentsync/events.ndjson
Environment=AGENTSYNC_TOKEN=change-me
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now agentsync
curl -s localhost:7777/health   # {"ok":true,"members":0}
```

### Reverse proxy (nginx)

The dashboard and API are plain HTTP, but coordination runs over a WebSocket at `/ws` —
your proxy **must forward the Upgrade headers** or joins will silently hang:

```nginx
location / {
    proxy_pass http://127.0.0.1:7777;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 1h;          # WebSockets are long-lived
}
```

## Docker / Fly.io

The repo's `Dockerfile` builds a ready-to-run hub image (Node 22 alpine, `PORT` honored):

```bash
docker build -t agentsync-hub .
docker run -d -p 7777:7777 -v agentsync-data:/data -e AGENTSYNC_TOKEN=change-me \
  agentsync-hub node src/cli/index.js hub --log /data/events.ndjson
```

On Fly.io it's just `fly launch && fly deploy` (add a volume + `--log` for durable state).
Health-check with `GET /health`.

## Operations notes

- **Backup** = copy the NDJSON log. **Reset** = delete it and restart.
- **Upgrade** = pull the new code and restart; state replays from the log on boot.
- The token is a single shared secret over the wire — run behind HTTPS (Railway gives
  you this for free) and rotate it by restarting the hub with a new value. Real
  per-member auth is on the roadmap.
