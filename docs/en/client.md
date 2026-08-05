# Client modules and systems

The client is a browser application built on PixiJS (a Vite build, Pug templates in [src/client/views/](../../src/client/views/)). The entry point is [src/client/main.js](../../src/client/main.js).

## main.js — the dispatcher and render loop

- Opens a WebSocket and branches incoming messages by the type of `e.data`: a string → JSON `[portId, payload]` → the `socketMethods[portId]` handler; an `ArrayBuffer` → `unpackFrame` → the `SnapshotInterpolator` buffer (a version mismatch drops the frame).
- On `CONFIG_DATA` (port 0) it initializes all modules: PixiJS `Application`s, MVC components, `BakingProvider` (texture baking), `SoundManager`, the predictors; it replies `CONFIG_READY`.
- The first frame (`FIRST_SHOT_DATA`, port 4) is applied immediately, bypassing the interpolation buffer.
- **The render loop** `renderTick` on `Ticker.shared` (rAF): the interpolator's `sample()` → applying frames/interpolation → own-tank prediction on top (`applyGameData`) → the camera.
- Resets: a map change (`MAP_DATA`) and `CLEAR` clear the interpolation buffer and the predictors.

## MVC components (src/client/components/)

Eight `model/` + `view/` + `controller/` triplets: **Auth**, **CanvasManager**, **Controls**, **Game**, **Chat**, **Panel**, **Stat**, **Vote**.

The Publisher pattern for links inside a triplet:

- `main.js` or `view` → `controller` methods are called **directly**;
- `controller` → `model` methods are called **directly**;
- `model` → `view` — **through `Publisher`** ([src/lib/Publisher.js](../../src/lib/Publisher.js)): the model publishes an event, the view is subscribed; external subscribers may also subscribe to the model.

The purpose of the components:

- **Auth** — the login form (name, model), client-side validation (`validators.js`), localStorage.
- **CanvasManager** — manages several PixiJS `Application`s at once: `vimp` (the main game canvas) and `radar` (the minimap). Adaptive scaling (a 1920px reference), `aspectRatio`/`fixSize`/`baseScale`, a dynamic camera (look-ahead, speed-based zoom) and shake — parameters in [configuration.md](configuration.md#modulescanvasmanager--canvases-and-camera).
- **Controls** — keyboard capture (`InputListener`), the active key set is dictated by the server (port 17), the `chat`/`vote`/`stat` modes, sending input as `"seq:action:name"`.
- **Game** — the rendering core: `GameCtrl.parse(name, data)` creates/updates/removes entity instances from snapshot data via `Factory`.
- **Chat** — displaying messages (line limit, lifetime), the command line; escaping on output (`textContent`).
- **Panel** — the HUD: round time, health, ammo, active weapon (from `'key:value'` strings). On round start (`GAME_INFORM_DATA` code `GAME_CODES.roundStart`, `src/config/gamecodes.js`), `main.js` calls `logoAnimation.js`'s `playLogoRoundStart()` (a CSS wave animation on `#logo`, `logo-round-start` class) and `PanelCtrl.playRoundStart()`, which fills the health bar block-by-block left to right toward the last known health value (the panel's `h:` value is not guaranteed to arrive before `roundStart`, so the view always tracks the latest value regardless of animation state, and a real health drop during the fill interrupts it immediately). Both animations respect `prefers-reduced-motion` (`src/lib/motion.js`). `PanelCtrl.reset()` is called on `PS_CLEAR` (map change) to stop the fill and forget the last known health.
- **Stat** — the scoreboard tables with sorting (`sortList`), shown on Tab.
- **Vote** — vote windows from templates, pagination, a lifetime timer.

## Network smoothing (Phases 5a–5c)

### SnapshotInterpolator

[src/client/SnapshotInterpolator.js](../../src/client/SnapshotInterpolator.js) — port-5 frames are not applied immediately but buffered; the world is rendered in the past:

- server time is estimated by an EMA offset (`serverTime − localNow`), `renderTime = serverNow − delay` (config `interpolation.delay: 100` ms);
- `sample()` emits frames crossed by `renderTime` **in full exactly once** (the `w1`/`w2e` events, creation/removal, camera reset/shake), and interpolates continuous values between adjacent frames: tanks `m1` (x/y/vx/vy/engineLoad — `lerp`, angles — `lerpAngle` from [src/lib/math.js](../../src/lib/math.js)), map dynamics `c1`/`c2`, the camera;
- keys are classified by `kind` from `SNAPSHOT_KEYS` (`opcodes.js`); there is no extrapolation — hold on the last frame; the buffer is reset on a map change and `CLEAR`.

### TankPredictor

[src/client/TankPredictor.js](../../src/client/TankPredictor.js) — client-side prediction of the own tank:

- a local replica of the server movement model (`Tank.updateData` without Rapier collisions) at a fixed `timeStep`; the replica's parameters arrive in the port-0 config (`prediction`: timeStep/playerKeys/models/weapons);
- input is written to a local history (`{time, keysMask, oneShotMask}`) and sent to the server as `"seq:action:name"`;
- **reconciliation**: from the frame's player block (`gameId`, `lastInputSeq`, the exact state) state := server → replay the input history from the frame's `serverTime` up to the estimate of the server "now"; the discrepancy goes into `visualError` and fades exponentially (a snap on a large discrepancy);
- rendering: the predicted state overrides interpolation through the same `parse` pipeline, the camera follows the predicted position;
- resets: `camera[2]` (respawn/teleport), a keySet change, a map change; on `condition 0` (death) prediction is frozen;
- `reset()` clears the state **completely** (including `hasState`/`state`/`frozen`) — there is nothing to render until the next player block arrives. On `CLEAR` and `MAP_DATA` the own-tank identity is cleared alongside it (`OwnTank.reset()`); otherwise prediction would resurrect the tank on an already-cleared canvas (together with a looping engine sound).

