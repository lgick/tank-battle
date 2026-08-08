# Клиентские модули и системы

Клиент — браузерное приложение на PixiJS (сборка Vite, шаблоны Pug в [src/client/views/](../../src/client/views/)). Точка входа — [src/client/main.js](../../src/client/main.js).

## main.js — диспетчер и рендер-цикл

- Открывает WebSocket и ветвит входящие сообщения по типу `e.data`: строка → JSON `[portId, payload]` → обработчик `socketMethods[portId]`; `ArrayBuffer` → `unpackFrame` → буфер `SnapshotInterpolator` (несовпадение версии — кадр отброшен).
- По `CONFIG_DATA` (порт 0) инициализирует все модули: PixiJS `Application`-ы, MVC-компоненты, `BakingProvider` (запекание текстур), `SoundManager`, предикторы; отвечает `CONFIG_READY`.
- Первый кадр (`FIRST_SHOT_DATA`, порт 4) применяется немедленно, минуя буфер интерполяции.
- **Рендер-цикл** `renderTick` на `Ticker.shared` (rAF): `sample()` интерполятора → применение кадров/интерполяции → предсказание своего танка поверх (`applyGameData`) → камера.
- Сбросы: смена карты (`MAP_DATA`) и `CLEAR` очищают буфер интерполяции и предикторы.

## MVC-компоненты (src/client/components/)

Восемь троек `model/` + `view/` + `controller/`: **Auth**, **CanvasManager**, **Controls**, **Game**, **Chat**, **Panel**, **Stat**, **Vote**.

Publisher-паттерн связей внутри тройки:

- `main.js` или `view` → методы `controller` вызываются **напрямую**;
- `controller` → методы `model` вызываются **напрямую**;
- `model` → `view` — **через `Publisher`** ([src/lib/Publisher.js](../../src/lib/Publisher.js)): модель публикует событие, view подписана; на модель могут подписываться и внешние подписчики.

Назначение компонентов:

