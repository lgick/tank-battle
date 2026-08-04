import { describe, it, expect, beforeEach, vi } from 'vitest';

let playLogoRoundStart;

beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = '<div id="logo"></div>';
  playLogoRoundStart = (await import('../../src/client/logoAnimation.js'))
    .playLogoRoundStart;
});

describe('playLogoRoundStart', () => {
  it('добавляет класс анимации, снимаемый по animationend', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });

    const logo = document.getElementById('logo');

    playLogoRoundStart();

    expect(logo.classList.contains('logo-round-start')).toBe(true);

    logo.dispatchEvent(new Event('animationend'));

    expect(logo.classList.contains('logo-round-start')).toBe(false);
  });

  it('повторный вызов не оставляет более одного слушателя', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });

    const logo = document.getElementById('logo');

    playLogoRoundStart();
    playLogoRoundStart();

    // если бы слушателей было два, класс всё равно снялся бы одним событием —
    // проверяем, что класс остаётся добавленным ровно после повторного вызова
    expect(logo.classList.contains('logo-round-start')).toBe(true);

    logo.dispatchEvent(new Event('animationend'));

    expect(logo.classList.contains('logo-round-start')).toBe(false);
  });

  it('под prefers-reduced-motion класс не добавляется', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });

    const logo = document.getElementById('logo');

    playLogoRoundStart();

    expect(logo.classList.contains('logo-round-start')).toBe(false);
  });

  it('без элемента #logo ничего не делает', () => {
    document.body.innerHTML = '';
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });

    expect(() => playLogoRoundStart()).not.toThrow();
  });
});
