// Бухгалтерия своего танка: идентичность (gameId + модель) и дискретные поля
// из снапшота (condition/armor/bullets), которых нет в предсказанном состоянии.
//
// Один барьер против «призрака»: пока идентичность или мета сброшены
// (смена карты, clear), getRenderData() отдаёт null — предсказанное состояние
// не воскрешает танк на очищенном полотне.

export default class OwnTank {
  /**
   * @param {TankPredictor} predictor - Тот же экземпляр, что и в main.js.
   */
  constructor(predictor) {
    this._predictor = predictor;
    this._gameId = null;
    this._modelName = null; // из формы авторизации
    this._meta = null; // [condition, armor, bullets] последнего снапшота
  }

  // id своего танка (для filterServerSnapshot и tryFire)
  get gameId() {
    return this._gameId;
  }

  // модель танка пользователя (известна при авторизации)
  setModel(modelName) {
    this._modelName = modelName;
  }

  // id приходит в player-блоке кадра
  setGameId(gameId) {
    this._gameId = gameId;
  }

  // сущность на полотне уничтожена: id и мета невалидны
  reset() {
    this._gameId = null;
    this._meta = null;
    this._predictor.reset();
  }

  /**
   * Отслеживает свой танк в дискретном кадре: дискретные поля для предикшена,
   * заморозка при уничтожении, сброс предикта при reset камеры.
   * @param {Object} frame - Кадр интерполятора { game, camera }.
   */
  track(frame) {
    // reset камеры (respawn/телепорт/смена наблюдения) → сброс предсказания
    if (frame.camera !== 0 && frame.camera[2] === true) {
      this._predictor.reset();
    }

    if (this._gameId === null || !this._modelName) {
      return;
    }

    const ownData = frame.game[this._modelName]?.[this._gameId];

    if (ownData === null) {
      this._meta = null; // танк удалён с полотна
    } else if (ownData) {
      this._meta = [ownData[7], ownData[8], ownData[9]];
      this._predictor.freeze(ownData[7] === 0); // уничтожен — предикт заморожен
    }
  }

  /**
   * Данные рендера своего танка поверх интерполяции.
   * @returns {?{game: Object, position: number[]}} null, если предсказанного
   * состояния нет или идентичность/мета сброшены.
   */
  getRenderData() {
    const predicted = this._predictor.getRenderState();

    if (!predicted || this._gameId === null || !this._meta) {
      return null;
    }

    return {
      game: {
        [this._modelName]: {
          [this._gameId]: [
            predicted.x,
            predicted.y,
            predicted.angle,
            predicted.gunRotation,
            predicted.vx,
            predicted.vy,
            predicted.engineLoad,
            ...this._meta,
          ],
        },
      },
      // камера следует предсказанному танку (reset/shake — дискретными кадрами)
      position: [predicted.x, predicted.y],
    };
  }

  // выстрел возможен только у живого танка с предсказанным состоянием
  canFire() {
    return this._predictor.hasState && !!this._meta && this._meta[0] !== 0;
  }
}
