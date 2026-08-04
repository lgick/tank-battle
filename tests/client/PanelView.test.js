import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Publisher from '../../src/lib/Publisher.js';

// PanelView — синглтон, перезагружаем модуль для изоляции
let PanelView;

const elems = {
  time: 'panel-time',
  health: 'panel-health',
  weapons: { w1: 'panel-w1', w2: 'panel-w2' },
};

const healthAnimation = { blocks: 30, delay: 500, duration: 500 };

const seedDom = () => {
  document.body.innerHTML = `
    <div id="panel-time"></div>
    <div id="panel-health"></div>
    <div id="panel-w1"></div>
    <div id="panel-w2"></div>
  `;
};

const makeModel = () => ({ publisher: new Publisher() });

const newView = model => new PanelView(model, elems, healthAnimation);

beforeEach(async () => {
  vi.resetModules();
  seedDom();
  PanelView = (await import('../../src/client/components/view/Panel.js'))
    .default;
});

describe('PanelView.initHealthBar', () => {
  it('создаёт 30 блоков здоровья внутри обёртки', () => {
    newView(makeModel());

    const wrapper = document.querySelector('.panel-health-wrapper');
    expect(wrapper).not.toBeNull();
    expect(wrapper.querySelectorAll('.panel-health-block').length).toBe(30);
  });
});

describe('PanelView.update', () => {
  it('текстовая панель получает значение', () => {
    const view = newView(makeModel());

    view.update({ name: 'time', value: '02:30' });

    // happy-dom не хранит display: table-cell, проверяем смысловую часть
    expect(document.getElementById('panel-time').textContent).toBe('02:30');
  });

  it('полное здоровье подсвечивает все блоки', () => {
    const view = newView(makeModel());

    view.update({ name: 'health', value: 100 });

    const blocks = document.querySelectorAll('#panel-health div div');
    const filled = [...blocks].filter(
      b => b.className === 'panel-health-block',
    );
    expect(filled.length).toBe(30);
  });

  it('половина здоровья заполняет половину блоков', () => {
    const view = newView(makeModel());

    view.update({ name: 'health', value: 50 });

    const blocks = [...document.querySelectorAll('#panel-health div div')];
    const empty = blocks.filter(
      b => b.className === 'panel-health-block-empty',
    );
    expect(empty.length).toBe(15);
  });
});

describe('PanelView.hidePanel / setCurrentWeapon', () => {
  it('hidePanel скрывает указанную панель', () => {
    const view = newView(makeModel());

    view.hidePanel('time');
    expect(document.getElementById('panel-time').style.display).toBe('none');
  });

  it('hidePanel("health") во время анимации отменяет таймеры заполнения', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    vi.useFakeTimers();

    const view = newView(makeModel());

    view.update({ name: 'health', value: 100 });
    view.playRoundStart();

    // спектатор: панель здоровья скрывается посреди анимации
    view.hidePanel('health');

    const beforeHtml = document.getElementById('panel-health').innerHTML;

    vi.advanceTimersByTime(1000);

    // таймеры отменены — скрытая полоса не перекрашивается в фоне
    expect(document.getElementById('panel-health').innerHTML).toBe(
      beforeHtml,
    );

    vi.useRealTimers();
  });

  it('setCurrentWeapon помечает активное оружие классом active', () => {
    const view = newView(makeModel());

    view.setCurrentWeapon('w2');

    expect(
      document.getElementById('panel-w1').classList.contains('active'),
    ).toBe(false);
    expect(
      document.getElementById('panel-w2').classList.contains('active'),
    ).toBe(true);
  });
});

