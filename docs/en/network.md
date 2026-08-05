# Server–client synchronization (the WebSocket protocol)

The client and server communicate over a single WebSocket connection. Two message formats are used:

- **JSON**: `[portId, payload]` — all channels except the snapshot. `portId` is a numeric id from [src/config/wsports.js](../../src/config/wsports.js) (the source of truth).
- **Binary**: the game snapshot frame (port `5`, SHOT_DATA) — an `ArrayBuffer` packed by the [src/lib/snapshotCodec.js](../../src/lib/snapshotCodec.js) codec.

The client distinguishes the formats by the type of `e.data` in `ws.onmessage`: a string → the JSON dispatcher `socketMethods[portId]`, an `ArrayBuffer` → `unpackFrame` → the interpolator buffer.

## Ports

### Server → client

| Port | Name | Format | Description |
| :--: | --- | :--: | --- |
| 0 | `CONFIG_DATA` | JSON | The client config (`src/config/client.js` + `prediction`) |
| 1 | `AUTH_DATA` | JSON | Authorization form data |
| 2 | `AUTH_RESULT` | JSON | Authorization errors (or `null`) |
| 3 | `MAP_DATA` | JSON | Map data |
| 4 | `FIRST_SHOT_DATA` | JSON | The first game frame (one-time, bypasses the interpolation buffer): `[gameSnapshot, 0, serverTime, 0]` |
| 5 | `SHOT_DATA` | **binary** | The game snapshot frame (see below) |
| 6 | `SOUND_DATA` | JSON | A system sound name (`roundStart`, `victory`, `frag`, …) |
| 7 | `GAME_INFORM_DATA` | JSON | On-screen game messages (`[code, params?]`: team victory, round start, game over) |
| 8 | `TECH_INFORM_DATA` | JSON | "Black screen" technical messages (`[code, params?]`: server full, loading, kicks); no data — hide the screen |
| 9 | `MISC` | JSON | Miscellaneous data (`{key, value}`; currently — a name replacement in localStorage) |
| 10 | `PING` | JSON | A ping id for RTT measurement |
| 11 | `CLEAR` | JSON | A full or partial (by `setId`) canvas cleanup |
| 12 | `CONSOLE` | JSON | Free (reserved for console.log output) |
| 13 | `PANEL_DATA` | JSON | The HUD panel (per-user, only on change) |
| 14 | `STAT_DATA` | JSON | Statistics (broadcast, only on change) |
| 15 | `CHAT_DATA` | JSON | A chat message (broadcast or personal) |
| 16 | `VOTE_DATA` | JSON | Vote data |
| 17 | `KEYSET_DATA` | JSON | The active key set: `0` — spectator, `1` — player; sent on a status change |

### Client → server

| Port | Name | Description |
| :--: | --- | --- |
| 0 | `CONFIG_READY` | Config received, canvas ready |
| 1 | `AUTH_RESPONSE` | Authorization form data (`{name, model}`) |
| 2 | `MODULES_READY` | Client modules initialized |
| 3 | `MAP_READY` | Map loaded and built |
| 4 | `FIRST_SHOT_READY` | The first frame applied, the client is ready for the game loop |
| 5 | `KEYS_DATA` | Input: the string `"seq:action:name"` (see below) |
| 6 | `CHAT_DATA` | Message text / a chat command |
| 7 | `VOTE_DATA` | A vote answer `[voteName, value]` or a list request (`'maps'`, `'teams'`) |
| 8 | `PONG` | A reply to PING (the ping id) |

The server enables handling of client ports in stages ([src/server/socket/index.js](../../src/server/socket/index.js)): before authorization only `CONFIG_READY` is active, after it — `AUTH_RESPONSE`, after user creation — the rest. A message to an inactive port is ignored.

## Connection lifecycle

