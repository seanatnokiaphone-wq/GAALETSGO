/**
 * Xbox (standard layout) controller buttons mapped onto the keyboard actions, so the game logic only
 * deals with one set of controls. Index numbers follow the browser's standard gamepad mapping.
 */
const PAD_BUTTONS: [index: number, code: string][] = [
  [0, 'KeyJ'], // A: hand-pass
  [1, 'KeyO'], // B: solo
  [2, 'PadX'], // X: kick from the hands (hold for power, left stick curls), toe-pick off the ground
  [3, 'KeyK'], // Y: lofted kick (hold for power)
  [4, 'KeyF'], // LB: shoulder charge
  [5, 'ShiftLeft'], // RB: sprint
  [6, 'KeyB'], // LT: bounce
  [7, 'KeyO'], // RT: solo
  [8, 'KeyC'], // View: switch camera
  [9, 'F12'], // Menu: new game
  [10, 'ShiftLeft'], // Left stick click: sprint
  [11, 'KeyR'], // Right stick click: switch rules
];
const DEADZONE = 0.2;

/** Keyboard, controller and on-screen controls, with "pressed this frame" and "released this frame" edges. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  /** Analogue movement from the on-screen stick: x is right, y is forward, length 0 to 1. */
  readonly stick = { x: 0, y: 0 };
  /** The on-screen stick sprints when pushed to the edge; a controller uses RB instead. */
  stickSprints = false;
  /** Camera look from dragging on the pitch (pixels) and the scroll wheel, since the last frame. */
  readonly look = { dx: 0, dy: 0, zoom: 0 };
  /** A click or tap (not a drag) on the pitch since the last frame, in canvas CSS pixels. */
  click: { x: number; y: number } | null = null;
  /** Called when a controller is plugged in or removed. */
  onGamepadChange: ((connected: boolean) => void) | null = null;
  /** True while the controller's right stick is pushed; the camera goes back behind the player once it's let go. */
  rightStickHeld = false;
  /** True while the controller was the last thing used, so prompts can name its buttons. */
  usingPad = false;
  private padHeld = new Set<string>();
  private padMoving = false;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      // One physical press is one action: ignore auto-repeat, including hosts that don't flag it.
      // F12 resets the game and F1 toggles the ball camera; stop the browser's own use of it where the browser allows.
      if (e.code === 'F12' || e.code === 'F1') e.preventDefault();
      if (e.repeat || this.down.has(e.code)) return;
      this.usingPad = false;
      this.press(e.code);
    });
    target.addEventListener('keyup', (e) => this.release(e.code));
    target.addEventListener('blur', () => this.down.clear());
    target.addEventListener('gamepadconnected', () => this.onGamepadChange?.(true));
    target.addEventListener('gamepaddisconnected', () => this.onGamepadChange?.(false));
  }

  /** Dragging with the mouse or a finger on `el` pans the camera; the wheel zooms. */
  attachLook(el: HTMLElement): void {
    let active: number | null = null;
    let lastX = 0;
    let lastY = 0;
    let travelled = 0;
    el.addEventListener('pointerdown', (e) => {
      if (active !== null) return;
      active = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      travelled = 0;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Some embedded hosts refuse capture; dragging still works while the pointer stays on the canvas.
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== active) return;
      this.look.dx += e.clientX - lastX;
      this.look.dy += e.clientY - lastY;
      travelled += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
    });
    el.addEventListener('pointerup', (e) => {
      if (e.pointerId !== active) return;
      active = null;
      // A press that barely moved is a click: face that spot.
      if (travelled < 8) {
        const r = el.getBoundingClientRect();
        this.click = { x: e.clientX - r.left, y: e.clientY - r.top };
      }
    });
    el.addEventListener('pointercancel', (e) => {
      if (e.pointerId === active) active = null;
    });
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

  /** Reads the first connected controller. Call once at the start of every frame. */
  pollGamepad(dt: number): void {
    let pad: Gamepad | null = null;
    try {
      pad = Array.from(navigator.getGamepads?.() ?? []).find((p) => p?.connected) ?? null;
    } catch {
      return; // The page isn't allowed to use controllers.
    }
    if (!pad) return;

    const wanted = new Set<string>();
    for (const [i, code] of PAD_BUTTONS) {
      const b = pad.buttons[i];
      if (b && (b.pressed || b.value > 0.5)) wanted.add(code);
    }
    if (wanted.size > 0) this.usingPad = true;
    for (const code of wanted) if (!this.padHeld.has(code)) this.press(code);
    for (const code of this.padHeld) if (!wanted.has(code)) this.release(code);
    this.padHeld = wanted;

    // Left stick moves (pushed fully, it sprints like the touch stick); the d-pad works too.
    let x = pad.axes[0] ?? 0;
    let y = -(pad.axes[1] ?? 0);
    if (pad.buttons[12]?.pressed) y = 1;
    if (pad.buttons[13]?.pressed) y = -1;
    if (pad.buttons[14]?.pressed) x = -1;
    if (pad.buttons[15]?.pressed) x = 1;
    if (Math.hypot(x, y) > DEADZONE) {
      this.stick.x = x;
      this.stick.y = y;
      this.padMoving = true;
      this.usingPad = true;
      this.stickSprints = false;
    } else if (this.padMoving) {
      this.stick.x = 0;
      this.stick.y = 0;
      this.padMoving = false;
    }

    // Right stick turns the camera like a mouse drag.
    const rx = pad.axes[2] ?? 0;
    const ry = pad.axes[3] ?? 0;
    if (Math.abs(rx) > DEADZONE) this.look.dx += rx * 900 * dt;
    if (Math.abs(ry) > DEADZONE) this.look.dy += ry * 500 * dt;
    this.rightStickHeld = Math.abs(rx) > DEADZONE || Math.abs(ry) > DEADZONE;
  }

  /** Call once at the end of every frame. */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.look.dx = 0;
    this.look.dy = 0;
    this.look.zoom = 0;
    this.click = null;
  }
}
