# Extending the game

Guides for adding content. The general project rule: new entities are made in the same style as the existing ones (there are no fixed contracts — existing files serve as templates), and every change ends with green `npx eslint .` and `npm test` with the new code covered by tests.

## New map

1. Create `src/data/maps/<name>.js` following the existing ones (e.g. [pool_mini.js](../../src/data/maps/pool_mini.js)). Format:
   - `setId` — the snapshot key of the map constructor (`c1`/`c2`);
   - `scale` — the map scale;
   - `spriteSheet` — the tile image and the frames `[x, y, w, h]`;
   - `layers` — the distribution of tiles across rendering layers (1 — under tanks, 2 — the tank level, 3+ — above);
   - `physicsStatic` — the numbers of tiles that are walls (static physics and the client raycast are built from them);
   - `physicsDynamic` — dynamic physical objects (they move, sent in the snapshot);
   - `step` — the tile size;
   - `respawns` — per-team spawn points: arrays `[x, y, angle]`;
   - `map` — the tile matrix.
2. Register the map in [src/data/maps/index.js](../../src/data/maps/index.js) — the object key becomes the name in votes and for `TANK_BATTLE_MAP`.

## New weapon

There are two architecturally different types (see [server.md](server.md#physical-parts-srcserverparts)):

- **Hitscan** (example `w1`): the hit is computed instantly with a ray via `HitscanService`; there is no physical projectile — only the result.
- **Explosive** (example `w2`): a physical projectile (`Bomb`) is created in the Rapier world, lives in the physics loop, is sent to the client as a snapshot entity, and explodes on a timer.

Steps:

1. Define the weapon in [src/data/weapons.js](../../src/data/weapons.js) (type, damage, cooldown, consumption, etc.).
2. Implement the server part in `src/server/parts/` by analogy with an existing weapon of the same type.
3. Create the client rendering in `src/client/parts/`.
4. Register the entity in `src/config/client.js`: `parts.gameSets` (snapshot key → classes) and `parts.entitiesOnCanvas` (class → canvas).
5. Register the weapon's snapshot keys (and those of its effects) in `SNAPSHOT_KEYS` in [src/config/opcodes.js](../../src/config/opcodes.js) — an unregistered key will crash frame packing (`SnapshotPacker.packBody` throws an error). If the existing `kind`s do not fit the data format — add a new block layout in [src/lib/snapshotCodec.js](../../src/lib/snapshotCodec.js) and bump the format version.
6. Pass the **author id** as the last element of the event/entity data (like `shooterId` for `w1` and `ownerId` for `w2`) — by it `ShotPredictor` suppresses server duplicates of the client spawn; it supports the `hitscan`/`explosive` types automatically from the weapon config.
7. Add ammo in `game.js` (`panel`) and a panel key in `client.js` (`modules.panel`).

## New sound

1. Add an entry in [src/config/sounds.js](../../src/config/sounds.js): `file`, `priority`, `volume`, optionally `loop`.
2. Place the audio file in `public/sounds/` in the **`.webm` and `.mp3`** formats (the codec list is `codecList`).
3. Playback: UI/system — `soundManager.playSystemSound(name)`; spatial — `registerSound(name, { position })` (the voice limit and priorities are respected by `SoundManager`, see [client.md](client.md#soundmanager)).

## New client entity (part)

1. Create a class in `src/client/parts/` following the existing ones (`Tank`, `Bomb`, effects in `parts/effects/`) and export it in `parts/index.js` — it will enter the `Factory` registry.
2. Declare it in `gameSets`/`entitiesOnCanvas` (`src/config/client.js`).
3. If a procedural texture is needed — add a baker in `src/client/providers/bakers/` (follow the existing ones) and an entry in `bakedAssets`.
4. If services (`renderer`, `soundManager`) are needed — add the class to `componentDependencies`.

Entities can be subclassed and displayed on different canvases: for example, a simplified class is created for the radar (like `MapRadar` from `Map`).

## Tests

New code is covered by tests in `tests/` (the structure mirrors `src/`). The patterns are in CLAUDE.md (the Testing section): singletons via `vi.resetModules()` + dynamic import, physical parts — with `world`/`body` mocks, integration scenarios — in `tests/server/integration/`. When changing the tank movement model, running the parity test `TankPredictorParity` is mandatory.
