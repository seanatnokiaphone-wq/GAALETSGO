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

  setPower(power: number | null): void {
    const bar = this.el('power');
    bar.hidden = power === null;
    if (power !== null) (bar.firstElementChild as HTMLElement).style.width = `${Math.round(power * 100)}%`;
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