- **Auth** — форма входа (имя, модель), клиентская валидация (`validators.js`), localStorage.
- **CanvasManager** — управляет несколькими PixiJS `Application` одновременно: `vimp` (основной игровой canvas) и `radar` (мини-карта). Адаптивное масштабирование (эталон 1920px), `aspectRatio`/`fixSize`/`baseScale`, динамическая камера (look-ahead, zoom от скорости) и тряска — параметры в [configuration.md](configuration.md#modulescanvasmanager--полотна-и-камера).
- **Controls** — перехват клавиатуры (`InputListener`), активный набор клавиш диктует сервер (порт 17), режимы `chat`/`vote`/`stat`, отправка ввода `"seq:action:name"`.
- **Game** — ядро рендеринга: `GameCtrl.parse(name, data)` создаёт/обновляет/удаляет экземпляры сущностей по снапшот-данным через `Factory`.
- **Chat** — вывод сообщений (лимит строк, время жизни), командная строка; экранирование на выводе (`textContent`).
- **Panel** — HUD: время раунда, здоровье, боезапас, активное оружие (по строкам `'ключ:значение'`). В начале раунда (`GAME_INFORM_DATA` с кодом `GAME_CODES.roundStart`, `src/config/gamecodes.js`) `main.js` вызывает `playLogoRoundStart()` из `logoAnimation.js` (волновая CSS-анимация на `#logo`, класс `logo-round-start`) и `PanelCtrl.playRoundStart()`, который заполняет полосу здоровья блок за блоком слева направо до последнего известного значения здоровья (панель с `h:` не гарантированно приходит раньше `roundStart`, поэтому view всегда хранит актуальное значение независимо от состояния анимации, а реальное падение здоровья во время заполнения немедленно её прерывает). Обе анимации учитывают `prefers-reduced-motion` (`src/lib/motion.js`). `PanelCtrl.reset()` вызывается на `PS_CLEAR` (смена карты), останавливая заполнение и забывая последнее известное здоровье.
- **Stat** — таблицы scoreboard с сортировкой (`sortList`), показывается по Tab.
- **Vote** — окна голосований из шаблонов, пагинация, таймер жизни.

## Сетевая плавность (Фазы 5a–5c)

### SnapshotInterpolator

[src/client/SnapshotInterpolator.js](../../src/client/SnapshotInterpolator.js) — кадры порта 5 не применяются немедленно, а буферизуются; мир рендерится в прошлом:

- серверное время оценивается EMA-оффсетом (`serverTime − localNow`), `renderTime = serverNow − delay` (конфиг `interpolation.delay: 100` мс);
- `sample()` выдаёт пересечённые `renderTime` кадры **целиком ровно один раз** (события `w1`/`w2e`, создания/удаления, reset/shake камеры), а непрерывные величины интерполирует между соседними кадрами: танки `m1` (x/y/vx/vy/engineLoad — `lerp`, углы — `lerpAngle` из [src/lib/math.js](../../src/lib/math.js)), динамика карты `c1`/`c2`, камера;
- классификация ключей — по `kind` из `SNAPSHOT_KEYS` (`opcodes.js`); экстраполяции нет — hold на последнем кадре; буфер сбрасывается при смене карты и `CLEAR`.

### TankPredictor

[src/client/TankPredictor.js](../../src/client/TankPredictor.js) — client-side prediction своего танка:

- локальная реплика серверной модели движения (`Tank.updateData` без Rapier-коллизий) фикс-шагом `timeStep`; параметры реплики приходят в конфиге порта 0 (`prediction`: timeStep/playerKeys/models/weapons);
- ввод пишется в локальную историю (`{time, keysMask, oneShotMask}`) и уходит на сервер как `"seq:action:name"`;
- **reconciliation**: из player-блока кадра (`gameId`, `lastInputSeq`, точное состояние) состояние := серверное → replay истории ввода от `serverTime` кадра до оценки серверного «сейчас»; расхождение уходит в `visualError` и экспоненциально затухает (снап при большом расхождении);
- рендер: предсказанное состояние перекрывает интерполяцию тем же `parse`-конвейером, камера следует предсказанной позиции;
- сбросы: `camera[2]` (respawn/телепорт), смена keySet, смена карты; при `condition 0` (смерть) предикт заморожен;
- `reset()` сбрасывает состояние **полностью** (включая `hasState`/`state`/`frozen`) — до прихода следующего player-блока рендерить нечего. При `CLEAR` и `MAP_DATA` вместе с ним обнуляется идентичность своего танка (`OwnTank.reset()`), иначе предикт воскрешал бы танк на уже очищенном полотне (вместе с зациклённым звуком двигателя).

⚠️ Точность реплики фиксирует паритет-тест `tests/server/TankPredictorParity.test.js` (реальный Rapier против реплики). Порядок интеграции (эмпирический, закреплён тестом): импульсы → интеграция позиций скоростью до демпфирования → damping `v *= 1/(1+dt·d)`.

### OwnTank

[src/client/OwnTank.js](../../src/client/OwnTank.js) — бухгалтерия своего танка, вынесенная из `main.js`:

- держит идентичность (`gameId` из player-блока кадра, имя модели из формы авторизации) и дискретные поля снапшота, которых нет в предсказанном состоянии (`condition`/`size`/`teamId`);
- `track(frame)` — на каждый пересечённый кадр: сброс предикта при `camera[2]`, обновление меты, заморозка предикта при `condition 0`, обнуление меты при удалении танка с полотна;
- `getRenderData()` — `null` либо `{ game, position }` для `renderTick`: барьер против призрака живёт здесь, результат `null`, пока нет предсказанного состояния или сброшены идентичность/мета;
- `canFire()` — гейт выстрела для `ShotPredictor.tryFire` (есть предсказанное состояние и танк жив);
- `reset()` — обнуляет идентичность и зовёт `predictor.reset()`. Создаётся рядом с предикторами, когда конфиг порта 0 несёт `prediction`. Покрыт `tests/client/OwnTank.test.js`.

### ShotPredictor

[src/client/ShotPredictor.js](../../src/client/ShotPredictor.js) — немедленный визуальный спавн снарядов своего танка:

- при нажатии fire трассер (`w1`) и бомба (`w2`) спавнятся сразу (вместе со звуком); физика, урон и взрыв (`w2e`) — серверные;
- `tryFire` реплицирует серверный гейт: кулдаун `fireRate`, патроны из панели, активное оружие (локальный цикл `nextWeapon`/`prevWeapon` + авторитетный `'wa'`), формулы `Tank.getMuzzlePosition`/`getFireDirection`;
- конечная точка трассера — приближённый raycast ([src/lib/raycast.js](../../src/lib/raycast.js)): `rayVsGrid` (DDA по тайлам стен) + `rayVsBox` (динамика карты и танки) по интерполированным позициям;
- **гейт для бомбы**: следующий выстрел типа `explosive` разрешается только после подтверждения предыдущего сервером — исключает FIFO-рассинхрон при высоком RTT;
- **RTT-компенсация позиции**: при спавне бомбы локальная позиция экстраполируется на `velocity × (RTT/2)` (оценка из `interpolator.offset`), чтобы совпасть с серверной позицией в момент обработки команды;
- **подавление серверных дублей** (`filterServerSnapshot`) по id автора в данных события (`tracers[7]`, `bombs[5]`): свои трассеры — FIFO pending-очередь с таймаутом 2 с; своя бомба — при подтверждении серверная строка до клиента не доезжает, а её id запоминается как алиас локального (`L<n>`): сущность живёт под локальным ключом от спавна до детонации, и `null` взрыва переименовывается в него же. Так бомба не пересоздаётся — иначе перезапускались бы её таймер и одноразовый звук постановки. Алиасы снимаются `null`'ом детонации, по возрасту (`BOMB_ALIAS_MAX_AGE`) и полным `reset()`; смена keySet (`resetLocal()`) их **не** трогает, потому что keySet приходит раньше кадра с детонацией. Локальный ключ `L<n>` не пересекается с base36-ключами сервера.

## Рендеринг

### parts/ — сущности

[src/client/parts/](../../src/client/parts/) — классы, отрисовываемые на PixiJS-полотнах: `Tank` (один класс и для своего, и для чужих танков), `TankRadar`, `Map`, `MapRadar`, `Bomb`, `Smoke`, `Tracks` (+`TrackMark`), `ParticlePool`. Эффекты — в `parts/effects/` (`BaseEffect`, `explosion/` — взрыв/воронка/дым, `shot/` — трассер/попадание), анимируются на `Ticker.shared`.

Соответствие снапшот-ключей классам и распределение по полотнам — `gameSets`/`entitiesOnCanvas` в `client.js`. Фиксированного контракта у part нет — при создании новой смотреть существующие как образец.

### Factory

[src/lib/factory.js](../../src/lib/factory.js) — реестр имя сущности → класс. `GameCtrl.parse(name, data)` по входным данным создаёт экземпляр, вызывает `update(data)` существующего или удаляет (`null`).

### Провайдеры

- **`BakingProvider`** ([providers/BakingProvider.js](../../src/client/providers/BakingProvider.js)) — однократная генерация процедурных текстур при старте по конфигу `bakedAssets`; функции запекания — в [providers/bakers/](../../src/client/providers/bakers/) (фиксированного интерфейса нет, ориентироваться на существующие).
- **`DependencyProvider`** — инъекция сервисов (`renderer`, `soundManager`) в компоненты по карте `componentDependencies`.

## SoundManager

[src/client/SoundManager.js](../../src/client/SoundManager.js) (на Howler.js). Звуки описаны в `src/config/sounds.js`.

- **UI/системные** (без позиции): `playSystemSound(name)` — немедленно, в обход приоритетов (используется и для звуков порта 6).
- **Пространственные** (позиция в мире): `registerSound(name, { position })` → `processAudibility()` → `updateActiveSounds()` — менеджер сам решает, что слышно, соблюдая лимит голосов (`WORLD_VOICE_LIMIT = 30`) и приоритеты из конфига.
- `unregisterSound(id)` снимает регистрацию и останавливает звук вместе с владельцем; `releaseSound(id)` — снимает регистрацию, но даёт уже звучащему одноразовому сэмплу доиграть (луп всё равно останавливается). Второй нужен сущностям, которые исчезают раньше своего звука: `parts/Bomb.destroy()` — бомба живёт 300 мс, сэмпл постановки дольше.
- `reset()` (смена карты, старт раунда) снимает **все** регистрации, а пережившие сброс `parts` держат свой `_soundId`. Владельцы перерегистрируются лениво: `updateSoundData(id, data)` возвращает `false`, если регистрации нет, и `Tank.update` на это обнуляет `_soundId` и снова зовёт `_initSounds()` — иначе выживший танк остался бы без звука навсегда (зациклённый звук только один — двигатель).

## InputListener

[src/client/InputListener.js](../../src/client/InputListener.js) — низкоуровневый перехват keydown/keyup для Controls; `modes`/`cmds` имеют приоритет над игровым набором клавиш.

## Иерархия UI (z-index)

`vimp` (1) → `radar` (2) → `chat` (3) → `panel` (4) → `vote` (5) → `game-informer` (6) → `stat` (7) → `auth` (8) → `tech-informer` (9).
