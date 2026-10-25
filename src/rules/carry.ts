import type { RuleSet } from './ruleSets';

export type CarryAction = 'pickup' | 'catch' | 'bounce' | 'solo';
export type CarryResult = { ok: true } | { ok: false; foul: 'overcarry' | 'doubleBounce' };

/**
 * Tracks one player's carry: the step count and the rule that two bounces can't follow each other.
 * Solos can repeat without limit and a solo clears the bounce restriction.
 */
export class CarryTracker {
  steps = 0;
  lastAction: CarryAction | null = null;

  constructor(private rules: RuleSet) {}

  setRules(rules: RuleSet): void {
    this.rules = rules;
  }

  /** The player gains possession in their hands. */
  start(how: 'pickup' | 'catch'): void {
    this.steps = 0;
    this.lastAction = how;
  }

  /** Called on every foot plant while the ball is in the player's hands. */
  step(): CarryResult {
    this.steps += 1;
    if (this.steps > this.rules.maxSteps) return { ok: false, foul: 'overcarry' };
    return { ok: true };
  }

  canBounce(): boolean {
    return this.lastAction !== 'bounce';
  }

  bounce(): CarryResult {
    if (!this.canBounce()) return { ok: false, foul: 'doubleBounce' };
    this.lastAction = 'bounce';
    this.steps = 0;
    return { ok: true };
  }

  solo(): CarryResult {
    this.lastAction = 'solo';
    this.steps = 0;
    return { ok: true };
  }

  /** Steps left before the player must bounce, solo or release the ball. */
  stepsLeft(): number {
    return Math.max(0, this.rules.maxSteps - this.steps);
  }

  release(): void {
    this.steps = 0;
    this.lastAction = null;
  }
}
