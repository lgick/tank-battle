import { describe, it, expect, beforeEach, vi } from 'vitest';
import OwnTank from '../../src/client/OwnTank.js';

// предиктор мокается объектом: OwnTank держит только бухгалтерию своего танка

const makePredictor = (overrides = {}) => ({
  hasState: true,
  getRenderState: vi.fn(() => ({
    x: 10,
    y: 20,
    angle: 0.5,
    gunRotation: 0.25,
    vx: 1,
    vy: 2,
    engineLoad: 3,
  })),
  reset: vi.fn(),
  freeze: vi.fn(),
  ...overrides,
});

// кадр интерполятора: свой танк m1/7 жив
const makeFrame = (ownData, camera = 0) => ({
  camera,
  game: { m1: { 7: ownData } },
});

describe('OwnTank', () => {
  let predictor;
  let ownTank;

  beforeEach(() => {
    predictor = makePredictor();
    ownTank = new OwnTank(predictor);
    ownTank.setModel('m1');
    ownTank.setGameId(7);
  });

  describe('reset', () => {
    it('обнуляет идентичность и сбрасывает предиктор', () => {
      ownTank.track(makeFrame([0, 0, 0, 0, 0, 0, 0, 100, 50, 10]));
      ownTank.reset();

      expect(ownTank.gameId).toBe(null);
      expect(predictor.reset).toHaveBeenCalled();
      expect(ownTank.canFire()).toBe(false);
    });

    it('регресс призрака: предсказанное состояние не рендерится после reset', () => {
      ownTank.track(makeFrame([0, 0, 0, 0, 0, 0, 0, 100, 50, 10]));
      expect(ownTank.getRenderData()).not.toBe(null);

      ownTank.reset();

      expect(predictor.getRenderState()).not.toBe(null); // предикт жив
      expect(ownTank.getRenderData()).toBe(null); // но рендера нет
    });
  });

  describe('getRenderData', () => {
    it('собирает 7 предсказанных полей + мету и позицию камеры', () => {
      ownTank.track(makeFrame([0, 0, 0, 0, 0, 0, 0, 100, 50, 10]));

      const own = ownTank.getRenderData();

      expect(own.game).toEqual({
        m1: { 7: [10, 20, 0.5, 0.25, 1, 2, 3, 100, 50, 10] },
      });
      expect(own.position).toEqual([10, 20]);
    });

    it('null без предсказанного состояния', () => {
      predictor.getRenderState = vi.fn(() => null);
      ownTank.track(makeFrame([0, 0, 0, 0, 0, 0, 0, 100, 50, 10]));

      expect(ownTank.getRenderData()).toBe(null);
    });

    it('null без меты (танк ещё не встречался в кадрах)', () => {
      expect(ownTank.getRenderData()).toBe(null);
    });
  });

  describe('track', () => {
    it('сбрасывает предиктор при reset камеры', () => {
      ownTank.track(makeFrame(undefined, [0, 0, true]));

      expect(predictor.reset).toHaveBeenCalled();
    });

    it('не сбрасывает предиктор при обычной камере', () => {
      ownTank.track(makeFrame(undefined, [0, 0, false]));
      ownTank.track(makeFrame(undefined, 0));

      expect(predictor.reset).not.toHaveBeenCalled();
    });

    it('удаление танка с полотна обнуляет мету', () => {
      ownTank.track(makeFrame([0, 0, 0, 0, 0, 0, 0, 100, 50, 10]));
      ownTank.track(makeFrame(null));

      expect(ownTank.getRenderData()).toBe(null);
    });

    it('живой танк: мета обновлена, предикт разморожен', () => {
      ownTank.track(makeFrame([0, 0, 0, 0, 0, 0, 0, 100, 50, 10]));

      expect(predictor.freeze).toHaveBeenCalledWith(false);
      expect(ownTank.getRenderData().game.m1[7].slice(7)).toEqual([100, 50, 10]);
    });

    it('уничтоженный танк замораживает предикт', () => {
      ownTank.track(makeFrame([0, 0, 0, 0, 0, 0, 0, 0, 0, 10]));

      expect(predictor.freeze).toHaveBeenCalledWith(true);
    });

    it('игнорирует кадр без известного gameId', () => {
      const fresh = new OwnTank(predictor);
      fresh.setModel('m1');
      fresh.track(makeFrame([0, 0, 0, 0, 0, 0, 0, 100, 50, 10]));

      expect(fresh.getRenderData()).toBe(null);
      expect(predictor.freeze).not.toHaveBeenCalled();
    });
  });

  describe('canFire', () => {
    it('true у живого танка с предсказанным состоянием', () => {
      ownTank.track(makeFrame([0, 0, 0, 0, 0, 0, 0, 100, 50, 10]));

      expect(ownTank.canFire()).toBe(true);
    });

    it('false при condition 0', () => {
      ownTank.track(makeFrame([0, 0, 0, 0, 0, 0, 0, 0, 0, 10]));

      expect(ownTank.canFire()).toBe(false);
    });

    it('false при пустой мете', () => {
      expect(ownTank.canFire()).toBe(false);
    });

    it('false без предсказанного состояния', () => {
      predictor.hasState = false;
      ownTank.track(makeFrame([0, 0, 0, 0, 0, 0, 0, 100, 50, 10]));

      expect(ownTank.canFire()).toBe(false);
    });
  });
});
