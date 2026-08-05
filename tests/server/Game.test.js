import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Vec2 } from '../../src/lib/vec2.js';
import RAPIER from '../../src/server/physics/rapier.js';

// Game — синглтон и тянет Rapier-мир; перезагружаем модуль для изоляции.
// Тестируем изолированную логику (урон, команды), внедряя фейковых
// игроков напрямую в _playersData, не создавая реальные танки.
let Game;

const parts = {
  models: { m1: { constructor: 'Tank', currentWeapon: 'w1' } },
  weapons: {
    w1: { type: 'hitscan', damage: 40, cameraShake: { intensity: 1 } },
    w2: {
      type: 'explosive',
      damage: 70,
      shotOutcomeId: 'w2e',
      constructor: 'Bomb',
      size: 10,
      time: 1000,
      radius: 50,
      impulseMagnitude: 5,
    },
  },
  mapConstructor: 'Map',
  hitscanService: 'HitscanService',
  friendlyFire: false,
};

const playerKeys = {
  forward: { key: 1 },
  fire: { key: 128, type: 1 },
  nextWeapon: { key: 256, type: 1 },
};

const fakePlayer = ({
  teamId,
  alive = true,
  destroyed = false,
  shotData = null,
  weapon = 'w1',
} = {}) => ({
  teamId,
  model: 'm1',
  _alive: alive,
  currentWeapon: weapon,
  isAlive() {
    return this._alive;
  },
  takeDamage: vi.fn(() => destroyed),
  getPosition: () => [1, 2],
  updateData: vi.fn(),
  getShotData: vi.fn(() => shotData),
  getData: vi.fn(() => [1, 2, 0, 0, 0, 0, 0, 3, 10, teamId]),
});

// фейковый коллайдер контакта: parent() возвращает тело с userData
const makeCollider = userData => {
  const body = { userData };
  return { parent: () => body, _body: body };
};

const makeGame = () => {
  const game = new Game(parts, playerKeys, 1 / 120);
  game._services.vimp = {
    triggerCameraShake: vi.fn(),
    reportKill: vi.fn(),
  };
  return game;
};

beforeEach(async () => {
  vi.resetModules();
  Game = (await import('../../src/server/modules/Game.js')).default;
});

describe('Game: конструктор', () => {
  it('строит карту клавиш и oneShotMask', () => {
    const game = makeGame();
    expect(game._playerKeys.keys.fire).toBe(128);
    // fire и nextWeapon — одноразовые (type: 1)
    expect(game._playerKeys.oneShotMask & 128).toBeTruthy();
    expect(game._playerKeys.oneShotMask & 256).toBeTruthy();
    // forward не одноразовая
    expect(game._playerKeys.oneShotMask & 1).toBeFalsy();
  });

  it('отбирает только hitscan-оружие в _hitscanWeapons', () => {
    const game = makeGame();
    expect(game._hitscanWeapons).toHaveProperty('w1');
    expect(game._hitscanWeapons).not.toHaveProperty('w2');
  });
});

describe('Game.applyDamage', () => {
  let game;

  beforeEach(() => {
    game = makeGame();
    game._playersData = {
      victim: fakePlayer({ teamId: 2 }),
      shooter: fakePlayer({ teamId: 1 }),
    };
  });

  it('наносит урон врагу из конфига оружия', () => {
    game.applyDamage('victim', 'shooter', 'w1');
    expect(game._playersData.victim.takeDamage).toHaveBeenCalledWith(40);
  });

  it('использует явный damageValue, если передан', () => {
    game.applyDamage('victim', 'shooter', 'w1', 12);
    expect(game._playersData.victim.takeDamage).toHaveBeenCalledWith(12);
  });

  it('триггерит тряску камеры цели', () => {
    game.applyDamage('victim', 'shooter', 'w1');
    expect(game._services.vimp.triggerCameraShake).toHaveBeenCalledWith(
      'victim',
      { intensity: 1 },
    );
  });

  it('не бьёт союзника при выключенном friendlyFire', () => {
    game._playersData.shooter.teamId = 2; // та же команда, что и victim
    game.applyDamage('victim', 'shooter', 'w1');
    expect(game._playersData.victim.takeDamage).not.toHaveBeenCalled();
  });

  it('бьёт союзника при включённом friendlyFire', () => {
    game._friendlyFire = true;
    game._playersData.shooter.teamId = 2;
    game.applyDamage('victim', 'shooter', 'w1');
    expect(game._playersData.victim.takeDamage).toHaveBeenCalled();
  });

  it('игнорирует урон уже уничтоженной цели', () => {
    game._playersData.victim._alive = false;
    game.applyDamage('victim', 'shooter', 'w1');
    expect(game._playersData.victim.takeDamage).not.toHaveBeenCalled();
  });

  it('сообщает об убийстве, если цель уничтожена этим уроном', () => {
    game._playersData.victim = fakePlayer({ teamId: 2, destroyed: true });
    game.applyDamage('victim', 'shooter', 'w1');
    expect(game._services.vimp.reportKill).toHaveBeenCalledWith(
      'victim',
      'shooter',
    );
  });
});