⚠️ The replica's accuracy is fixed by the parity test `tests/server/TankPredictorParity.test.js` (real Rapier against the replica). Integration order (empirical, fixed by the test): impulses → integrating positions by velocity before damping → damping `v *= 1/(1+dt·d)`.

### OwnTank

[src/client/OwnTank.js](../../src/client/OwnTank.js) — the own tank's bookkeeping, extracted from `main.js`:

- holds the identity (`gameId` from the frame's player block, the model name from the auth form) and the discrete snapshot fields the predicted state does not carry (`condition`/`size`/`teamId`);
- `track(frame)` — per crossed frame: resets prediction on `camera[2]`, refreshes the meta, freezes prediction on `condition 0`, drops the meta when the tank leaves the canvas;
- `getRenderData()` — `null` or `{ game, position }` for `renderTick`: the ghost barrier lives here, the result is `null` while there is no predicted state or the identity/meta are cleared;
- `canFire()` — the fire gate of `ShotPredictor.tryFire` (a predicted state and a living tank);
- `reset()` — clears the identity and calls `predictor.reset()`. Created next to the predictors when the port-0 config carries `prediction`. Covered by `tests/client/OwnTank.test.js`.

### ShotPredictor

[src/client/ShotPredictor.js](../../src/client/ShotPredictor.js) — immediate visual spawning of the own tank's projectiles:

- on pressing fire, the tracer (`w1`) and the bomb (`w2`) spawn immediately (together with the sound); physics, damage, and the explosion (`w2e`) are server-side;
- `tryFire` replicates the server gate: the `fireRate` cooldown, ammo from the panel, the active weapon (the local `nextWeapon`/`prevWeapon` cycle + the authoritative `'wa'`), the `Tank.getMuzzlePosition`/`getFireDirection` formulas;
- the tracer's end point is an approximate raycast ([src/lib/raycast.js](../../src/lib/raycast.js)): `rayVsGrid` (DDA over wall tiles) + `rayVsBox` (map dynamics and tanks) over interpolated positions;
- **the bomb gate**: the next `explosive` shot is allowed only after the previous one is confirmed by the server — this eliminates FIFO desync under high RTT;
- **RTT position compensation**: when a bomb spawns, the local position is extrapolated by `velocity × (RTT/2)` (estimated from `interpolator.offset`) so it matches the server position at the moment the command is processed;
- **suppressing server duplicates** (`filterServerSnapshot`) by the author id in the event data (`tracers[7]`, `bombs[5]`): own tracers — a FIFO pending queue with a 2 s timeout; the own bomb — on confirmation the local entity (`L<n>`) is removed and the server one becomes authoritative (the local key `L<n>` does not collide with the server's base36 keys).

## Rendering

### parts/ — entities

[src/client/parts/](../../src/client/parts/) — classes drawn on PixiJS canvases: `Tank` (a single class for both the own and other tanks), `TankRadar`, `Map`, `MapRadar`, `Bomb`, `Smoke`, `Tracks` (+`TrackMark`), `ParticlePool`. Effects — in `parts/effects/` (`BaseEffect`, `explosion/` — explosion/crater/smoke, `shot/` — tracer/hit), animated on `Ticker.shared`.

The mapping of snapshot keys to classes and their distribution across canvases — `gameSets`/`entitiesOnCanvas` in `client.js`. A part has no fixed contract — when creating a new one, look at the existing ones as a template.

### Factory

[src/lib/factory.js](../../src/lib/factory.js) — a registry of entity name → class. `GameCtrl.parse(name, data)` from incoming data creates an instance, calls `update(data)` on an existing one, or removes it (`null`).

### Providers

- **`BakingProvider`** ([providers/BakingProvider.js](../../src/client/providers/BakingProvider.js)) — one-time generation of procedural textures at startup per the `bakedAssets` config; the baking functions — in [providers/bakers/](../../src/client/providers/bakers/) (no fixed interface, follow the existing ones).
- **`DependencyProvider`** — injection of services (`renderer`, `soundManager`) into components per the `componentDependencies` map.

## SoundManager

[src/client/SoundManager.js](../../src/client/SoundManager.js) (on Howler.js). Sounds are described in `src/config/sounds.js`.

- **UI/system** (no position): `playSystemSound(name)` — immediately, bypassing priorities (also used for port-6 sounds).
- **Spatial** (a world position): `registerSound(name, { position })` → `processAudibility()` → `updateActiveSounds()` — the manager itself decides what is audible, respecting the voice limit (`WORLD_VOICE_LIMIT = 30`) and priorities from the config.
- `reset()` (map change, round start) drops **all** registrations, while the `parts` that survive it keep their `_soundId`. Owners re-register lazily: `updateSoundData(id, data)` returns `false` when the registration is gone, and `Tank.update` reacts by clearing `_soundId` and calling `_initSounds()` again — otherwise a surviving tank would stay silent forever (the engine sound is the only looping one).

## InputListener

[src/client/InputListener.js](../../src/client/InputListener.js) — low-level keydown/keyup capture for Controls; `modes`/`cmds` take priority over the game key set.

## UI hierarchy (z-index)

`vimp` (1) → `radar` (2) → `chat` (3) → `panel` (4) → `vote` (5) → `game-informer` (6) → `stat` (7) → `auth` (8) → `tech-informer` (9).
