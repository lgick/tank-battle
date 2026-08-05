import { describe, it, expect, beforeEach } from 'vitest';
import TankPredictor from '../../src/client/TankPredictor.js';

// точность реплики против реального Rapier проверяет
// tests/server/TankPredictorParity.test.js; здесь — логика предиктора:
// ввод/история/аккумулятор/reconciliation/visualError

const STEP = 1000 / 120;

const playerKeys = {
  forward: { key: 1 },
  back: { key: 2 },
  left: { key: 4 },
  right: { key: 8 },
  gunCenter: { key: 16, type: 1 },
  gunLeft: { key: 32 },
  gunRight: { key: 64 },
  fire: { key: 128, type: 1 },
};

const models = {
  m1: {
    accelerationFactor: 1000,
    brakingFactor: 10,
    maxForwardSpeed: 260,
    maxReverseSpeed: -130,
    baseTurnTorqueFactor: 215,
    damping: { linear: 3, angular: 100 },
    lateralGrip: 20,
    maxGunAngle: 1.4,
    gunRotationSpeed: 3,
    gunCenterSpeed: 10,
    turnSpeedThreshold: 10,
    baseTurnFactorRatio: 0.8,
    reverseTurnMultiplier: 0.7,
    throttleIncreaseRate: 2,
    throttleDecreaseRate: 2.5,
    strainFactor: 1.5,
  },
};

const zeroState = () => ({
  x: 0,
  y: 0,
  angle: 0,
  vx: 0,
  vy: 0,
  angvel: 0,
  gunRotation: 0,
  throttle: 0,
});

const makePredictor = () => {
  const p = new TankPredictor({ timeStep: STEP, playerKeys, models });

  p.setModel('m1');
  p.setActive(true);
  p._state = zeroState();
  p._hasState = true;
  p._pendingReset = false;

  return p;
};

let predictor;

beforeEach(() => {
  predictor = makePredictor();
});

describe('TankPredictor: ввод и история', () => {
  it('down/up обновляют маску, one-shot копится отдельно', () => {
    predictor.applyInput('down', 'forward', 0);
    predictor.applyInput('down', 'gunCenter', 1);

    expect(predictor._keysMask).toBe(1);
    expect(predictor._oneShotPending).toBe(16);

    predictor.applyInput('up', 'forward', 2);
    expect(predictor._keysMask).toBe(0);
    expect(predictor._history.length).toBe(3);
  });

  it('неизвестная клавиша игнорируется', () => {
    predictor.applyInput('down', 'nextPlayer', 0);

    expect(predictor._history.length).toBe(0);
  });

  it('старые записи истории подрезаются с сохранением базовой маски', () => {
    predictor.applyInput('down', 'forward', 0);
    predictor.applyInput('down', 'left', 5000); // запись @0 старше 2с

    expect(predictor._history.length).toBe(1);
    expect(predictor._baseKeysMask).toBe(1); // forward действовал до истории
  });
});

describe('TankPredictor: симуляция', () => {
  it('update шагает фикс-шагом и двигает танк при forward', () => {
    predictor.applyInput('down', 'forward', 0);
    predictor.update(0); // инициализация времени
    predictor.update(STEP * 10);

    expect(predictor._state.x).toBeGreaterThan(0);
    expect(predictor._state.vx).toBeGreaterThan(0);
    expect(predictor._state.throttle).toBeGreaterThan(0);
  });

  it('freeze останавливает симуляцию', () => {
    predictor.applyInput('down', 'forward', 0);
    predictor.freeze(true);
    predictor.update(0);
    predictor.update(STEP * 10);

    expect(predictor._state.x).toBe(0);
  });

  it('неактивный предиктор не имеет состояния для рендера', () => {
    predictor.setActive(false);

    expect(predictor.hasState).toBe(false);
    expect(predictor.getRenderState()).toBeNull();
  });

  it('getRenderState добавляет визуальную ошибку к позиции', () => {
    predictor._visualError = { x: 5, y: -3, angle: 0.1 };

    const render = predictor.getRenderState();

    expect(render.x).toBe(5);
    expect(render.y).toBe(-3);
    expect(render.angle).toBeCloseTo(0.1);
  });
});

describe('TankPredictor: reconciliation', () => {
  it('replay истории от серверного состояния совпадает с непрерывным предиктом', () => {
    // A — непрерывный предикт: forward с t=0, 12 шагов
    const a = makePredictor();

    a.applyInput('down', 'forward', 0);
    a.update(0);
    a.update(STEP * 12);

    // B — «сервер подтвердил» нулевое состояние на t=0, replay до t=12 шагов
    const b = makePredictor();

    b.applyInput('down', 'forward', 0);
    b.onServerState(
      { state: [0, 0, 0, 0, 0, 0, 0, 0], centering: false },
      0, // serverTime
      0, // offset (серверная шкала = локальной)
      STEP * 12, // localNow
    );

    expect(b._state.x).toBeCloseTo(a._state.x, 6);
    expect(b._state.vx).toBeCloseTo(a._state.vx, 6);
    expect(b._state.throttle).toBeCloseTo(a._state.throttle, 6);
  });

  it('расхождение уходит в visualError и затухает', () => {
    predictor._state.x = 50; // старое предсказание

    predictor.onServerState(
      { state: [40, 0, 0, 0, 0, 0, 0, 0], centering: false },
      0,
      0,
      0,
    );

    // ошибка = старое (50) − новое (40) = 10: рендер остаётся на старом месте
    expect(predictor._visualError.x).toBeCloseTo(10);
    expect(predictor.getRenderState().x).toBeCloseTo(50);

    // затухание за кадр
    predictor.update(0);
    predictor.update(16);
    expect(Math.abs(predictor._visualError.x)).toBeLessThan(10);
  });

  it('слишком большое расхождение снапится без сглаживания', () => {
    predictor._state.x = 500;

    predictor.onServerState(
      { state: [0, 0, 0, 0, 0, 0, 0, 0], centering: false },
      0,
      0,
      0,
    );

    expect(predictor._visualError.x).toBe(0);
    expect(predictor.getRenderState().x).toBe(0);
  });

  it('после reset состояние берётся без replay и без ошибки', () => {
    predictor.applyInput('down', 'forward', 0);
    predictor._state.x = 99;
    predictor.reset();

    expect(predictor._keysMask).toBe(0); // сервер сбрасывает клавиши тоже
    expect(predictor._history.length).toBe(0);

    predictor.onServerState(
      { state: [7, 8, 0, 0, 0, 0, 0, 0], centering: false },
      0,
      0,
      STEP * 30, // «прошло время» — но replay после reset не применяется
    );

    expect(predictor._state.x).toBe(7);
    expect(predictor._visualError.x).toBe(0);
  });

  it('reset обнуляет состояние: до нового player-блока рендерить нечего', () => {
    predictor._state.x = 99;
    predictor.freeze(true);
    predictor.reset();

    expect(predictor.hasState).toBe(false);
    expect(predictor.getRenderState()).toBeNull();
    expect(predictor._frozen).toBe(false);

    predictor.onServerState(
      { state: [7, 8, 0, 0, 0, 0, 0, 0], centering: false },
      0,
      0,
      0,
    );

    expect(predictor.hasState).toBe(true);
    expect(predictor.getRenderState().x).toBe(7);
  });
});
