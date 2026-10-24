/** Keyboard and on-screen controls, with "pressed this frame" and "released this frame" edges. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  /** Analogue movement from the on-screen stick: x is right, y is forward, length 0 to 1. */
  readonly stick = { x: 0, y: 0 };

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.press(e.code);
    });
    target.addEventListener('keyup', (e) => this.release(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  press(code: string): void {
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
  }
}
