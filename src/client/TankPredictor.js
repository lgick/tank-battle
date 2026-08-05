import { lerp, clamp, normalizeAngle } from '../lib/math.js';
import { Vec2, rotateVec } from '../lib/vec2.js';

// Client-side prediction своего танка: реплика серверной модели движения
// (Tank.updateData) без Rapier-коллизий. Точность реплики фиксируется
// паритет-тестом против реального сервера (tests/server/TankPredictorParity).
//
// Поток: applyInput пишет изменения клавиш в историю; update() шагает
// симуляцию фикс-шагом; onServerState() — reconciliation: состояние берётся
// серверное (authoritative) и история ввода переигрывается от serverTime
// кадра до текущей оценки серверного времени. Расхождение копится в
// visualError и экспоненциально затухает — без видимых рывков.

const FORWARD = new Vec2(1, 0);
const RIGHT = new Vec2(0, 1);

// максимальный возраст записей истории ввода (мс)
const HISTORY_MAX_AGE = 2000;

// скорость затухания визуальной ошибки (доля в секунду)
const ERROR_DECAY_RATE = 10;

// порог ошибки (юнитов), выше которого позиция снапится без сглаживания
const ERROR_SNAP_DISTANCE = 100;

// защита от «спирали смерти» аккумулятора (мс)
const MAX_ACCUMULATED_TIME = 100;

export default class TankPredictor {
  /**
   * @param {Object} options
   * @param {number} options.timeStep - Шаг симуляции (мс, как на сервере).
   * @param {Object} options.playerKeys - Конфиг клавиш { name: {key, type} }.
   * @param {Object} options.models - Конфиги моделей танков (models.js).
   */
  constructor({ timeStep, playerKeys, models }) {
    this._stepMs = timeStep;
    this._models = models;
    this._model = null; // выбирается setModel при авторизации

    // биты клавиш и маска one-shot клавиш (как в Game)
    this._keys = {};
    this._oneShotMask = 0;

    for (const name in playerKeys) {
      if (Object.hasOwn(playerKeys, name)) {
        this._keys[name] = playerKeys[name].key;

        if (playerKeys[name].type === 1) {
          this._oneShotMask |= playerKeys[name].key;
        }
      }
    }

    this._active = false;
    this._frozen = false;
    this._hasState = false;
    this._pendingReset = true;

    // текущее состояние симуляции
    this._state = null;
    this._centering = false;
    this._engineLoad = 0;

    // живой ввод
    this._keysMask = 0;
    this._oneShotPending = 0;

    // история ввода: { time (local, мс), keys, oneShot }
    this._history = [];
    // маска, действовавшая до самой старой записи истории
    this._baseKeysMask = 0;

    this._visualError = { x: 0, y: 0, angle: 0 };

    this._accumulator = 0;
    this._lastUpdateTime = null;
  }

  // модель танка пользователя (известна при авторизации)
  setModel(modelName) {
    this._model = this._models[modelName] || null;
  }

  // предикт включается для играющего (keySet 1) и выключается у спектатора
  setActive(isActive) {
    if (isActive && !this._active) {
      this._pendingReset = true;
    }

    this._active = isActive;

    if (!isActive) {
      this._hasState = false;
    }
  }

  // заморозка на серверном состоянии (танк уничтожен)
  freeze(isFrozen) {
    this._frozen = isFrozen;
  }

  // полный сброс (respawn/телепорт/смена карты): состояние возьмётся
  // из следующего player-блока без replay
  reset() {
    this._pendingReset = true;
    this._hasState = false;
    this._state = null;
    this._frozen = false;
    this._history = [];
    this._baseKeysMask = 0;
    this._keysMask = 0; // сервер сбрасывает клавиши при респауне (resetKeys)
    this._oneShotPending = 0;
    this._visualError = { x: 0, y: 0, angle: 0 };
    this._accumulator = 0;
  }

  // есть ли предсказанное состояние для рендера
  get hasState() {
    return this._active && this._hasState && this._model !== null;
  }

  /**
   * Изменение клавиши: обновляет живую маску и историю ввода.
   * @param {string} action - 'down' | 'up'.
   * @param {string} name - Имя клавиши из playerKeys.
   * @param {number} localTime - performance.now() момента ввода.
   */
  applyInput(action, name, localTime) {
    const keyBit = this._keys[name];

    if (keyBit === undefined) {
      return;
    }

    let oneShot = 0;

    if (action === 'down') {
      if (this._oneShotMask & keyBit) {
        this._oneShotPending |= keyBit;
        oneShot = keyBit;
      } else {
        this._keysMask |= keyBit;
      }
    } else if (action === 'up') {
      this._keysMask &= ~keyBit;
    }

    this._history.push({ time: localTime, keys: this._keysMask, oneShot });
    this._trimHistory(localTime);
  }

