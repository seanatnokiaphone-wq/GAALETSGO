export interface TeamScore {
  goals: number;
  points: number;
}

export const emptyScore = (): TeamScore => ({ goals: 0, points: 0 });

export const total = (s: TeamScore): number => s.goals * 3 + s.points;

/** Goals-points (total), the way Gaelic scores are shown: 2-12 (18). */
export const formatScore = (s: TeamScore): string =>
  `${s.goals}-${String(s.points).padStart(2, '0')} (${total(s)})`;

export type ScoreKind = 'goal' | 'point' | 'twoPoint';

export function addScore(s: TeamScore, kind: ScoreKind): TeamScore {
  if (kind === 'goal') return { ...s, goals: s.goals + 1 };
  return { ...s, points: s.points + (kind === 'twoPoint' ? 2 : 1) };
}
