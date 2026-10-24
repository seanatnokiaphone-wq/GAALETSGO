/** Keyboard and on-screen controls, with "pressed this frame" and "released this frame" edges. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  /** Analogue movement from the on-screen stick: x is right, y is forward, length 0 to 1. */
  readonly stick = { x: 0, y: 0 };
  /** Camera look from dragging on the pitch (pixels) and the scroll wheel, since the last frame. */
  readonly look = { dx: 0, dy: 0, zoom: 0 };

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      // One physical press is one action: ignore auto-repeat, including hosts that don't flag it.
      if (e.repeat || this.down.has(e.code)) return;
      this.press(e.code);
    });
    target.addEventListener('keyup', (e) => this.release(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  /** Dragging with the mouse or a finger on `el` pans the camera; the wheel zooms. */
  attachLook(el: HTMLElement): void {
    let active: number | null = null;
    let lastX = 0;
    let lastY = 0;
    el.addEventListener('pointerdown', (e) => {
      if (active !== null) return;
      active = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== active) return;
      this.look.dx += e.clientX - lastX;
      this.look.dy += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === active) active = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.look.zoom += Math.sign(e.deltaY);
      },
      { passive: false },
    );
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  press(code: string): void {
    if (this.down.has(code)) return;
    this.down.add(code);
    this.pressed.add(code);
  }

  release(code: string): void {
    if (!this.down.delete(code)) return;
    this.released.add(code);
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  wasReleased(code: string): boolean {
    return this.released.has(code);
  }

  /** Call once at the end of every frame. */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.look.dx = 0;
    this.look.dy = 0;
    this.look.zoom = 0;
  }
}
