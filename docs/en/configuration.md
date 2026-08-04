# Configuration

The project's configuration is split into three levels:

1. **Environment variables** (`.env`) — parameters of a specific server instance (domain, port, map, limits). Applied in production only.
2. **`src/config/`** — shared configs used by both the server (Node.js) and the client (Vite bundle).
3. **`src/data/`** — static game data: maps, models, weapons.

On the server, the configs are assembled into a single store `src/lib/config.js` (accessed by a colon-separated path, e.g. `config.get('game:timers:roundTime')`) in [src/server/main.js](../../src/server/main.js). The client receives its config (`client`) over WebSocket on connection (port `0`).

## Environment variables (.env)

Read in [src/server/main.js](../../src/server/main.js) when `NODE_ENV=production` (the `npm start` run uses `node --env-file .env`). In development mode they are ignored — the values from `src/config/` apply.

| Variable | Purpose | Default |
| --- | --- | --- |
| `NODE_ENV` | `production` / `development` | — |
| `TANK_BATTLE_DOMAIN` | The server domain. **Required** in production (otherwise the server exits with an error) | `localhost` |
| `TANK_BATTLE_PORT` | The Node.js app port | `3000` |
| `TANK_BATTLE_PLAYERS` | Maximum players (`game:maxPlayers`) | `30` |
| `TANK_BATTLE_MAP` | The starting map (must exist in `src/data/maps/index.js`) | `pool mini` |
| `TANK_BATTLE_ROUND_TIME` | Round time, ms | `120000` |
| `TANK_BATTLE_MAP_TIME` | Map time, ms | `600000` |
| `TANK_BATTLE_FRIENDLY_FIRE` | `true`/`false` — friendly fire | `false` |

In development mode `main.js` additionally forces `server:oneConnection = false` (allows multiple tabs from one IP) and `game:isDevMode = true`.

## src/config/game.js — server game parameters

Source: [src/config/game.js](../../src/config/game.js). Imports maps, models, and weapons from `src/data/`.

### Main parameters