```
connect → origin check (security.origin)
  → CONFIG_DATA → CONFIG_READY
  → (queue if the server is full) → AUTH_DATA → AUTH_RESPONSE → AUTH_RESULT
  → createUser (spectator) → MODULES_READY → MAP_DATA → MAP_READY
  → FIRST_SHOT_DATA (+ full STAT/PANEL/KEYSET) → FIRST_SHOT_READY
  → the user is in the game loop (SHOT_DATA at 30 frames/sec) → removeUser on close
```

Details:

- **Origin**: a connection without an `Origin` header is dropped immediately; an invalid origin — a close with code `4001`.
- **oneConnection**: with the setting on, a new connection from the same IP closes the previous one (code `4002`, the "another device" screen).
- **Queue**: if the server is full, the client is queued (`waiting`) and receives `TECH_INFORM_DATA` with a position; when a slot frees up, it receives `AUTH_DATA`.
- **Close codes**: `4001` origin, `4002` another device, `4003` latency kick, `4004` missed-pings kick, `4005` idle kick.
- After `FIRST_SHOT_READY` the user receives the team-selection vote (`teamChange`) and joins the frame broadcast.

## Channel separation: the hot snapshot and meta

Each snapshot tick (`networkSendRate: 4` → 30 packets/sec) the server sends a binary port-`5` frame to **all ready** users. Meta data goes over **its own JSON channels and only on change** (see `VIMP._onShotTick` in [src/server/modules/VIMP.js](../../src/server/modules/VIMP.js)):

- **panel (13)** — per-user; an array of `'key:value'` strings (`t` — round time, `h` — health, `w1`/`w2` — ammo, `wa` — the active weapon). The full panel is sent on entering the game, an empty one (keys only) — to a spectator.
- **stat (14)** — broadcast, a delta of changes (format below).
- **chat (15)** — a broadcast message or a personal one (`shiftByUser`).
- **vote (16)** — a broadcast vote or a personal one.
- **keyset (17)** — pointwise on a spectator↔player status change. On a map change the server sends the spectator keySet (`0`) together with an empty panel **immediately**, right after `CLEAR` and before `MAP_DATA` — otherwise the client keeps considering itself a player while the new map is loading and resurrects its own tank through prediction.

## The binary snapshot frame (port 5)

The codec: [src/lib/snapshotCodec.js](../../src/lib/snapshotCodec.js) (`SnapshotPacker` on the server, `unpackFrame` on the client). The key registry and format version: [src/config/opcodes.js](../../src/config/opcodes.js) (`SNAPSHOT_FORMAT_VERSION = 3`). `DataView`, big-endian, a manual block layout without libraries. On a version mismatch the client drops the frame.

The server packs the **body** (the broadcast part) once per tick (`packBody`), then for each user assembles the frame `packFrame` = a personal header + a copy of the body.

### Frame layout (v3)

| Field | Type | Description |
| --- | --- | --- |
| `port` | Uint8 | Always `5` (SHOT_DATA) |
| `version` | Uint8 | `SNAPSHOT_FORMAT_VERSION` |
| `seq` | Uint32 | An incremental frame number |
| `serverTime` | Float64 | The server's `Date.now()` |
| `cameraFlags` | Uint8 | bit0 hasCamera, bit1 forceReset, bit2 hasShake, bit3 hasPlayer |
| camera | 2×Float32 | `[x, y]` (if hasCamera) |
| shake | Uint8 len + ASCII | The string `'intensity:duration'` (if hasShake) |
| player block | see below | Only for the playing user (if hasPlayer) |
| body blocks | to the end of the buffer | `Uint8 keyId` + content by `kind` |

**The player block** (the foundation of client-side prediction): `gameId` (Uint8), `lastInputSeq` (Uint32), the exact tank state Float32×8 — `x, y, angle, vx, vy, angvel, gunRotation, throttle` (**no rounding** — the predictor needs the precision), the turret-centering flag (Uint8).

### Entity blocks (`kind` from `SNAPSHOT_KEYS`)