  /**
   * Продвигает симуляцию к текущему моменту (вызывается каждый rAF).
   * @param {number} localNow - performance.now().
   */
  update(localNow) {
    if (this._lastUpdateTime === null) {
      this._lastUpdateTime = localNow;
      return;
    }

    const elapsed = localNow - this._lastUpdateTime;

    this._lastUpdateTime = localNow;

    // затухание визуальной ошибки
    const decay = Math.max(0, 1 - (elapsed / 1000) * ERROR_DECAY_RATE);

    this._visualError.x *= decay;
    this._visualError.y *= decay;
    this._visualError.angle *= decay;

    if (!this.hasState || this._frozen) {
      this._accumulator = 0;
      return;
    }

    this._accumulator = Math.min(
      this._accumulator + elapsed,
      MAX_ACCUMULATED_TIME,
    );

    while (this._accumulator >= this._stepMs) {
      const keys = this._keysMask | this._oneShotPending;

      this._oneShotPending = 0;
      this._step(keys);
      this._accumulator -= this._stepMs;
    }
  }

  /**
   * Reconciliation: авторитетное состояние сервера + replay истории ввода.
   * @param {Object} player - Player-блок кадра { state, centering, ... }.
   * @param {number} serverTime - serverTime кадра.
   * @param {number} offset - Оценка (serverTime − localNow) интерполятора.
   * @param {number} localNow - performance.now().
   */
  onServerState(player, serverTime, offset, localNow) {
    if (!this._active || this._model === null) {
      return;
    }

    const old = this._hasState ? { ...this._state } : null;
    const s = player.state;

    this._state = {
      x: s[0],
      y: s[1],
      angle: s[2],
      vx: s[3],
      vy: s[4],
      angvel: s[5],
      gunRotation: s[6],
      throttle: s[7],
    };
    this._centering = player.centering;
    this._hasState = true;

    // replay: от serverTime кадра до текущей оценки серверного времени
    const serverNowEst = localNow + offset;
    let historyIndex = 0;
    let replayKeys = this._baseKeysMask;
    let t = serverTime;

    // маска, действовавшая на момент serverTime
    while (
      historyIndex < this._history.length &&
      this._history[historyIndex].time + offset <= t
    ) {
      replayKeys = this._history[historyIndex].keys;
      historyIndex += 1;
    }

    while (t + this._stepMs <= serverNowEst) {
      t += this._stepMs;

      // записи, попавшие в этот шаг: обновляют маску и дают one-shot
      let oneShot = 0;

      while (
        historyIndex < this._history.length &&
        this._history[historyIndex].time + offset <= t
      ) {
        replayKeys = this._history[historyIndex].keys;
        oneShot |= this._history[historyIndex].oneShot;
        historyIndex += 1;
      }

      this._step(replayKeys | oneShot);
    }

    // остаток времени доиграет update() своим аккумулятором
    this._accumulator = serverNowEst - t;

    if (this._pendingReset || old === null) {
      this._pendingReset = false;
      this._visualError = { x: 0, y: 0, angle: 0 };
      return;
    }

    // расхождение старого предсказания с новым — в визуальную ошибку
    this._visualError.x += old.x - this._state.x;
    this._visualError.y += old.y - this._state.y;
    this._visualError.angle += normalizeAngle(old.angle - this._state.angle);

    if (
      Math.hypot(this._visualError.x, this._visualError.y) >
      ERROR_SNAP_DISTANCE
    ) {
      this._visualError = { x: 0, y: 0, angle: 0 };
    }
  }

  /**
   * Состояние для рендера (со сглаживающей визуальной ошибкой).
   * @returns {{x, y, angle, gunRotation, vx, vy, engineLoad}|null}
   */
  getRenderState() {
    if (!this.hasState) {
      return null;
    }

    return {
      x: this._state.x + this._visualError.x,
      y: this._state.y + this._visualError.y,
      angle: this._state.angle + this._visualError.angle,
      gunRotation: this._state.gunRotation,
      vx: this._state.vx,
      vy: this._state.vy,
      engineLoad: this._engineLoad,
    };
  }

  // подрезает историю, запоминая маску, действовавшую до её начала
  _trimHistory(localNow) {
    const minTime = localNow - HISTORY_MAX_AGE;

    while (this._history.length && this._history[0].time < minTime) {
      this._baseKeysMask = this._history[0].keys;
      this._history.shift();
    }
  }

