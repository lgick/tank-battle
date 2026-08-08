# TESTING TODO

Оставшаяся тестовая работа. Базовое покрытие (578 тестов, 61 файл) уже есть —
вся логика `lib/`, серверные модули с логикой, клиентские модели/контроллеры/view
и интеграционный слой. Этот файл — живой список того, что ещё **стоит** покрыть.

Соглашения и паттерны тестирования описаны в `CLAUDE.md` → раздел **Testing**.

## Уже покрыто

`lib/*`; server: Stat, Vote, RTTManager, SnapshotManager, Panel, Chat,
TimerManager, Pathfinder, SpatialManager, NavigationSystem, HitscanService,
BaseModel, Bomb, Map, Tank, BotManager, SocketManager, Game, изолированные
методы VIMP; client-модели: Chat, Vote, Controls, Stat, Panel, Auth, Game,
CanvasManager; InputListener; SoundManager (`processAudibility`).

## Осталось

### Tier A.1 — деуглубление геймплейных модулей (высокий ROI) ✅ ВЫПОЛНЕНО

Добить непокрытые методы уже протестированных модулей (моки `world`/`body`/
`panel` уже отработаны в `Tank.test.js`/`Game.test.js`/`Bomb.test.js`).

- [x] `Tank.updateData(dt)` — битмаска клавиш, поворот/центрирование башни,
      сборка `_shotData` при `fire`, смена оружия.
- [x] `Game`: `updateData` (фикс-степ аккумулятор), `_processContactEvents`,
      `getEvents`, `getWorldState`, `_createWeaponAction`.
- [x] `SoundManager`: `registerSound`/`unregisterSound`/`updateSoundData`/
      `getSoundConfig`/`setListenerPosition` (через прототип).
- [x] `TimerManager`: игровой цикл `_loopTick`/`_startGameLoop` (fake timers).

### Tier A.2 — клиентские контроллеры ✅ ВЫПОЛНЕНО

`src/client/components/controller/*.js` (8 файлов): тонкая проводка model↔view
с небольшой логикой (напр. `ChatCtrl.updateCmd`). Моки `model` + `view`
(реальный `Publisher`). Синглтоны → `vi.resetModules()`.

- [x] Auth, CanvasManager, Chat, Controls, Game, Panel, Stat, Vote

### Tier B — клиентские view (DOM, happy-dom) ✅ ВЫПОЛНЕНО

`src/client/components/view/*.js` (8 файлов). Засеять `document.body.innerHTML`
нужными id, создать view с фейковым `model`, эмитить события и проверять DOM.
Начать с малых: Controls, CanvasManager, Game.

- [x] Controls, CanvasManager, Game, Chat, Auth, Vote, Panel, Stat

**Особенности happy-dom 20** (учтены в тестах):
- не хранит `style.display = 'table-cell'` (возвращает `''`) — в `PanelView`
  проверяется содержимое, а не значение `display`;
- не реализует `HTMLTableSectionElement.rows`/`namedItem` — в `StatView.test.js`
  добавлен тонкий полифилл живого геттера `.rows` (insertRow/insertCell/cells/
  sectionRowIndex работают штатно);
- `localStorage` не выставлен глобально — в `AuthView` подменяется через
  `vi.stubGlobal`.

### Tier D — BotController ✅ ВЫПОЛНЕНО

`src/server/modules/bots/BotController.js`. Моки `game`/`vimp._bots`/`panel`/
`spatialManager`; `planck` Vec2/Rot реальные. Покрыть: `_setKeyState`,
`releaseAllKeys`, `_updateCachedData`, `findClosestEnemy`, `makeDecision`,
`moveTo`, `calculateNewCombatPosition`, `update` (ветка DEAD), `destroy`.

- [x] `_setKeyState`, `releaseAllKeys`, `_updateCachedData`, `findClosestEnemy`,
      `makeDecision`, `moveTo`, `calculateNewCombatPosition`, `update` (DEAD),
      `destroy`