| Parameter | Value | Description |
| --- | --- | --- |
| `maxPlayers` | `30` | The participant limit (humans + bots, a single id space) |
| `chatMaxLength` | `60` | The maximum chat message length (authoritative on the server; must match the input's `maxlength` in `chat.pug`) |
| `parts.friendlyFire` | `false` | Damage to your own team |
| `parts.mapConstructor` | `'Map'` | The map constructor name |
| `parts.hitscanService` | `'HitscanService'` | The hitscan shot computation service |
| `mapScale` | `0.3` | Map scale |
| `currentMap` | `'pool mini'` | The default map |
| `mapsInVote` | `4` | The number of maps in a vote |
| `mapSetId` | `'c1'` | The default snapshot key of the map constructor |
| `spectatorTeam` | `'spectators'` | The spectator team name |
| `teams` | `team1: 1, team2: 2, spectators: 3` | Teams and their ids |

### Timers (`timers`, ms)

| Parameter | Value | Description |
| --- | --- | --- |
| `timeStep` | `1000/120` | The server physics tick step (~120 Hz) |
| `networkSendRate` | `4` | A snapshot is sent every Nth tick (4 → 30 packets/sec) |
| `roundTime` | `120000` | Round time |
| `mapTime` | `600000` | Map time |
| `voteTime` | `10000` | The vote window lifetime |
| `timeBlockedVote` | `30000` | The cooldown between votes on one topic |
| `teamChangeGracePeriod` | `10000` | The team-change window at the start of a round |
| `roundRestartDelay` | `5000` | The pause between rounds |
| `mapChangeDelay` | `2000` | The pause before a map change after a vote |
| `rttPingInterval` | `3000` | The RTT ping interval |
| `idleCheckInterval` | `30000` | The inactivity check frequency |

### Kicks (`rtt`, `idleKickTimeout`)

- `rtt.maxMissedPings: 5` — the number of consecutive missed pong replies before a kick;
- `rtt.maxLatency: 300` — the latency (ms) above which a player is kicked;
- `idleKickTimeout.player: 120000` — kicking a player for inactivity (2 minutes);
- `idleKickTimeout.spectator: null` — `null` disables the kick (spectators are not kicked).

### Statistics (`stat`)

Describes the scoreboard columns. For each parameter:

- `key` — the ordinal number of the cell in the row;
- `bodyMethod` — the update method in the table body (`=` — replace, `+` — add);
- `bodyValue` — the default value;
- `headSync` — synchronize body with head;
- `headMethod` — the update method in the header (`#` — count of values, `=` — replace, `+` — add);
- `headValue` — the default header value.

Current columns: `name` (0), `status` (1), `score` (2), `deaths` (3), `latency` (4).

### HUD panel (`panel`)

The string keys and default values of a player's resources (updated every round):

- `health` → key `h`, value `100`;
- `w1` → key `w1`, `200` rounds;
- `w2` → key `w2`, `100` bombs.

The client mapping of keys to DOM elements — in `client.js` (`modules.panel.keys`, including `t` — time and `wa` — the active weapon).

### Keys (`spectatorKeys`, `playerKeys`)

`spectatorKeys` — the spectator commands (`nextPlayer`/`prevPlayer`).

`playerKeys` — the player commands. Each key has a bit mask `key` (`1 << n`, used by the predictor and the server in the input history) and an optional `type`:

- `type: 0` (default) — a repeated action: starts on keyDown, ends on keyUp (movement, turret turning);
- `type: 1` — fires once on keyDown (`gunCenter`, `fire`, `nextWeapon`, `prevWeapon`).

The keyCode → command mapping is defined on the client (`client.js` → `modules.controls.keySetList`).

## src/config/client.js — the client config

Source: [src/config/client.js](../../src/config/client.js). Sent to the client on connection. Before sending, the server appends to it:

- `modules.vote.params.time` = `game:timers:voteTime`;
- `prediction` — the data for the client movement and shooting replica (`timeStep`, `playerKeys`, `models`, `weapons`) — assembled in [src/server/main.js](../../src/server/main.js).

### `parts` — game entities

- **`gameSets`** — the mapping of snapshot keys to rendering classes:

  ```js
  gameSets: {
    c1: ['Map', 'MapRadar'],
    c2: ['Map'],
    m1: ['Tank', 'TankRadar', 'Smoke', 'Tracks'],
    w1: ['ShotEffect'],
    w2: ['Bomb'],
    w2e: ['ExplosionEffect'],
  }
  ```

  One key can create several entities (a tank is drawn on both the main canvas and the radar, plus smoke and track marks).

- **`entitiesOnCanvas`** — which canvas (`vimp` or `radar`) each class is drawn on. Entities can be subclassed and displayed on different canvases (e.g. `MapRadar` — a simplified map for the radar).

- **`bakedAssets`** — procedural textures "baked" once at startup (`BakingProvider`): explosions, particles, smoke, the tank, the bomb, track marks, radar markers. Each entry: `name` (the texture id), `component` (who it is assigned to), `params` (generation parameters).

- **`componentDependencies`** — which services are injected into components (`renderer` → Map; `soundManager` → ExplosionEffect, ShotEffect, Bomb, Tank).

### `interpolation` — snapshot interpolation

- `delay: 100` — ms; the world is rendered in the past (`renderTime = serverNow − delay`), ~3 frames at 30 packets/sec;
- `maxFrameAge: 1000` — a safety cleanup of old buffer frames.

### `modules.canvasManager` — canvases and camera

`canvases` — the keys correspond to the ids of the canvas elements in HTML:

| Parameter | Description |
| --- | --- |
| `aspectRatio` | The aspect ratio (`'16:9'`). The canvas fills the maximum of the window while keeping the ratio. Without the parameter — 100% of the window |
| `fixSize` | A fixed size in px (`'150'` — a square, `'200:100'` — a rectangle). Disables `aspectRatio` and adaptive scaling |
| `baseScale` | The base zoom (`'Numerator:Denominator'`). For adaptive canvases — the scale at the reference width of 1920px (`result = width/1920 × baseScale`); for fixed ones — a constant multiplier |
| `dynamicCamera` | Enables the dynamic camera (look-ahead + speed-based zoom) |
| `shakeCamera` | Allows camera shake |

Adaptive scaling guarantees the same field of view on any monitor (the reference is Full HD 1920px).

`dynamicCamera` (common parameters): `lookAheadFactor` (the camera offset forward along movement), `zoomOutFactor`/`maxZoomOut` (zooming out with speed), `smoothnessPosition`/`smoothnessZoom`/`smoothnessVelocity` (smoothness).

Current canvases: `vimp` (16:9, zoom 5:1, dynamic camera, shake) and `radar` (150×150px, scale 1:8).

### `modules.controls` — controls

- **`keySetList`** — an array of two `keyCode: 'command'` sets: `[0]` — spectator (`n`/`p` — switching the observed player), `[1]` — player (`w/s/a/d` — movement, `k/l/u` — the turret, `j` — fire, `n/p` — weapon switching). Which set is active is dictated by the server via port `17` (KEYSET_DATA).
- **`modes`** — UI modes: `c` — chat, `m` — vote, `tab` — statistics.
- **`cmds`** — utility keys (`escape`, `enter`), they have the highest priority and are used inside modes.

### Other modules

- **`chat`** — chat DOM element ids, output limits (`listLimit: 5` lines, `lineTime: 15000` ms), the cache, and the **system message templates** (`messages`): groups `s` (statuses/commands), `v` (votes), `m` (maps), `c` (teams), `n` (names), `b` (bots). The server sends only `'group:number:params'`, the client builds the text.
- **`panel`** — panel element ids and the mapping of server keys (`t`, `h`, `wa`, `w1`, `w2`) to elements; `healthAnimation` (`blocks`/`delay`/`duration`) parametrizes the round-start health bar fill (see [client.md](client.md#mvc-components-srcclientcomponents)).
- **`stat`** — the ids of header/body tables (`heads`, `bodies`) and `sortList` — sorting parameters: an array of pairs `[cell number, descending?]`; on a tie the comparison moves to the next pair.
- **`vote`** — DOM ids/classes and the **vote templates** (`templates`): `[title with placeholders {0}, options (an array — static, a string — request a list from the server), timeOff]`. `menu` — the items of the main vote menu.
- **`gameInform`** / **`techInformList`** — templates of game messages (victory, round start) and technical screens (server full, idle/latency kick, etc.).

## src/config/server.js

- `name` — the game name;
- `protocol`, `domain`, `port` — the address (overridden by `.env` in production);
- `httpsOptions` — the paths to the local certificates `.certs/key.pem`/`cert.pem` (development only; in production Nginx terminates HTTPS);
- `oneConnection: true` — on a new connection from the same IP the previous one is dropped (disabled automatically in dev mode).

## src/config/auth.js

The authorization form: DOM element ids (`elems`) and form parameters (`params`). Each parameter: `name`, a default value, a `validator` (a function from [src/lib/validators.js](../../src/lib/validators.js): `isValidName`, `isValidModel`), and a `storage` key for localStorage. Validation is done both on the client and again on the server.

## src/config/sounds.js

The sound catalog. Each sound: `file` (the file name without extension in `public/sounds/`), `priority` (higher — more important when competing for voices), `volume`, optionally `loop: true`. `codecList: ['webm', 'mp3']` — the files must exist in both formats. More on the playback system — in [client.md](client.md#soundmanager).

## src/config/wsports.js and src/config/opcodes.js

- **`wsports.js`** — the registry of numeric WebSocket message ports (the source of truth). Full tables — in [network.md](network.md#ports).
- **`opcodes.js`** — the binary snapshot format version (`SNAPSHOT_FORMAT_VERSION = 3`) and the `SNAPSHOT_KEYS` registry (`m1`, `w1`, `w2`, `w2e`, `c1`, `c2` → a numeric id + `kind`, which defines the byte layout of the block). An unregistered key will crash frame packing. Details — in [network.md](network.md#the-binary-snapshot-frame-port-5).
- **`gamecodes.js`** — `GAME_CODES` (`winnerTeam`/`roundStart`/`gameOver`), the numeric codes sent over the `GAME_INFORM_DATA` port. Indices must match the message positions in `client.js` → `gameInform.list`. Shared between `SocketManager` (server) and `main.js` (client, to trigger the round-start logo/health animations) to avoid duplicating the magic numbers.

## src/data/ — game data

### models.js

The only model is the `m1` tank ([src/data/models.js](../../src/data/models.js)): the `Tank` constructor, starting weapon `w1`, size (`size: 2`, dimensions `size×4 : size×3`), movement parameters (acceleration/braking, `maxForwardSpeed: 260`, `maxReverseSpeed: −130`, turning torque, damping, lateral grip), physics (`density`, `friction`, `restitution`), the "driving feel" (thresholds and throttle/turn speeds) and the turret (`maxGunAngle: 1.4` rad, turning/centering speeds).

> ⚠️ The `models.js` coefficients are used by both the server and the client movement replica (`TankPredictor`). Their change is verified by the parity test `tests/server/TankPredictorParity.test.js`.

### weapons.js

Two architecturally different weapon types ([src/data/weapons.js](../../src/data/weapons.js)):

| | `w1` (bullet) | `w2` (bomb) |
| --- | --- | --- |
| Type | `hitscan` — an instant ray, no physical projectile | `explosive` — a physical `Bomb` projectile in the Rapier world |
| Damage | 40 | 70 at the epicenter, explosion radius 50 |
| Range | 1500 units | — (detonation on a `time: 300` ms timer) |
| Cooldown | 0.01 s | 0.1 s |
| Other | `spread: 0`, consumes 1 round | `size: 8`, explosion impulse `2000000`, effect `w2e` |
| Camera shake | 20px / 200ms | 30px / 400ms |

### maps/

Three maps: `pool mini` (small), `canopy`, `garden`. Each describes tile layers (`layers`, `tiles`), respawn points (`respawns`), static (`physicsStatic`) and dynamic (`physicsDynamic`) physics. Registration — in [src/data/maps/index.js](../../src/data/maps/index.js). How to add a map — see [extending.md](extending.md#new-map).
