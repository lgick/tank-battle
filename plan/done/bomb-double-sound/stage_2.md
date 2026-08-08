# Стадия 2. Одноразовый звук не должен обрываться смертью сущности ✅ выполнен

## Проблема

Даже после стадии 1 сэмпл `bombHasBeenPlanted` не может доиграть до
конца: `w2.time = 300` мс (`src/data/weapons.js:21`), то есть сервер
взрывает бомбу через 300 мс после постановки. Приходит `w2: { … null }`,
`GameModel.remove` → `Bomb.destroy()` (`src/client/parts/Bomb.js:102-113`)
→ `unregisterSound(this._soundId)`.

`SoundManager.unregisterSound` (`src/client/SoundManager.js:188-196`)
устроен как «звук умирает вместе с владельцем»:

```js
unregisterSound(id) {
  const sound = this._registeredSounds.get(id);

  if (sound && sound.activeSoundId !== null) {
    this._internalStop(sound.activeSoundId);   // жёсткий stop
  }

  this._registeredSounds.delete(id);
}
```

Для зацикленного звука (двигатель танка) это верно: луп обязан замолчать
вместе с танком. Для одноразового сэмпла у короткоживущей сущности —
нет: звук постановки бомбы по смыслу переживает саму бомбу.

## Решение: «отпустить» звук вместо остановки

Добавить в `SoundManager` метод-компаньон к `unregisterSound` — снимает
регистрацию, но даёт уже звучащему **не-луповому** сэмплу доиграть.
Ставить сразу после `unregisterSound` (`SoundManager.js:196`):

```js
/**
 * Снимает звук с регистрации, но даёт уже звучащему одноразовому сэмплу
 * доиграть. Для сущностей, которые исчезают раньше своего звука
 * (например, взорвавшаяся бомба).
 * @param {symbol} id - ID, полученный от `registerSound`.
 */
releaseSound(id) {
  const sound = this._registeredSounds.get(id);

  if (!sound) {
    return;
  }

  // луп обязан замолчать вместе с владельцем, one-shot — доиграть:
  // updateActiveSounds() не-лупы не трогает, а обработчик 'end' сам
  // подчистит _activeInstances
  if (sound.loop && sound.activeSoundId !== null) {
    this._internalStop(sound.activeSoundId);
  }

  this._registeredSounds.delete(id);
}
```

### Почему это безопасно

Проверено по текущему коду `SoundManager`:

- `updateActiveSounds()` (`SoundManager.js:308-312`) в первой же строке
  пропускает не-лупы (`if (!activeInstance.loop) continue;`), поэтому
  инстанс без регистрации никого не смутит — а вот для **лупа** там есть
  ветка «нет регистрации → `sound.stop()`», из-за которой отпускать луп
  бессмысленно, он всё равно будет остановлен следующим кадром (ещё одна
  причина глушить луп явно);
- обработчик `sound.once('end', …)` (`SoundManager.js:351-366`) сам
  удаляет запись из `_activeInstances`, а удаление из `_registeredSounds`
  делает только при совпадении id — отсутствующая регистрация его не
  ломает;
- `processAudibility()` перебирает `_registeredSounds`, поэтому
  отпущенный сэмпл больше не участвует в приоритетах и лимите голосов
  (`WORLD_VOICE_LIMIT`). Для сэмпла длиной около секунды это приемлемо:
  он гарантированно доиграет, но перестанет обновлять панораму. Явный
  и осознанный размен — зафиксировать в JSDoc метода.

## Перевод `Bomb` на `releaseSound`

`src/client/parts/Bomb.js:102-113`:

```js
destroy(options) {
  this._stopTimer();

  if (this._soundId) {
    // одноразовый сэмпл постановки живёт дольше самой бомбы (её убирает
    // детонация через weapon.time) — отпускаем, а не обрываем
    this._soundManager.releaseSound(this._soundId);
    this._soundId = null;
  }

  super.destroy({ … });
  …
}
```

`Tank` (`src/client/parts/Tank.js:219-224`) и эффекты
(`parts/effects/**/…Controller.js`) остаются на `unregisterSound` —
у них лупы либо звуки, привязанные к живой анимации.

## Результат стадии

Сэмпл постановки звучит один раз и **целиком**, независимо от того, что
бомба исчезает с полотна через 300 мс.