## Остаточные пробелы (по `test:coverage`, опционально)

Тиры A–D закрыты, но прогон покрытия показал точечные зоны со средним ROI:

- [x] **`BotController` (~85%, было 45%)**: добавлены `executeMovement`,
      `executeAimAndShoot`, `handleClearingObstacle`, `avoidObstacles`,
      `followPath`, `setNewPatrolTarget`. Прицеливание (использует `randomRange`)
      вынесено в `BotControllerAim.test.js` с моком `randomRange → 0`.
- [x] **`VIMP` (~66%, было 3.5%)**: изолируемые методы покрыты юнит-тестами
      (`VIMP.test.js`), а оркестрация (`_onShotTick`, `createUser`/`removeUser`,
      `_startRound`, `_changeTeam`, `_changeMap`, `_parseCommand`, конструктор) —
      интеграционными (`integration/lifecycle.test.js`).
- [x] **`SocketManager` (~96% функций, было 57%)**: добавлены все sender-методы.
- [x] **`Game` (~83%, было 63%)**: `_removeShots`, `removePlayersAndShots`,
      `clear` + прогон через реальный игровой цикл в интеграции.
- [x] **`socket/index.js` (~97%, было 0%)**: протокольный слой покрыт
      интеграцией (`integration/protocol.test.js`).

### Интеграционные / e2e тесты ✅ ВЫПОЛНЕНО

`tests/server/integration/` (подхватывается glob `tests/server/**`, гоняется
обычным `npm test`). In-process, без реальной сети.

- **`harness.js`** — `loadConfig()` (реальные конфиги в свежий `config`),
  `FakeSocketManager` (пишет wire-кадры), `createVimp()`/`connectPlayer()`/
  `joinTeam()`/`tick()`/`pressKey()`. Изоляция синглтонов: `vi.resetModules()` +
  `vi.useFakeTimers()` ДО конструктора VIMP; игровой цикл двигаем прямыми
  `_onShotTick`; колбэки на `process.nextTick` ждём через `await nextTick()`.
- **`lifecycle.test.js`** — реальный VIMP + реальные модули (физика planck):
  онбординг, спектатор/активный игрок, движение, стрельба (w1 в снапшоте),
  чат/команды, убийство→конец раунда (полный путь `Game.applyDamage`→`reportKill`
  →`_checkTeamWipe`), смена карты, idle-кик, дисконнект, RTT.
- **`protocol.test.js`** — реальный `socket/index.js` через `vi.mock('ws')` с
  фейковым транспортом: рукопожатие, auth ok/невалид, порт-гейтинг, полная цепочка
  до игры, дисконнект. Проверяет кадры `[port, payload]`.

✅ Исправлено: `lib/security.js` (`origin`-allowlist, был 0%) —
покрыт `tests/lib/security.test.js` (dev/prod ветки).

## Вне scope (unit-тесты нецелесообразны)

- **Pixi-рендеринг**: `src/client/parts/**`, `src/client/providers/**` —
  нужны моки PixiJS renderer; уместнее визуальные/e2e тесты. Исключение —
  применение данных внутри part'а: `Bomb.update` (авторитетная коррекция
  позиции) покрыт `tests/client/parts/Bomb.test.js` с моком `pixi.js`.
- **Entry/IO**: `src/client/main.js`, `src/server/main.js` — на импорте поднимают
  сервер/Vite/сертификаты, тестировать нецелесообразно. (`socket/index.js` уже
  покрыт интеграцией, см. выше.)
- `_*`-файлы/директории (игнор по правилам), `src/config/*`, `src/data/*`.

## Будущие фичи (тестировать после реализации)

- Бинарный формат снапшотов (порт `5`).
- Client-side prediction / reconciliation.

## Проверка

`npm test` (полный прогон), `npm run test:coverage`, `npx eslint tests/`.
Прицельно: `./node_modules/.bin/vitest run tests/<path>`.
