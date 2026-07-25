# Architecture

Tank Battle is a multiplayer 2D real-time game. **The server is authoritative**: all physics (Rapier 2D), damage, and rules are computed on the server; the client renders the world (PixiJS) and masks network latency with interpolation and prediction.

```
┌─────────────────────────┐        WebSocket         ┌─────────────────────────┐
│         Server          │  JSON [port, payload] +  │         Client          │
│  Node.js + Express + ws │  binary snapshot (5)     │     PixiJS + Howler     │
│  Rapier 2D physics ~120Hz ───────────────────────► │  interpolation (−100 ms)│
│  snapshots 30/sec       │ ◄─────────────────────── │  own-tank prediction    │
└─────────────────────────┘  input "seq:action:name" └─────────────────────────┘
```

## Repository structure

```
src/
  server/        — game server
    main.js      — bootstrap: configs, HTTP(S), ViteExpress, WebSocket
    modules/     — VIMP (facade), Game (physics), Panel, Stat, Vote, chat/,
                   TimerManager, SnapshotManager, RTTManager, bots/
    core/        — RoundManager, CommandProcessor, VoteCoordinator
    player/      — Participant/Human/Bot + ParticipantManager (participant registry)
    parts/       — physical entities: Tank, Bomb, Map, HitscanService, BaseModel
    physics/     — rapier.js (WASM init, the single Rapier import point)
    socket/      — WebSocket layer + SocketManager (all sends)
  client/        — browser client
    main.js      — WS dispatcher, module init, render loop
    components/  — MVC triplets (Auth, CanvasManager, Controls, Game, Chat, Panel, Stat, Vote)
    parts/       — PixiJS entities and effects
    providers/   — BakingProvider (textures), DependencyProvider
    SnapshotInterpolator.js / TankPredictor.js / ShotPredictor.js / SoundManager.js
  config/        — shared server and client configs (game, client, server, auth,
                   sounds, wsports, opcodes)
  data/          — static data: maps/, models.js, weapons.js
  lib/           — shared utilities: Publisher, factory, math, vec2, raycast,
                   snapshotCodec, validators, sanitizers, security, config, …
tests/           — Vitest (mirrors the src/ structure)
public/          — static assets (sounds)
scripts/         — helper scripts (audio processing)
.github/         — CI/CD (test.yml, deploy.yml) and deployment scripts
```

`src/config/`, `src/data/`, and `src/lib/` are the **shared layer**: they are imported by both the server (Node.js) and the client (Vite bundle). Thanks to this, the snapshot codec, math, validators, and model parameters are guaranteed to match on both sides.

## Server side

**`VIMP`** (singleton, [src/server/modules/VIMP.js](../../src/server/modules/VIMP.js)) is a facade: it wires modules together, drives the connection lifecycle, and delegates the tick. Ownership tree:

```
VIMP (facade/wiring + tick delegation)
 ├─ ParticipantManager   — single registry of players and bots (source of truth)
 ├─ RoundManager         — rounds, team wipe, map change, spectator↔active
 ├─ CommandProcessor     — chat commands (/name, /bot, /nr, /timeleft, /mapname)
 ├─ VoteCoordinator      — vote creation/cooldown/reset
 ├─ Game (Rapier 2D)     — physics, Tank/Bomb/Map/HitscanService
 ├─ Network: SnapshotManager + SnapshotPacker (binary) + SocketManager
 ├─ Cold path: Panel, Stat, Chat, Vote (JSON, on change)
 ├─ TimerManager         — all timers  /  RTTManager — pings and kicks
 └─ Bots                 — BotController, NavigationSystem, SpatialManager
```

For details on each module, see [server.md](server.md).

### Game loop

`TimerManager` calls `onShotTick` at ~120 Hz (`timers.timeStep`). Per tick:

1. `Game.updateData(dt)` — fixed physics steps in Rapier (with spiral-of-death protection);
2. bot updates (if any);
3. `SnapshotManager.processTick()` — every `networkSendRate`-th tick (4 → **30 snapshots/sec**) returns a world snapshot, otherwise the tick is done;
4. `SnapshotPacker.packBody` — the broadcast part of the frame is packed **once**;
5. for each ready user: `packFrame` (camera + the playing user's player block) → binary send (port 5) + meta (panel/stat/chat/vote) over their own JSON channels **only on change**.

### Connection lifecycle

```
connect → origin check → CONFIG → auth → createUser (spectator)
  → sendMap → mapReady → firstShotReady → participation in the game loop
  → removeUser on disconnect (or kick: idle / RTT)
```

Protocol and port details are in [network.md](network.md).

## Client side

The client is built around three network-smoothing mechanisms (details in [client.md](client.md)):

- **Interpolation** (`SnapshotInterpolator`): frames are buffered, the world is rendered in the past (`serverNow − 100 ms`); events are emitted exactly once, positions are interpolated.
- **Prediction** (`TankPredictor`): the own tank is simulated by a local replica of the server movement model; the server confirms input (`lastInputSeq`), reconciliation replays unconfirmed inputs, and the discrepancy fades out smoothly.
- **Client-side projectile spawning** (`ShotPredictor`): a shot is seen and heard instantly, server duplicates are suppressed by the author id.

Rendering — MVC components + PixiJS `parts/` entities on two canvases (`vimp`, `radar`); procedural textures are baked at startup.

## Key invariants

- **The source of truth for ports** is `src/config/wsports.js`; for snapshot keys and the binary format version — `src/config/opcodes.js`.
- **Movement replica parity**: `Tank.updateData` (server) and `TankPredictor` (client) must match numerically; enforced by the test `tests/server/TankPredictorParity.test.js` — any change to `Tank.updateData`/`models.js` requires running it.
- **Rapier is imported only through** `src/server/physics/rapier.js` (top-level await WASM init).
- **A single numeric id space** for humans and bots; the distinction is `isBot`/`isNetworked`.
- All sends to the client go only through `SocketManager`.
