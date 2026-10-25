/** Pitch geometry shared by the rules and the renderer. Metres, origin at the centre spot, x along the length. */
export const PITCH = {
  length: 145,
  width: 88,
  goalWidth: 6.5, // inside of the posts
  crossbarHeight: 2.5,
  postHeight: 7.5,
} as const;

export const HALF_LENGTH = PITCH.length / 2;
export const HALF_WIDTH = PITCH.width / 2;

export type RuleSetId = 'classic' | 'enhanced2025';

export interface RuleSet {
  id: RuleSetId;
  name: string;
  /** Steps a player may take carrying the ball before they must bounce, solo or release it. */
  maxSteps: number;
  /** A goal scored with an open-hand or fisted pass. Off in both sets. */
  handPassedGoalsAllowed: boolean;
  /** A point scored with an open-hand or fisted pass. */
  handPassedPointsAllowed: boolean;
  /** Kicked points from outside this arc (radius from the centre of the goal) are worth 2. null = no arc. */
  twoPointArcRadius: number | null;
  /** Kick-outs must travel beyond the two-point arc. */
  kickoutMustClearArc: boolean;
  /** At least 3 outfield players in the opposition half and 4 (with the keeper) in their own half. */
  threeUpFourBack: boolean;
  /** Metres a free is advanced for dissent or not retreating. */
  freeAdvanceMetres: number;
  halfLengthMinutes: number;
}

export const CLASSIC: RuleSet = {
  id: 'classic',
  name: 'Classic rules',
  maxSteps: 4,
  handPassedGoalsAllowed: false,
  handPassedPointsAllowed: true,
  twoPointArcRadius: null,
  kickoutMustClearArc: false,
  threeUpFourBack: false,
  freeAdvanceMetres: 13,
  halfLengthMinutes: 35,
};

// From the GAA's 2025 rule changes. Check each value against the current Official Guide before release.
export const ENHANCED_2025: RuleSet = {
  ...CLASSIC,
  id: 'enhanced2025',
  name: '2025 rules',
  twoPointArcRadius: 40,
  kickoutMustClearArc: true,
  threeUpFourBack: true,
  freeAdvanceMetres: 50,
};

export const RULE_SETS: Record<RuleSetId, RuleSet> = { classic: CLASSIC, enhanced2025: ENHANCED_2025 };