describe('Game: состояние игроков', () => {
  it('isAlive отражает состояние и отсутствие игрока', () => {
    const game = makeGame();
    game._playersData = { p1: fakePlayer({ teamId: 1 }) };

    expect(game.isAlive('p1')).toBe(true);
    expect(game.isAlive('ghost')).toBe(false);

    game._playersData.p1._alive = false;
    expect(game.isAlive('p1')).toBe(false);
  });

  it('getAlivePlayers возвращает только живых с координатами', () => {
    const game = makeGame();
    game._playersData = {
      alive: fakePlayer({ teamId: 1, alive: true }),
      dead: fakePlayer({ teamId: 2, alive: false }),
    };

    const result = game.getAlivePlayers();
    expect(result).toEqual([{ gameId: 'alive', teamId: 1, x: 1, y: 2 }]);
  });
});

describe('Game.updateData: фиксированный шаг', () => {
  const STEP = 1 / 120;

  it('один шаг за один timeStep обновляет игрока и кеширует его данные', () => {
    const game = makeGame();
    const player = fakePlayer({ teamId: 1 });
    game._playersData = { p1: player };

    game.updateData(STEP);

    expect(player.updateData).toHaveBeenCalledTimes(1);
    expect(player.updateData).toHaveBeenCalledWith(STEP);
    expect(game._cachedPlayersData.p1).toEqual([1, 2, 0, 0, 0, 0, 0, 3, 10, 1]);
  });

  it('накапливает дробное время и шагает по достижении timeStep', () => {
    const game = makeGame();
    const player = fakePlayer({ teamId: 1 });
    game._playersData = { p1: player };

    game.updateData(STEP * 2.5); // 2 полных шага, остаток 0.5

    expect(player.updateData).toHaveBeenCalledTimes(2);
  });

  it('ограничивает число шагов при большом dt (защита от спирали смерти)', () => {
    const game = makeGame();
    const player = fakePlayer({ teamId: 1 });
    game._playersData = { p1: player };

    game.updateData(1.0); // огромный лаг: аккумулятор зажат в 0.1с

    const calls = player.updateData.mock.calls.length;
    // 0.1 / (1/120) = 12 шагов; без зажима было бы 120
    expect(calls).toBeLessThanOrEqual(12);
    expect(calls).toBeGreaterThan(1);
  });
});

describe('Game._processContactEvents', () => {
  let game;

  beforeEach(() => {
    game = makeGame();
    game._playersData = {
      victim: fakePlayer({ teamId: 2 }),
      shooter: fakePlayer({ teamId: 1 }),
    };
  });

  it('контакт игрок↔снаряд наносит урон и помечает снаряд на удаление', () => {
    const playerCol = makeCollider({ type: 'player', gameId: 'victim' });
    const shotCol = makeCollider({
      type: 'shot',
      gameId: 'shooter',
      weaponName: 'w1',
    });
    game._contactEvents = [{ colliderA: playerCol, colliderB: shotCol }];

    game._processContactEvents();

    expect(game._playersData.victim.takeDamage).toHaveBeenCalled();
    expect(game._bodiesToDestroy.has(shotCol._body)).toBe(true);
    expect(game._contactEvents).toEqual([]); // очищен
  });

  it('взрывной снаряд при контакте не удаляется и не бьёт', () => {
    const playerCol = makeCollider({ type: 'player', gameId: 'victim' });
    const shotCol = makeCollider({
      type: 'shot',
      gameId: 'shooter',
      weaponName: 'w2', // explosive
    });
    game._contactEvents = [{ colliderA: playerCol, colliderB: shotCol }];

    game._processContactEvents();

    expect(game._playersData.victim.takeDamage).not.toHaveBeenCalled();
    expect(game._bodiesToDestroy.has(shotCol._body)).toBe(false);
  });

  it('контакт двух игроков игнорируется', () => {
    const a = makeCollider({ type: 'player', gameId: 'victim' });
    const b = makeCollider({ type: 'player', gameId: 'shooter' });
    game._contactEvents = [{ colliderA: a, colliderB: b }];

    game._processContactEvents();

    expect(game._playersData.victim.takeDamage).not.toHaveBeenCalled();
  });

  it('контакт без userData пропускается', () => {
    const a = makeCollider(null);
    const b = makeCollider({
      type: 'shot',
      gameId: 'shooter',
      weaponName: 'w1',
    });
    game._contactEvents = [{ colliderA: a, colliderB: b }];

    expect(() => game._processContactEvents()).not.toThrow();
    expect(game._playersData.victim.takeDamage).not.toHaveBeenCalled();
  });
});

