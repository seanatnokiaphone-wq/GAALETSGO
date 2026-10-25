import { HALF_LENGTH, PITCH, type RuleSet } from './ruleSets';
import type { ScoreKind } from './score';

export type ShotMethod = 'kick' | 'handPass';

export interface GoalLineCrossing {
  /** Height of the ball (centre) as it crosses the end line, metres. */
  y: number;
  /** Position across the pitch as it crosses, metres from the centre line of the goal. */
  z: number;
  method: ShotMethod;
  /** Where the shot was struck from, in pitch coordinates. */
  fromX: number;
  fromZ: number;
  /** End line being attacked: +1 for x = +72.5, -1 for x = -72.5. */
  end: 1 | -1;
}

export type CrossingResult =
  | { kind: ScoreKind }
  | { kind: 'wide' }
  | { kind: 'disallowed'; reason: 'handPassedGoal' | 'handPassedPoint' };

const BALL_RADIUS = 0.11;

export function distanceFromGoal(x: number, z: number, end: 1 | -1): number {
  return Math.hypot(end * HALF_LENGTH - x, z);
}

/** Decides what a ball crossing the end line is worth under the given rules. */
export function classifyCrossing(c: GoalLineCrossing, rules: RuleSet): CrossingResult {
  const halfGoal = PITCH.goalWidth / 2;
  // The whole ball must pass inside the posts.
  if (Math.abs(c.z) > halfGoal - BALL_RADIUS) return { kind: 'wide' };

  if (c.y < PITCH.crossbarHeight) {
    if (c.method === 'handPass' && !rules.handPassedGoalsAllowed) {
      return { kind: 'disallowed', reason: 'handPassedGoal' };
    }
    return { kind: 'goal' };
  }

  if (c.method === 'handPass' && !rules.handPassedPointsAllowed) {
    return { kind: 'disallowed', reason: 'handPassedPoint' };
  }
  const arc = rules.twoPointArcRadius;
  if (arc !== null && c.method === 'kick' && distanceFromGoal(c.fromX, c.fromZ, c.end) > arc) {
    return { kind: 'twoPoint' };
  }
  return { kind: 'point' };
}
