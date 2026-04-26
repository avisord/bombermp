# BomberMP

Real-time 2D multiplayer browser bomber game (Bomberman-style).

- **Play:** [bombermb.avinashjha.space](https://bombermb.avinashjha.space)
- **Tech:** TypeScript, Node.js, Socket.io, HTML5 Canvas

See [CLAUDE.md](./CLAUDE.md) for full architecture and game-mechanics docs.

---

## Run your own server

You can host your own BomberMP server and have the official client connect
to it — useful for LAN parties, private games, or just to keep latency
local.

### One-liner (Docker)

```bash
docker run -d --name bombermp -p 3001:3001 avisord/bombermp-server:latest
```

That's it. The server is now listening on port `3001`. Open
[bombermb.avinashjha.space](https://bombermb.avinashjha.space), click
**Add Custom Server** in the server-select screen, and point it at your
machine (e.g. `http://your-ip:3001`).

### Image tags

| Tag       | What you get                                          |
|-----------|-------------------------------------------------------|
| `latest`  | Newest published release. Tracks current production. |
| `1.0.1`   | Pinned to that exact version. Reproducible.           |
| `1.0`     | Latest patch of the 1.0 minor.                        |
| `1`       | Latest 1.x release.                                   |

### Versioning & compatibility

The client and server negotiate a major version on every connection. A
client built for `1.x` will refuse to connect to a `2.x` server (and vice
versa) with a `version not supported` message — that protects you from
mid-match desyncs after a protocol change.

If you self-host, keep an eye on releases. `:latest` tracks the version
the official client is built against; pinning `:1` means you get bug
fixes but won't break when a new major ships.

### Optional persistence (MongoDB)

By default the server runs entirely in-memory: gameplay works, but
player display names and match history aren't stored. To enable
persistence, set `MONGODB_URI` and the server will start using it:

```bash
docker run -d --name bombermp \
  -p 3001:3001 \
  -e MONGODB_URI="mongodb://your-mongo-host:27017/bombermp" \
  avisord/bombermp-server:latest
```

### Full local stack with `docker compose`

```bash
git clone https://github.com/avisord/bombermp.git
cd bombermp

# Server + client only
docker compose -f docker/docker-compose.yml up

# Server + client + MongoDB
MONGODB_URI=mongodb://mongodb:27017/bombermp \
  docker compose -f docker/docker-compose.yml --profile persistence up
```

### Configuration

| Env var          | Default                  | Notes                                   |
|------------------|--------------------------|-----------------------------------------|
| `PORT`           | `3001`                   | HTTP/WebSocket port.                    |
| `CLIENT_ORIGIN`  | `http://localhost:5173`  | CORS origin. Use `*` to allow all.      |
| `MONGODB_URI`    | *(unset)*                | Optional. Enables persistence when set. |
| `COOKIE_SECRET`  | `dev-secret`             | Set this to a random string in prod.    |
| `NODE_ENV`       | —                        | Set to `production` in prod.            |

---

## Development

```bash
pnpm install
pnpm dev         # runs shared (watch) + server + client concurrently
pnpm typecheck   # typecheck all workspaces
pnpm build       # build all workspaces
```

### Bumping the protocol version

```bash
pnpm version:bump patch    # 1.0.1 → 1.0.2
pnpm version:bump minor    # 1.0.1 → 1.1.0
pnpm version:bump major    # 1.0.1 → 2.0.0  (breaks self-hosted clients)

git commit -am "release v$(node -p \"require('./package.json').version\")"
git tag "v$(node -p \"require('./package.json').version\")"
git push --follow-tags
```

The `git push --follow-tags` triggers
[`.github/workflows/publish-server.yml`](./.github/workflows/publish-server.yml),
which builds and pushes a multi-arch (amd64 + arm64) image to Docker
Hub.
