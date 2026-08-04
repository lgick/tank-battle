import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Publisher from '../../src/lib/Publisher.js';

// PanelView — синглтон, перезагружаем модуль для изоляции
let PanelView;

const elems = {
  time: 'panel-time',
  health: 'panel-health',
  weapons: { w1: 'panel-w1', w2: 'panel-w2' },
};

const seedDom = () => {
  document.body.innerHTML = `
    <div id="panel-time"></div>
    <div id="panel-health"></div>
    <div id="panel-w1"></div>
    <div id="panel-w2"></div>
  `;
};

const makeModel = () => ({ publisher: new Publisher() });

beforeEach(async () => {
  vi.resetModules();
  seedDom();
  PanelView = (await import('../../src/client/components/view/Panel.js'))
    .default;
});

describe('PanelView.initHealthBar', () => {
  it('создаёт 30 блоков здоровья внутри обёртки', () => {
    new PanelView(makeModel(), elems);

    const wrapper = document.querySelector('.panel-health-wrapper');
    expect(wrapper).not.toBeNull();
    expect(wrapper.querySelectorAll('.panel-health-block').length).toBe(30);
  });
});

describe('PanelView.update', () => {
  it('текстовая панель получает значение', () => {
    const view = new PanelView(makeModel(), elems);

    view.update({ name: 'time', value: '02:30' });

    // happy-dom не хранит display: table-cell, проверяем смысловую часть
    expect(document.getElementById('panel-time').textContent).toBe('02:30');
  });

  it('полное здоровье подсвечивает все блоки', () => {
    const view = new PanelView(makeModel(), elems);

    view.update({ name: 'health', value: 100 });

    const blocks = document.querySelectorAll('#panel-health div div');
    const filled = [...blocks].filter(
      b => b.className === 'panel-health-block',
    );
    expect(filled.length).toBe(30);
  });

  it('половина здоровья заполняет половину блоков', () => {
    const view = new PanelView(makeModel(), elems);

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
    const view = new PanelView(makeModel(), elems);

    view.hidePanel('time');
    expect(document.getElementById('panel-time').style.display).toBe('none');
  });

  it('setCurrentWeapon помечает активное оружие классом active', () => {
    const view = new PanelView(makeModel(), elems);

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

  it('обнуляет полосу здоровья и заполняет её блоками к концу анимации', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    vi.useFakeTimers();

    const view = new PanelView(makeModel(), elems);

    view.playRoundStart();

    let blocks = [...document.querySelectorAll('#panel-health div div')];
    expect(
      blocks.every(b => b.className === 'panel-health-block-empty'),
    ).toBe(true);

    // значение здоровья, пришедшее во время анимации, не должно её перебивать
    view.update({ name: 'health', value: 100 });

    blocks = [...document.querySelectorAll('#panel-health div div')];
    expect(
      blocks.every(b => b.className === 'panel-health-block-empty'),
    ).toBe(true);

    vi.advanceTimersByTime(1000); // задержка + полная длительность заполнения

    blocks = [...document.querySelectorAll('#panel-health div div')];
    const filled = blocks.filter(b => b.className === 'panel-health-block');
    expect(filled.length).toBe(30);
  });

  it('при prefers-reduced-motion не запускает анимацию и применяет update сразу', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });

    const view = new PanelView(makeModel(), elems);

    view.playRoundStart();
    view.update({ name: 'health', value: 50 });

    const blocks = [...document.querySelectorAll('#panel-health div div')];
    const filled = blocks.filter(b => b.className === 'panel-health-block');
    expect(filled.length).toBe(15);
  });
});

describe('PanelView: события модели', () => {
  it('data → update, activeWeapon → setCurrentWeapon', () => {
    const model = makeModel();
    new PanelView(model, elems);

    model.publisher.emit('data', { name: 'time', value: '01:00' });
    model.publisher.emit('activeWeapon', 'w1');

    expect(document.getElementById('panel-time').textContent).toBe('01:00');
    expect(
      document.getElementById('panel-w1').classList.contains('active'),
    ).toBe(true);
  });
});