  // один фикс-шаг реплики движения (порядок операций — как Tank.updateData
  // + интеграция Rapier: импульсы → damping → интеграция позиций)
  _step(keys) {
    const m = this._model;
    const state = this._state;
    const dt = this._stepMs / 1000;

    const forward = Boolean(keys & this._keys.forward);
    const back = Boolean(keys & this._keys.back);
    const left = Boolean(keys & this._keys.left);
    const right = Boolean(keys & this._keys.right);
    const gCenter = Boolean(keys & this._keys.gunCenter);
    const gLeft = Boolean(keys & this._keys.gunLeft);
    const gRight = Boolean(keys & this._keys.gunRight);

    // башня
    if (gCenter) {
      this._centering = true;
    }

    if (this._centering) {
      state.gunRotation = lerp(
        state.gunRotation,
        0,
        Math.min(1, m.gunCenterSpeed * dt),
      );

      if (Math.abs(state.gunRotation) < 0.01) {
        state.gunRotation = 0;
        this._centering = false;
      }

      if (gLeft || gRight) {
        this._centering = false;
      }
    } else {
      const rotationAmount = m.gunRotationSpeed * dt;

      if (gLeft) {
        state.gunRotation = Math.max(
          -m.maxGunAngle,
          state.gunRotation - rotationAmount,
        );
      } else if (gRight) {
        state.gunRotation = Math.min(
          m.maxGunAngle,
          state.gunRotation + rotationAmount,
        );
      }
    }

    // дроссель
    if (forward || back) {
      state.throttle = Math.min(1, state.throttle + m.throttleIncreaseRate * dt);
    } else {
      state.throttle = Math.max(0, state.throttle - m.throttleDecreaseRate * dt);
    }

    const forwardVec = rotateVec(FORWARD, state.angle);
    const rightVec = rotateVec(RIGHT, state.angle);
    const velocity = new Vec2(state.vx, state.vy);
    const forwardSpeed = Vec2.dot(velocity, forwardVec);
    const lateralVel = Vec2.dot(rightVec, velocity);

    // боковое сцепление: Δv = −latVel·grip·dt (масса сокращается)
    const lateralDv = -lateralVel * m.lateralGrip * dt;

    // тяга/торможение: ускорение вдоль forwardVec
    let acceleration = 0;

    if (state.throttle > 0) {
      if (forward && forwardSpeed < m.maxForwardSpeed) {
        acceleration = state.throttle * m.accelerationFactor;
      } else if (back && forwardSpeed > m.maxReverseSpeed) {
        acceleration = -state.throttle * m.accelerationFactor;
      }
    }

    if (acceleration === 0 && !forward && !back) {
      acceleration = -forwardSpeed * m.brakingFactor;
    }

    const forwardDv = acceleration * dt;

    state.vx += forwardVec.x * forwardDv + rightVec.x * lateralDv;
    state.vy += forwardVec.y * forwardDv + rightVec.y * lateralDv;

    // нагрузка двигателя (для звука)
    const speedRatio = this._getSpeedRatio(forwardSpeed);
    const strain = Math.max(0, state.throttle - speedRatio);

    this._engineLoad = clamp(state.throttle + strain * m.strainFactor, 0, 2);

    // поворот: Δω = torqueFactor·turnFactor·dt (инерция сокращается)
    let turnFactor = 1;

    if (Math.abs(forwardSpeed) < m.turnSpeedThreshold) {
      turnFactor = m.baseTurnFactorRatio;
    }

    if (forwardSpeed < 0) {
      turnFactor *= m.reverseTurnMultiplier;
    }

    if (left) {
      state.angvel -= m.baseTurnTorqueFactor * turnFactor * dt;
    }

    if (right) {
      state.angvel += m.baseTurnTorqueFactor * turnFactor * dt;
    }

    // интеграция и затухание (эмпирический порядок Rapier, зафиксирован
    // паритет-тестом: позиция интегрируется скоростью до демпфирования,
    // хранится задемпфированная скорость)
    state.x += state.vx * dt;
    state.y += state.vy * dt;
    state.angle = normalizeAngle(state.angle + state.angvel * dt);

    state.vx *= 1 / (1 + dt * m.damping.linear);
    state.vy *= 1 / (1 + dt * m.damping.linear);
    state.angvel *= 1 / (1 + dt * m.damping.angular);
  }

  // доля текущей скорости от максимальной (как Tank._getSpeedRatio)
  _getSpeedRatio(forwardSpeed) {
    let speedRatio = 0;

    if (forwardSpeed > 0) {
      speedRatio = clamp(forwardSpeed / this._model.maxForwardSpeed, 0, 1);
    } else if (forwardSpeed < 0) {
      speedRatio = clamp(
        Math.abs(forwardSpeed / this._model.maxReverseSpeed),
        0,
        1,
      );
    }

    return +speedRatio.toFixed(4);
  }
}
