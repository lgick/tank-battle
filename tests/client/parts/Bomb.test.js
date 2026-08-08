import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pixi замокан: проверяется применение серверных данных, а не отрисовка
// (рендеринг parts/** — вне scope unit-тестов, см. TESTING_TODO.md)
vi.mock('pixi.js', () => {
  class Container {
    constructor() {
      this.x = 0;
      this.y = 0;
      this.rotation = 0;
      this.children = [];
      this.destroyed = false;
    }

    addChild(...items) {
      this.children.push(...items);
    }

    destroy() {
      this.destroyed = true;
    }
  }

  class Sprite extends Container {
    constructor(texture) {
      super();

      this.texture = texture;
      this.anchor = { set: () => {} };
      this.scale = { set: () => {} };
    }
  }

  class Text extends Container {
    constructor() {
      super();

      this.text = '';
      this.anchor = { set: () => {} };
      this.scale = { set: () => {} };
    }
  }

  return {
    Container,
    Sprite,
    Text,
    Ticker: { shared: { add: vi.fn(), remove: vi.fn() } },
  };
});

const { Ticker } = await import('pixi.js');
const { default: Bomb } = await import('../../../src/client/parts/Bomb.js');

const assets = { bombTexture: { width: 64 } };

let soundManager;

// формат серверной строки: [x, y, rotation, size, time, ownerId]
const makeBomb = () =>
  new Bomb([10, 20, 0, 8, 300, 1], assets, { soundManager });

beforeEach(() => {
  Ticker.shared.add.mockClear();
  Ticker.shared.remove.mockClear();

  soundManager = {
    registerSound: vi.fn(() => Symbol('bombHasBeenPlanted')),
    updateSoundData: vi.fn(() => true),
    releaseSound: vi.fn(),
  };
});

describe('Bomb: авторитетная коррекция позиции', () => {
  it('update переносит спрайт и позицию сэмпла в присланную точку', () => {
    const bomb = makeBomb();

    bomb.update([42, -17, 1.5, 8, 300, 3]);

    expect(bomb.x).toBe(42);
    expect(bomb.y).toBe(-17);
    expect(bomb.rotation).toBe(1.5);
    expect(soundManager.updateSoundData).toHaveBeenCalledWith(
      expect.anything(),
      { position: { x: 42, y: -17 } },
    );

    bomb.destroy();
  });

  it('коррекция не пересоздаёт бомбу: таймер и звук заводятся один раз', () => {
    const bomb = makeBomb();

    bomb.update([42, -17, 0, 8, 300, 3]);

    expect(soundManager.registerSound).toHaveBeenCalledTimes(1);
    expect(Ticker.shared.add).toHaveBeenCalledTimes(1);
    expect(Ticker.shared.remove).not.toHaveBeenCalled();

    bomb.destroy();
  });

  it('снятую регистрацию звука не дёргают повторно', () => {
    const bomb = makeBomb();

    // регистрацию снял reset(): сэмпл одноразовый, перерегистрировать нечего
    soundManager.updateSoundData.mockReturnValueOnce(false);

    bomb.update([1, 2, 0, 8, 300, 3]);
    bomb.update([3, 4, 0, 8, 300, 3]);

    expect(soundManager.updateSoundData).toHaveBeenCalledTimes(1);

    // отпускать тоже нечего
    bomb.destroy();

    expect(soundManager.releaseSound).not.toHaveBeenCalled();
  });
});
