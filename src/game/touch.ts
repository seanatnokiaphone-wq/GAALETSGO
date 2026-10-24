import type { Input } from './input';

const BUTTONS: { code: string; label: string; cls: string }[] = [
  { code: 'KeyK', label: 'Kick', cls: 'kick' },
  { code: 'KeyJ', label: 'Hand-pass', cls: 'pass' },
  { code: 'KeyO', label: 'Solo', cls: 'solo' },
  { code: 'KeyB', label: 'Bounce', cls: 'bounce' },
  { code: 'KeyL', label: 'Low kick', cls: 'low' },
  { code: 'KeyE', label: 'Toe-pick', cls: 'pick' },
];

/** On-screen stick and buttons for phones and tablets. Pushing the stick to the edge sprints. */
export function createTouchControls(input: Input, root: HTMLElement): void {
  const pad = document.createElement('div');
  pad.className = 'touch';
  pad.innerHTML = `<div class="stick"><div class="knob"></div></div>
    <div class="buttons">${BUTTONS.map((b) => `<button type="button" class="${b.cls}" data-code="${b.code}">${b.label}</button>`).join('')}</div>
    <div class="top-buttons"><button type="button" data-code="KeyC">Camera</button><button type="button" data-code="KeyV">Reset view</button><button type="button" data-code="KeyR">Rules</button></div>`;
  root.appendChild(pad);

  pad.querySelectorAll<HTMLButtonElement>('button[data-code]').forEach((btn) => {
    const code = btn.dataset.code!;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      btn.classList.add('down');
      input.press(code);
    });
    const up = () => {
      btn.classList.remove('down');
      input.release(code);
    };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
  });

  const stick = pad.querySelector<HTMLElement>('.stick')!;
  const knob = pad.querySelector<HTMLElement>('.knob')!;
  let active: number | null = null;
  const move = (e: PointerEvent) => {
    const r = stick.getBoundingClientRect();
    const radius = r.width / 2;
    let dx = (e.clientX - (r.left + radius)) / radius;
    let dy = (e.clientY - (r.top + radius)) / radius;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    input.stick.x = dx;
    input.stick.y = -dy;
    knob.style.transform = `translate(${dx * radius * 0.6}px, ${dy * radius * 0.6}px)`;
  };
  stick.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    active = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    move(e);
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId === active) move(e);
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== active) return;
    active = null;
    input.stick.x = 0;
    input.stick.y = 0;
    knob.style.transform = '';
  };
  stick.addEventListener('pointerup', end);
  stick.addEventListener('pointercancel', end);
}
