import { describe, expect, it } from 'vitest';
import {
  CLASSIC,
  ENHANCED_2025,
  CarryTracker,
  addScore,
  classifyCrossing,
  emptyScore,
  formatScore,
  total,
  type GoalLineCrossing,
} from '../src/rules';

describe('score display', () => {
  it('shows goals-points (total)', () => {
    expect(formatScore({ goals: 2, points: 12 })).toBe('2-12 (18)');
    expect(formatScore({ goals: 0, points: 7 })).toBe('0-07 (7)');
  });

  it('adds goals, points and two-pointers', () => {
    let s = emptyScore();
    s = addScore(s, 'goal');
    s = addScore(s, 'point');
    s = addScore(s, 'twoPoint');
    expect(s).toEqual({ goals: 1, points: 3 });
    expect(total(s)).toBe(6);
  });
});

describe('carrying the ball', () => {
  it('allows four steps and calls a foul on the fifth', () => {
    const c = new CarryTracker(CLASSIC);
    c.start('catch');
    for (let i = 0; i < 4; i++) expect(c.step().ok).toBe(true);
    expect(c.step()).toEqual({ ok: false, foul: 'overcarry' });
  });

  it('resets the count on a solo or bounce', () => {
    const c = new CarryTracker(CLASSIC);
    c.start('pickup');
    c.step(); c.step(); c.step(); c.step();
    c.solo();
    expect(c.stepsLeft()).toBe(4);
    c.step(); c.step(); c.step(); c.step();
    expect(c.bounce().ok).toBe(true);
    expect(c.step().ok).toBe(true);
  });

  it('does not allow two bounces in a row', () => {
    const c = new CarryTracker(CLASSIC);
    c.start('catch');
    expect(c.bounce().ok).toBe(true);
    expect(c.canBounce()).toBe(false);
    expect(c.bounce()).toEqual({ ok: false, foul: 'doubleBounce' });
  });

  it('allows bounce, solo, bounce and endless solos', () => {
    const c = new CarryTracker(CLASSIC);
    c.start('catch');
    expect(c.bounce().ok).toBe(true);
    expect(c.solo().ok).toBe(true);
    expect(c.bounce().ok).toBe(true);
    for (let i = 0; i < 10; i++) expect(c.solo().ok).toBe(true);
  });
});

describe('ball crossing the end line', () => {
  const shot = (o: Partial<GoalLineCrossing>): GoalLineCrossing => ({
    y: 1, z: 0, method: 'kick', fromX: 50, fromZ: 0, end: 1, ...o,
  });

  it('scores a goal under the bar and a point over it', () => {
    expect(classifyCrossing(shot({ y: 1.2 }), CLASSIC)).toEqual({ kind: 'goal' });
    expect(classifyCrossing(shot({ y: 4 }), CLASSIC)).toEqual({ kind: 'point' });
  });

  it('calls a wide outside the posts', () => {
    expect(classifyCrossing(shot({ y: 4, z: 3.4 }), CLASSIC)).toEqual({ kind: 'wide' });
  });

  it('disallows hand-passed goals but allows hand-passed points', () => {
    expect(classifyCrossing(shot({ y: 1, method: 'handPass' }), CLASSIC)).toEqual({
      kind: 'disallowed',
      reason: 'handPassedGoal',
    });
    expect(classifyCrossing(shot({ y: 1, method: 'handPass' }), ENHANCED_2025).kind).toBe('disallowed');
    expect(classifyCrossing(shot({ y: 4, method: 'handPass' }), CLASSIC)).toEqual({ kind: 'point' });
  });

  it('gives two points for kicks from outside the 40 m arc under 2025 rules only', () => {
    const long = shot({ y: 4, fromX: 72.5 - 42, fromZ: 5 });
    expect(classifyCrossing(long, ENHANCED_2025)).toEqual({ kind: 'twoPoint' });
    expect(classifyCrossing(long, CLASSIC)).toEqual({ kind: 'point' });
    expect(classifyCrossing({ ...long, method: 'handPass' }, ENHANCED_2025)).toEqual({ kind: 'point' });
  });

  it('measures the arc from the goal being attacked', () => {
    const fromOwnHalf = shot({ y: 4, end: -1, fromX: -72.5 + 30, fromZ: 0 });
    expect(classifyCrossing(fromOwnHalf, ENHANCED_2025)).toEqual({ kind: 'point' });
  });
});
