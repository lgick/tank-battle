# Стадия 1. Алиасы бомб в `ShotPredictor` ✅ выполнен

## Проблема: полная трассировка

### Шаг 1. Локальный спавн

Нажатие `fire` → обработчик в `src/client/main.js:667-677`:

```js
if (action === 'down' && shotPredictor && ownTank?.canFire()) {
  if (name === 'fire') {
    const spawn = shotPredictor.tryFire(predictor.getRenderState(), ownTank.gameId, now);

    if (spawn) {
      applyGameData(spawn);           // сразу на полотно, без сервера
    }
  }
```

`ShotPredictor.tryFire()`, ветка `explosive`
(`src/client/ShotPredictor.js:231-262`) увеличивает `_localBombSeq`,
формирует ключ `L<n>` (комментарий там же: «'L' не встречается в
base36-ключах сервера»), кладёт запись в `_pendingBombs` и возвращает

```js
{ w2: { L1: [spawnX, spawnY, 0, weapon.size, weapon.time, shooterId] } }
```

`applyGameData` (`main.js:458-466`) → `GameCtrl.parse('Bomb', …)` →
`GameModel.create` → **`new Bomb(...)`**. Конструктор
(`src/client/parts/Bomb.js:59-64`) вызывает
`registerSound('bombHasBeenPlanted', { position })` →
**проигрывание №1**.

### Шаг 2. Серверное подтверждение

Сервер обрабатывает выстрел и кладёт бомбу в кадр:
`src/server/modules/Game.js:319-326`

```js
} else if (weaponConfig.type === 'explosive') {
  const shot = this._createWeaponAction(gameId, weaponName, shotData);

  this._newShotsData[weaponName][shot.shotId] = shot.getData();
}
```

Важно: `_newShotsData` — **событийные** данные. Бомба присутствует в
кадре ровно дважды за свою жизнь: строка данных при создании и `null` при
детонации (`Game.js:573-575`, `outcomeData[weaponName][shotId] = null`).
Между этими двумя событиями сервер про бомбу ничего не шлёт.

Кадр доезжает до клиента через `SnapshotInterpolator`, то есть с
задержкой `delay + RTT` (порядка 100-150 мс), и попадает в `renderTick`
(`main.js:487-506`), где перед применением проходит через
`filterServerSnapshot`.

### Шаг 3. Первопричина

`ShotPredictor.filterServerSnapshot`, ветка `explosive`
(`src/client/ShotPredictor.js:337-378`):

```js
if (myId !== null && data[5] === myId) {
  const index = this._pendingBombs.findIndex(p => p.weaponName === weaponName);

  if (index !== -1) {
    const [pending] = this._pendingBombs.splice(index, 1);

    // локальная бомба уступает место серверной авторитетной сущности
    ensureBombs();
    bombs[pending.localId] = null;      // ← вот здесь
  }
}
```

Локальная строка гасится `null`'ом, а **серверная остаётся в кадре**.
Оба изменения оказываются в одном объекте `game`, и `GameCtrl.parse`
(`src/client/components/controller/Game.js:11-30`) идёт по нему `for…in`:

- `L1: null` → экземпляр найден → `GameModel.update` → `data === null` →
  `remove` → `Bomb.destroy()` → `unregisterSound(this._soundId)`
  (`Bomb.js:106`) → `SoundManager.unregisterSound`
  (`SoundManager.js:188-196`) → `_internalStop` **обрывает ещё звучащий
  сэмпл**;
- `a7: [...]` → экземпляра нет → `GameModel.create` → **новый `Bomb`** →
  `registerSound` → **проигрывание №2 с начала**.

Отсюда и слышимое «старт → обрыв → старт заново».

### Почему трассеры не страдают

Для `hitscan` (`ShotPredictor.js:319-335`) сделано **наоборот**:
серверный дубль выбрасывается (`filtered`), локальный трассер остаётся.
Бомба — единственное исключение, потому что она долгоживущая: её потом
надо удалить по серверному id, вот локальный ключ и «уступает место».
Именно это допущение и надо снять.

### Третий обрыв (не заявлен, но часть той же поломки)