| Key | id | kind | Data format |
| :--: | :--: | --- | --- |
| `m1` | 1 | `tanks` | `{gameId: [x, y, angle, gunRotation, vx, vy, engineLoad, condition, size, teamId] \| null}`; `null` — remove from the canvas |
| `w1` | 2 | `tracers` | array `[startX, startY, endX, endY, bodyX, bodyY, wasHit, shooterId]` |
| `w2` | 3 | `bombs` | `{shotId(base36): [x, y, angle, size, time, ownerId] \| null}` |
| `w2e` | 4 | `explosions` | array `[x, y, radius]` |
| `c1`/`c2` | 5/6 | `dynamics` | `{'dN': [x, y, angle]}` — dynamic map elements |

All floats are initially rounded by the server to 2 decimals; the decoder restores the values by re-rounding to Float32. Weapon events carry the author id (`shooterId`/`ownerId`, added in v3) — by it the shooter suppresses server duplicates of locally spawned shots (`ShotPredictor.filterServerSnapshot`).

When adding a new weapon/entity, its snapshot key **must** be registered in `SNAPSHOT_KEYS`, otherwise `packBody` throws an error. If the existing `kind`s do not fit — add a new block layout in `snapshotCodec.js` and bump the format version. See [extending.md](extending.md#new-weapon).

## Input format: `"seq:action:name"`

The client sends every key event as a string to port `5` (client → server):

- `seq` — an incremental input number (Uint32), written to the predictor's local history;
- `action` — `down` | `up`;
- `name` — the command (`forward`, `fire`, `nextPlayer`, …).

The server stores the user's `lastInputSeq` and returns it in the frame's player block — this is how the client learns which inputs are already accounted for by the authoritative state and replays (reconciliation) only the later ones. Details are in [client.md](client.md#tankpredictor).

For a spectator the same strings are handled by the server as switching the observed player (`nextPlayer`/`prevPlayer`).

## RTT (ping/pong) and kicks

Every `rttPingInterval` (3 s) `TimerManager` broadcasts `PING` (port 10) with an id; the client replies `PONG` (port 8). [RTTManager](../../src/server/modules/RTTManager.js) computes the latency, publishes it into the statistics (the `latency` column), and kicks:

- on `latency > maxLatency` (300 ms) — code `4003`;
- on `maxMissedPings` (5) missed replies in a row — code `4004`.

## Meta data formats

### Panel (port 13)

An array of `'key:value'` strings, for example `['t:97', 'h:100', 'w1:200', 'wa:w1']`. Only changed keys are sent; `t` (round time, sec) — on every second change. The empty panel (for a spectator) — time + a list of keys without values (the containers are hidden).

### Statistics (port 14)

`statArray = [tBodies, tHead, fullUpdate?]` (produced by [src/server/modules/Stat.js](../../src/server/modules/Stat.js)):

- **`statArray[0]`** — table rows: `[row id, table number, array of cells | null, tbody number]`. `null` instead of cells — remove the row; an empty string in a cell — clear the value; `undefined`/omission — leave unchanged.
- **`statArray[1]`** — headers: `[table number, array of cells, tHead row number]`.
- **`statArray[2]`** — a full-update flag (boolean, optional).

A player row's cells: `[name, status, score, deaths, latency]` (the order is the `key` from `game:stat`).

### Chat (port 15)

- A user message: `[text, author name, teamId]`.
- A system message: the string `'group:number:comma,separated,params'` — the client builds the text from the `messages` templates of its config (groups `s`, `v`, `m`, `c`, `n`, `b`).

### Vote (port 16)

The server sends a `payload`:

- `name` — the vote name/type (the client looks up the template in `client.js → modules.vote.params.templates`);
- `params` — optional; strings to substitute into the `{0}`, `{1}` placeholders of the title;
- `values` — optional; an array of ready options **or** a command string (`'maps'`, `'teams'`) — the client requests the actual list from the server (port 7 client → server).

The client's answer: `[voteName, selectedValue]`. A dynamic-list request: the string `'maps'` | `'teams'`.
