import { describe, it, expect, afterEach } from 'vitest';
import { prefersReducedMotion } from '../../src/lib/motion.js';

describe('prefersReducedMotion', () => {
  afterEach(() => {
    delete globalThis.matchMedia;
  });

  it('возвращает false, если matchMedia недоступен', () => {
    expect(prefersReducedMotion()).toBe(false);
  });

  it('возвращает значение matches из matchMedia', () => {
    globalThis.matchMedia = query => ({
      matches: query === '(prefers-reduced-motion: reduce)',
    });

    expect(prefersReducedMotion()).toBe(true);
  });
});