describe('Game.getEvents', () => {
  it('возвращает новые выстрелы и очищает контейнеры активных орудий', () => {
    const game = makeGame();
    game._activeWeaponKeys.add('w1');
    game._newShotsData.w1 = [{ x: 1 }];

    const events = game.getEvents();

    expect(events.w1).toEqual([{ x: 1 }]);
    expect(game._newShotsData.w1).toEqual([]); // сброшен
    expect(game._activeWeaponKeys.size).toBe(0);
  });

  it('включает исчезнувшие пули и эффекты, затем очищает их', () => {
    const game = makeGame();
    game._lastExpiredShotsData = { w2: { abc: null } };
    game._lastWeaponEffects = { w2e: [[1, 2, 50]] };

    const events = game.getEvents();

    expect(events.w2).toEqual({ abc: null });
    expect(events.w2e).toEqual([[1, 2, 50]]);
    expect(game._lastExpiredShotsData).toEqual({});
    expect(game._lastWeaponEffects).toEqual({});
  });

  it('мёржит создание и удаление снаряда в одном тике без потери создания', () => {
    const game = makeGame();
    game._activeWeaponKeys.add('w2');
    game._newShotsData.w2 = { newId: [1, 2, 0, 2, 3000, 42] };
    game._lastExpiredShotsData = { w2: { oldId: null } };

    const events = game.getEvents();

    expect(events.w2.newId).toBeDefined();
    expect(events.w2.oldId).toBeNull();
  });

  it('возвращает null при отсутствии событий', () => {
    const game = makeGame();
    expect(game.getEvents()).toBeNull();
  });
});

describe('Game.getWorldState', () => {
  it('собирает кешированные данные по модели и gameId', () => {
    const game = makeGame();
    game._playersData = { p1: fakePlayer({ teamId: 1 }) };
    game._cachedPlayersData = { p1: [1, 2, 0] };

    expect(game.getWorldState()).toEqual({ m1: { p1: [1, 2, 0] } });
  });

  it('пропускает игроков без кеша', () => {
    const game = makeGame();
    game._playersData = { p1: fakePlayer({ teamId: 1 }) };
    game._cachedPlayersData = {}; // нет кеша

    expect(game.getWorldState()).toEqual({});
  });
});

describe('Game: очистка мира и снарядов', () => {
  it('_removeShots уничтожает тела пуль и сбрасывает счётчик', () => {
    const game = makeGame();
    game._playersData = { shooter: fakePlayer({ teamId: 1 }) };
    const shot = game._createWeaponAction('shooter', 'w2', {
      bodyPosition: new Vec2(0, 0),
    });
    expect(game._shotsData[shot.shotId]).toBeDefined();

    const removed = game._removeShots();

    expect(removed).toContain('w2');
    expect(Object.keys(game._shotsData)).toHaveLength(0);
    expect(game._currentShotId).toBe(0);
  });

  it('removePlayersAndShots возвращает имена игроков, пуль и эффектов', () => {
    const game = makeGame();
    game._playersData = { shooter: fakePlayer({ teamId: 1 }) };
    // реальный игрок должен иметь getBody для removeRigidBody
    const body = game._world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    game._playersData.shooter.getBody = () => body;

    const removed = game.removePlayersAndShots();

    // включает модель игрока (m1), все оружия (w1, w2) и эффекты (w2e) — всегда
    expect(removed).toContain('m1');
    expect(removed).toContain('w1');
    expect(removed).toContain('w2');
    expect(removed).toContain('w2e');
    expect(game._playersData).toEqual({});
  });

  it('removePlayersAndShots включает m1 и при пустом _playersData', () => {
    const game = makeGame();
    game._playersData = {};

    const removed = game.removePlayersAndShots();

    // после clear живых игроков нет, но клиент должен снести zombie-предикт
    expect(removed).toContain('m1');
  });

  it('clear сбрасывает аккумулятор и данные', () => {
    const game = makeGame();
    game._accumulator = 0.05;
    game._playersData = {};

    game.clear();

    expect(game._accumulator).toBe(0);
    expect(game._playersData).toEqual({});
  });
});

describe('Game._createWeaponAction', () => {
  it('создаёт снаряд, регистрирует его в _shotsData и планирует удаление', () => {
    const game = makeGame();
    game._playersData = { shooter: fakePlayer({ teamId: 1 }) };

    const shot = game._createWeaponAction('shooter', 'w2', {
      bodyPosition: new Vec2(0, 0),
    });

    expect(shot.shotId).toBeDefined();
    expect(shot.weaponName).toBe('w2');
    expect(game._shotsData[shot.shotId]).toBe(shot);

    // снаряд занесён в кольцевой буфер на какой-то слот удаления
    const inBuffer = Object.values(game._shotsAtTime).some(slot =>
      slot.includes(shot.shotId),
    );
    expect(inBuffer).toBe(true);
  });
});
