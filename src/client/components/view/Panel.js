import Publisher from '../../../lib/Publisher.js';
import { lerp } from '../../../lib/math.js';
import { prefersReducedMotion } from '../../../lib/motion.js';

// Singleton PanelView

let panelView;

const HEALTH_FILL_DELAY_MS = 500; // задержка перед началом заполнения
const HEALTH_FILL_DURATION_MS = 500; // длительность заполнения слева направо

export default class PanelView {
  constructor(model, elems) {
    if (panelView) {
      return panelView;
    }

    panelView = this;

    this._panels = {};

    this._panels.time = document.getElementById(elems.time);
    this._panels.health = document.getElementById(elems.health);

    this._weaponList = Object.keys(elems.weapons);

    for (const weaponName of this._weaponList) {
      this._panels[weaponName] = document.getElementById(
        elems.weapons[weaponName],
      );
    }

    this._healthBarWrapper = null; // контейнер
    this._healthBlocks = []; // блоки здоровья
    this._totalHealthBlocks = 30; // количество блоков здоровья
    this._healthBlockColors = []; // цвета блоков здоровья
    this._emptyBlockColor = '#888'; // цвет пустых блоков

    this._healthAnimating = false; // идёт анимация заполнения (playRoundStart)
    this._healthTarget = null; // {blocksToShow, blink} — последнее известное значение здоровья
    this._healthDelayTimer = null;
    this._healthFillTimer = null;
    this._healthBlockTimers = [];

    this.publisher = new Publisher();

    this._mPublic = model.publisher;
    this._mPublic.on('data', 'update', this);
    this._mPublic.on('hide', 'hidePanel', this);
    this._mPublic.on('activeWeapon', 'setCurrentWeapon', this);

    this.initHealthBar();
  }

  // инициализирует полосу здоровья
  initHealthBar() {
    const healthContainer = this._panels.health;

    healthContainer.textContent = '';

    const wrapper = document.createElement('div');

    wrapper.className = 'panel-health-wrapper';

    this._healthBarWrapper = wrapper; // сохранение ссылки на обертку

    for (let i = 0, len = this._totalHealthBlocks; i < len; i += 1) {
      const block = document.createElement('div');

      block.className = 'panel-health-block';
      block.style.backgroundColor = this._emptyBlockColor;
      block.textContent = '\u00A0'; // неразрывный пробел

      wrapper.appendChild(block);

      this._healthBlocks.push(block);
      this._healthBlockColors.push(this.getHealthBlockColor(i));
    }

    healthContainer.appendChild(wrapper);
  }

  // вычисляет цвет для каждого блока здоровья на основе его индекса
  getHealthBlockColor(index) {
    const progress = index / (this._totalHealthBlocks - 1);

    const colors = [
      { p: 0, c: { r: 255, g: 50, b: 50 } }, // red
      { p: 0.25, c: { r: 255, g: 165, b: 0 } }, // orange
      { p: 0.5, c: { r: 255, g: 255, b: 0 } }, // yellow
      { p: 0.75, c: { r: 50, g: 205, b: 50 } }, // green
      { p: 1, c: { r: 0, g: 220, b: 220 } }, // cyan
    ];

    let start, end;

    for (let i = 1, len = colors.length; i < len; i += 1) {
      if (progress <= colors[i].p) {
        start = colors[i - 1];
        end = colors[i];
        break;
      }
    }

    const localProgress = (progress - start.p) / (end.p - start.p);
    const r = Math.round(lerp(start.c.r, end.c.r, localProgress));
    const g = Math.round(lerp(start.c.g, end.c.g, localProgress));
    const b = Math.round(lerp(start.c.b, end.c.b, localProgress));

    return `rgb(${r}, ${g}, ${b})`;
  }

