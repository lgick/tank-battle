import { describe, it, expect, beforeEach, vi } from 'vitest';
import Publisher from '../../src/lib/Publisher.js';

// PanelCtrl — синглтон, перезагружаем модуль для изоляции
let PanelCtrl;

beforeEach(async () => {
  vi.resetModules();
  PanelCtrl = (await import('../../src/client/components/controller/Panel.js'))
    .default;
});

describe('PanelCtrl', () => {
  it('update проксируется в модель', () => {
    const model = { update: vi.fn() };
    new PanelCtrl(model, { publisher: new Publisher() }).update([1, 2, 3]);
    expect(model.update).toHaveBeenCalledWith([1, 2, 3]);
  });

  it('playRoundStart проксируется в view', () => {
    const view = { publisher: new Publisher(), playRoundStart: vi.fn() };
    new PanelCtrl({}, view).playRoundStart();
    expect(view.playRoundStart).toHaveBeenCalled();
  });

  it('reset проксируется в view', () => {
    const view = { publisher: new Publisher(), reset: vi.fn() };
    new PanelCtrl({}, view).reset();
    expect(view.reset).toHaveBeenCalled();
  });
});
