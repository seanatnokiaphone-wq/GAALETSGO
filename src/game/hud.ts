import { formatScore, type RuleSet, type TeamScore } from '../rules';

/** HTML overlay: score bug, step meter, prompts and banners. */
export class Hud {
  private el = (id: string) => document.getElementById(id) as HTMLElement;
  private bannerTimer = 0;

  setScore(home: TeamScore, away: TeamScore): void {
    this.el('score-home').textContent = formatScore(home);
    this.el('score-away').textContent = formatScore(away);
  }

  setClock(seconds: number): void {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    this.el('clock').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  setRules(rules: RuleSet): void {
    this.el('rules').textContent = rules.name;
  }

  /** stepsTaken out of max; null hides the meter when the player doesn't have the ball in hand. */
  setSteps(stepsTaken: number | null, max: number, canBounce: boolean): void {
    const meter = this.el('steps');
    meter.hidden = stepsTaken === null;
    if (stepsTaken === null) return;
    const pips = meter.querySelectorAll<HTMLElement>('b');
    pips.forEach((p, i) => {
      p.className = i < stepsTaken ? (stepsTaken >= max ? 'warn' : 'on') : '';
    });
    const hint = this.el('steps-hint');
    hint.textContent = stepsTaken >= max ? (canBounce ? 'BOUNCE OR SOLO' : 'SOLO NOW') : canBounce ? '' : 'NO BOUNCE';
    hint.className = stepsTaken >= max ? 'warn' : '';
  }

  setPrompt(text: string): void {
    const p = this.el('prompt');
    p.textContent = text;
    p.hidden = text === '';
  }

  /** Kick power 0 to 1 (null hides the bar), and curl from -1 (left) to 1 (right) for a kick that bends. */
  setPower(power: number | null, curl: number | null = null): void {
    const bar = this.el('power');
    bar.hidden = power === null;
    if (power !== null) (bar.firstElementChild as HTMLElement).style.width = `${Math.round(power * 100)}%`;
    const meter = this.el('curl');
    meter.hidden = power === null || curl === null;
    if (power === null || curl === null) return;
    (meter.querySelector('b') as HTMLElement).style.left = `${50 + curl * 50}%`;
    const side = Math.abs(curl) < 0.1 ? 'STRAIGHT' : `${curl < 0 ? '◀ LEFT' : 'RIGHT ▶'} ${Math.round(Math.abs(curl) * 100)}%`;
    this.el('curl-label').textContent = `CURL ${side}`;
  }

  /**
   * The ball marker: over the ball when it's on screen, or at the screen edge with an arrow pointing to
   * it (angle in radians, screen axes) when it isn't. null hides it.
   */
  setBallMarker(m: { x: number; y: number; edge: boolean; angle: number; dist: number } | null): void {
    const el = this.el('ballmark');
    el.hidden = m === null;
    if (!m) return;
    el.classList.toggle('edge', m.edge);
    el.style.transform = `translate(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px)`;
    (el.querySelector('i') as HTMLElement).style.transform = m.edge ? `rotate(${m.angle.toFixed(3)}rad)` : '';
    (el.querySelector('span') as HTMLElement).textContent = `${Math.round(m.dist)} m`;
  }

  banner(title: string, sub = '', seconds = 2.2): void {
    this.el('banner-title').textContent = title;
    this.el('banner-sub').textContent = sub;
    this.el('banner').hidden = false;
    this.bannerTimer = seconds;
  }

  update(dt: number): void {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.el('banner').hidden = true;
    }
  }
}