  // обновляет пользовательскую панель
  update(data) {
    const { name, value } = data;
    const elem = this._panels[name];

    // логика для здоровья
    if (name === 'health') {
      const blocksToShow = Math.ceil((value / 100) * this._totalHealthBlocks);
      const exactBlocks = (value / 100) * this._totalHealthBlocks;
      const blink = value > 0 && exactBlocks % 1 !== 0;
      const prevTarget = this._healthTarget;

      // всегда актуально: панель может прийти как до, так и во время
      // анимации заполнения (playRoundStart), порядок с сервера не гарантирован
      this._healthTarget = { blocksToShow, blink };

      if (!this._healthAnimating) {
        this._paintHealthBar(blocksToShow, blink);
      } else if (!prevTarget || blocksToShow < prevTarget.blocksToShow) {
        // реальное падение здоровья важнее декоративной анимации заполнения
        this._cancelHealthTimers();
        this._healthAnimating = false;
        this._paintHealthBar(blocksToShow, blink);
      }
    } else {
      elem.textContent = value;
    }

    elem.style.display = 'table-cell';
  }

  // закрашивает блоки здоровья до blocksToShow, опционально мигает последним
  _paintHealthBar(blocksToShow, blink) {
    this._healthBlocks.forEach((block, index) => {
      if (index < blocksToShow) {
        block.className = 'panel-health-block';
        block.style.backgroundColor = this._healthBlockColors[index];
      } else {
        block.className = 'panel-health-block-empty';
        block.style.backgroundColor = this._emptyBlockColor;
      }
    });

    if (blink) {
      this._healthBlocks[blocksToShow - 1].classList.add(
        'panel-health-blink',
      );
    }
  }

  // проигрывает анимацию заполнения полосы здоровья слева направо
  // в начале раунда (вызывается при получении GAME_CODES.roundStart);
  // целью анимации служит последнее известное значение здоровья — панель
  // с 'h:' приходит раньше roundStart и уже осела в this._healthTarget
  playRoundStart() {
    this._cancelHealthTimers();

    if (
      prefersReducedMotion() ||
      !this._healthTarget ||
      this._panels.health.style.display === 'none'
    ) {
      this._healthAnimating = false;
      return;
    }

    this._healthAnimating = true;
    this._paintHealthBar(0, false);

    this._healthDelayTimer = setTimeout(() => {
      this._healthDelayTimer = null;
      this._animateHealthFill();
    }, HEALTH_FILL_DELAY_MS);
  }

  // заполняет блоки здоровья по одному до this._healthTarget за время задержки
  _animateHealthFill() {
    const { blocksToShow, blink } = this._healthTarget;
    const step = blocksToShow > 0 ? HEALTH_FILL_DURATION_MS / blocksToShow : 0;

    for (let index = 0; index < blocksToShow; index += 1) {
      this._healthBlockTimers.push(
        setTimeout(() => {
          const block = this._healthBlocks[index];

          block.className = 'panel-health-block';
          block.style.backgroundColor = this._healthBlockColors[index];

          if (blink && index === blocksToShow - 1) {
            block.classList.add('panel-health-blink');
          }
        }, step * index),
      );
    }

    this._healthFillTimer = setTimeout(() => {
      this._healthFillTimer = null;
      this._healthAnimating = false;

      // финальная перерисовка актуальным значением: если пока шла анимация
      // пришло более свежее (но не меньшее — иначе update() уже прервал бы
      // анимацию) значение здоровья, this._healthTarget уже обновлён
      this._paintHealthBar(
        this._healthTarget.blocksToShow,
        this._healthTarget.blink,
      );
    }, step * blocksToShow);
  }

  _cancelHealthTimers() {
    if (this._healthDelayTimer !== null) {
      clearTimeout(this._healthDelayTimer);
      this._healthDelayTimer = null;
    }

    if (this._healthFillTimer !== null) {
      clearTimeout(this._healthFillTimer);
      this._healthFillTimer = null;
    }

    this._healthBlockTimers.forEach(timer => clearTimeout(timer));
    this._healthBlockTimers = [];
  }

  // прерывает анимацию заполнения здоровья и забывает последнее известное
  // значение (смена карты/раунда, переход в спектаторы)
  reset() {
    this._cancelHealthTimers();
    this._healthAnimating = false;
    this._healthTarget = null;
  }

  hidePanel(name) {
    this._panels[name].style.display = 'none';
  }

  // устанавливает активное оружие
  setCurrentWeapon(activeWeaponName) {
    for (const weaponName of this._weaponList) {
      const elem = this._panels[weaponName];

      if (weaponName === activeWeaponName) {
        elem.classList.add('active');
      } else {
        elem.classList.remove('active');
      }
    }
  }
}