`w2.time = 300` мс (`src/data/weapons.js:21`). При детонации сервер шлёт
`w2: { a7: null }` → `Bomb.destroy()` снова обрывает сэмпл. То есть даже
после устранения дубля `bombHasBeenPlanted` физически не может доиграть
дольше 300 мс. Это чинится стадией 2.

### Чего в этом баге нет

Дублирования по личному порту `SOUND_DATA` здесь **не происходит**:
`bombHasBeenPlanted` не входит в набор системных сигналов
(`socketMethods[PS_SOUND_DATA]`, `main.js:363-366`, играет только то, что
пришло с сервера как имя сэмпла). Это чистый конфликт предикта и
авторитета на пространственном канале.

---

## Решение: сущность живёт под локальным id всю жизнь

Идея: не «удалить локальную и создать серверную», а **запомнить
соответствие** серверного id локальному и переименовывать все
последующие серверные строки этой бомбы в локальный ключ. Тогда `Bomb`
создаётся ровно один раз, звук регистрируется один раз, таймер не
перезапускается, спрайт не моргает.

Визуально бомба остаётся в предсказанной позиции — это штатное поведение
предикта, ровно как у трассеров.

### 1.1. Карта алиасов

В конструкторе `ShotPredictor` (`ShotPredictor.js:49-52`), рядом с
`_pendingBombs`:

```js
// подтверждённые свои бомбы: серверный id → { localId, time }.
// Сущность на полотне живёт под локальным id от спавна до детонации —
// иначе её пришлось бы удалить и создать заново, что рвёт одноразовый
// звук и перезапускает таймер
this._bombAliases = {};
```

Рядом с `PENDING_MAX_AGE` (`ShotPredictor.js:20`):

```js
// максимальный возраст алиаса своей бомбы (мс). Штатно алиас снимается
// null'ом детонации; этот срок — только страховка от утечки, если null
// потерялся, поэтому он с запасом больше любого разумного weapon.time
const BOMB_ALIAS_MAX_AGE = 60000;
```

### 1.2. Ветка `explosive` в `filterServerSnapshot`

Заменить тело цикла (`ShotPredictor.js:352-376`):

```js
for (const id in source) {
  if (!Object.hasOwn(source, id)) {
    continue;
  }

  const data = source[id];

  // строка под известным алиасом (в первую очередь null детонации)
  // переезжает под локальный ключ: под ним сущность живёт с самого спавна
  if (Object.hasOwn(this._bombAliases, id)) {
    const { localId } = this._bombAliases[id];

    ensureBombs();
    delete bombs[id];
    bombs[localId] = data;

    if (data === null) {
      delete this._bombAliases[id];
    }

    continue;
  }

  // чужой взрыв проходит напрямую — удаляет чужую сущность
  if (data === null) {
    continue;
  }

  if (myId !== null && data[5] === myId) {
    const index = this._pendingBombs.findIndex(
      p => p.weaponName === weaponName,
    );

    if (index !== -1) {
      const [pending] = this._pendingBombs.splice(index, 1);

      // серверная строка до клиента не доезжает: сущность уже стоит под
      // локальным id, и он остаётся её именем — до самой детонации
      ensureBombs();
      delete bombs[id];
      this._bombAliases[id] = { localId: pending.localId, time: localNow };
    }
  }
}
```

Замечания по реализации:

- цикл идёт по `source` (неизменяемому оригиналу), мутируется только
  копия `bombs` — существующий ленивый `ensureBombs`/`ensureCopy`
  сохраняется, исходный кадр по-прежнему не мутируется;
- порядок веток важен: проверка алиаса стоит **до** проверки на `null`,
  иначе `null` собственной детонации ушёл бы «напрямую» под серверным
  ключом и локальный спрайт остался бы на полотне навсегда;
- если в одном кадре придут и `a7: null` (детонация старой бомбы), и
  `a8: [...]` (спавн новой), обе ветки отработают независимо.

### 1.3. Два вида сброса

Сейчас `reset()` (`ShotPredictor.js:382-390`) вызывается из трёх мест, и
одно из них — смена keySet (`main.js:356-360`), то есть в том числе
**смерть игрока**:

```js
socketMethods[PS_KEYSET_DATA] = keySet => {
  modules.controls?.changeKeySet(keySet);
  predictor?.setActive(keySet === 1);
  shotPredictor?.reset();          // ← снесёт алиасы
};
```

`KEYSET_DATA` — обычное сообщение и применяется сразу при получении, а
кадр с детонацией едет через буфер интерполяции и обрабатывается на
`delay + RTT` позже. Значит keySet **систематически обгоняет** детонацию:
если снести алиасы здесь, то `a7: null` приедет, переименовывать будет
некому, и локальный спрайт бомбы (с «0» на таймере) останется на полотне
до ближайшего `CLEAR`. Это ровно та регрессия, которая была поймана на
код-ревью в родственном проекте, — не повторяем её.

Разводим сбросы:

```js
// сброс режима игрок/наблюдатель (KEYSET_DATA): локальные ставки на
// выстрелы аннулируются, но подтверждённые бомбы продолжают жить под
// своими локальными id — их снимет серверный null детонации, который
// приходит позже keySet
resetLocal() {
  this._pendingTracers = [];
  this._buryPendingBombs();
  this._cooldownUntil = {};
  this._ammo = {};
  this._tanks = {};
  this._currentWeapon = this._modelData?.currentWeapon ?? null;
}

// полный сброс (смена карты/CLEAR): мира больше нет
reset() {
  this.resetLocal();
  this._bombAliases = {};
  // после CLEAR полотно чистится целиком — доставлять null некому
  this._expiredLocalBombs = [];
}

// хоронит неподтверждённые локальные бомбы: null по локальному id уйдёт
// в ближайший кадр, иначе спрайт останется на полотне
_buryPendingBombs() {
  for (const pending of this._pendingBombs) {
    this._expiredLocalBombs.push({
      localId: pending.localId,
      weaponName: pending.weaponName,
    });
  }

  this._pendingBombs = [];
}
```

и в `main.js:359`:

```js
shotPredictor?.resetLocal();
```

`setMap()` (`ShotPredictor.js:96`) продолжает звать полный `reset()` —
это правильно, карта меняется вместе с полным `CLEAR`.

Похороны неподтверждённых бомб закрывают заодно **старую скрытую дыру**:
сегодня `reset()` просто обнуляет `_pendingBombs`, и локальная бомба,
заспавненная за миг до смерти, остаётся на полотне навсегда — никакой
`null` по ключу `L<n>` уже не придёт.

### 1.4. Страховка от утечки алиасов

В `_trimPending` (`ShotPredictor.js:486-499`), в конец:

```js
// страховка от утечки, если null детонации потерялся
const aliasMinTime = localNow - BOMB_ALIAS_MAX_AGE;

for (const id in this._bombAliases) {
  if (
    Object.hasOwn(this._bombAliases, id) &&
    this._bombAliases[id].time < aliasMinTime
  ) {
    delete this._bombAliases[id];
  }
}
```

Рост карты и без того ограничен гейтом «одна неподтверждённая бомба на
оружие» (`ShotPredictor.js:233-235`) плюс `fireRate`, но оставлять
неограниченно живущие ключи не стоит.

---

## Известное узкое место (принять и проверить руками)

Смерть в окне между спавном и подтверждением (~100-150 мс): `resetLocal()`
хоронит pending → в ближайший кадр инжектится `{ w2: { L1: null } }`, а в
**том же** кадре приезжает серверная строка `a7`, для которой pending уже
нет → она проходит насквозь и создаёт вторую сущность. Клиент за один тик
получает `{ L1: null, a7: [...] }` — то есть в этом узком окне звук
постановки всё ещё может прозвучать дважды.

Это строго лучше альтернативы (вечный спрайт-призрак) и требует погибнуть
в пределах задержки подтверждения. Оставляем как есть, проверяем на
ручном прогоне; если слышно — решать отдельно (вариант: не хоронить
pending, а переводить его в «ожидание сервера» с тем же алиас-механизмом).

## Результат стадии

- `Bomb` создаётся один раз и живёт под `L<n>` до детонации;
- `bombHasBeenPlanted` регистрируется один раз;
- таймер не перезапускается, спрайт не моргает;
- смерть с поставленной бомбой не оставляет призрак на полотне.
