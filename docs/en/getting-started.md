# Local setup

## Requirements

- **Node.js 22** (CI uses Node 22), npm;
- **mkcert** — local HTTPS certificates are required for development (the WebSocket runs over `wss://`).

## Installation

```bash
git clone https://github.com/lgick/tank-battle.git
cd tank-battle
npm install
```

## HTTPS certificates (one time)

```bash
brew install mkcert nss
mkcert -install
mkdir .certs && cd .certs
mkcert -key-file key.pem -cert-file cert.pem localhost 127.0.0.1 ::1
```

Certificate paths are set in `src/config/server.js` (`httpsOptions`). Certificates are not needed in production — the server runs over HTTP behind Nginx (see [deployment.md](deployment.md)).

## Running

```bash
npm run audio:process      # audio (once)
npm run dev
```

The server starts at `https://localhost:3000` (ViteExpress serves the client alongside the Express server; nodemon watches `src/server`, `src/lib`, `src/config`, `src/data`).

Other commands:

```bash
npm start              # production run (reads .env: TANK_BATTLE_DOMAIN and others)
npm run build          # build (audio processing + Vite bundle)
npx eslint .           # linter
npm test               # tests (Vitest), single run
npm run test:watch     # tests in watch mode
npm run test:coverage  # coverage
```

The `.env` variables for production are described in [configuration.md](configuration.md#environment-variables-env).

## Local multiplayer

- Open several browser tabs — each becomes a separate player.
- In dev mode `oneConnection` is disabled automatically (`src/server/main.js`), so several connections from one IP are allowed. If you run it differently — disable `oneConnection: true` in `src/config/server.js`.
- Bots are conveniently added with the chat command `/bot 5` (see [gameplay.md](gameplay.md#chat-key-c-and-commands)).

## Tests

Stack: **Vitest** + happy-dom (client tests) + coverage-v8. The `vitest.config.js` config splits the run into two projects:

- `node` — `tests/server`, `tests/lib`, `tests/config` (node environment; Rapier WASM works in tests);
- `client` — `tests/client` (happy-dom environment).

Tests live in `tests/` and mirror the `src/` structure. Integration tests are in `tests/server/integration/` (the full VIMP lifecycle with real modules). Project rule: **every code change ends with green `npx eslint .` and `npm test`**; when editing `Tank.updateData`/`models.js` the parity test `tests/server/TankPredictorParity.test.js` is mandatory.

CI (`.github/workflows/test.yml`) runs eslint + tests on every push/PR.