describe('PanelView.playRoundStart', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('заполняет полосу значением, пришедшим ДО roundStart (порядок сервера)', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    vi.useFakeTimers();

    const view = newView(makeModel());

    // sendPlayerDefaultShot (панель) приходит раньше sendRoundStart
    view.update({ name: 'health', value: 100 });
    view.playRoundStart();

    let blocks = [...document.querySelectorAll('#panel-health div div')];
    expect(
      blocks.every(b => b.className === 'panel-health-block-empty'),
    ).toBe(true);

    vi.advanceTimersByTime(1000); // задержка + полная длительность заполнения

    blocks = [...document.querySelectorAll('#panel-health div div')];
    const filled = blocks.filter(b => b.className === 'panel-health-block');
    expect(filled.length).toBe(30);
  });

  it('обновление здоровья во время анимации не перебивает её, пока не упало ниже цели', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    vi.useFakeTimers();

    const view = newView(makeModel());

    view.update({ name: 'health', value: 100 });
    view.playRoundStart();

    // такое же значение — анимация продолжается
    view.update({ name: 'health', value: 100 });

    let blocks = [...document.querySelectorAll('#panel-health div div')];
    expect(
      blocks.every(b => b.className === 'panel-health-block-empty'),
    ).toBe(true);

    vi.advanceTimersByTime(1000);

    blocks = [...document.querySelectorAll('#panel-health div div')];
    const filled = blocks.filter(b => b.className === 'panel-health-block');
    expect(filled.length).toBe(30);
  });

  it('реальный урон во время анимации прерывает её и рисует факт немедленно', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    vi.useFakeTimers();

    const view = newView(makeModel());

    view.update({ name: 'health', value: 100 });
    view.playRoundStart();

    // игрока подбили в первую секунду раунда
    view.update({ name: 'health', value: 60 });

    const blocks = [...document.querySelectorAll('#panel-health div div')];
    const filled = blocks.filter(b => b.className === 'panel-health-block');
    expect(filled.length).toBe(18); // ceil(60/100 * 30)

    // финальный таймер анимации не должен затем перерисовать поверх
    vi.advanceTimersByTime(1000);

    const blocksAfter = [
      ...document.querySelectorAll('#panel-health div div'),
    ];
    expect(
      blocksAfter.filter(b => b.className === 'panel-health-block').length,
    ).toBe(18);
  });

  it('без ранее известного здоровья анимацию не запускает и не трогает полосу', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });

    const view = newView(makeModel());

    const before = document.getElementById('panel-health').innerHTML;

    view.playRoundStart();

    // playRoundStart без предшествующего update() возвращается рано,
    // не перекрашивая полосу здоровья в 0
    expect(document.getElementById('panel-health').innerHTML).toBe(before);
  });

  it('при prefers-reduced-motion не запускает анимацию и применяет update сразу', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });

    const view = newView(makeModel());

    view.playRoundStart();
    view.update({ name: 'health', value: 50 });

    const blocks = [...document.querySelectorAll('#panel-health div div')];
    const filled = blocks.filter(b => b.className === 'panel-health-block');
    expect(filled.length).toBe(15);
  });
});

describe('PanelView.reset', () => {
  it('прерывает анимацию и забывает последнее известное здоровье', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    vi.useFakeTimers();

    const view = newView(makeModel());

    view.update({ name: 'health', value: 100 });
    view.playRoundStart();
    view.reset();

    vi.advanceTimersByTime(1000);

    const blocks = [...document.querySelectorAll('#panel-health div div')];
    expect(
      blocks.every(b => b.className === 'panel-health-block-empty'),
    ).toBe(true);

    // после reset playRoundStart без нового update ничего не анимирует
    view.playRoundStart();
    vi.advanceTimersByTime(1000);

    const blocksAfter = [
      ...document.querySelectorAll('#panel-health div div'),
    ];
    expect(
      blocksAfter.every(b => b.className === 'panel-health-block-empty'),
    ).toBe(true);

    vi.useRealTimers();
  });
});

describe('PanelView: события модели', () => {
  it('data → update, activeWeapon → setCurrentWeapon', () => {
    const model = makeModel();
    newView(model);

    model.publisher.emit('data', { name: 'time', value: '01:00' });
    model.publisher.emit('activeWeapon', 'w1');

    expect(document.getElementById('panel-time').textContent).toBe('01:00');
    expect(
      document.getElementById('panel-w1').classList.contains('active'),
    ).toBe(true);
  });
});
