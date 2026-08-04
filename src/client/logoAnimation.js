import { prefersReducedMotion } from '../lib/motion.js';

const ROUND_START_CLASS = 'logo-round-start';

let animationEndHandler = null;

// проигрывает волновую анимацию логотипа в начале раунда; логотип статичен
// (задаётся в разметке) и не относится к модулю Panel, поэтому управляется отдельно
export function playLogoRoundStart() {
  const logo = document.getElementById('logo');

  if (!logo || prefersReducedMotion()) {
    return;
  }

  if (animationEndHandler) {
    logo.removeEventListener('animationend', animationEndHandler);
  }

  logo.classList.remove(ROUND_START_CLASS);
  void logo.offsetWidth; // reflow: перезапускает анимацию при повторном раунде
  logo.classList.add(ROUND_START_CLASS);

  animationEndHandler = () => {
    logo.classList.remove(ROUND_START_CLASS);
    animationEndHandler = null;
  };

  logo.addEventListener('animationend', animationEndHandler, { once: true });
}
