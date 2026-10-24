# GAALETSGO

A third-person Gaelic football game for the browser, built with Vite, TypeScript, Babylon.js and Havok physics.

![A goal in the first playable slice](docs/goal.jpg)

This is the first playable slice: one Ardmore player on a full-size pitch who can run, carry, bounce, solo, toe-pick, kick and hand-pass, with the rules engine calling steps, double bounces, pick-ups and scores. Everyone else stands in formation until team AI arrives.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # rules engine unit tests
npm run build    # production build in dist/
```

Add `?rules=2025` to the URL to start with the 2025 rules, or press **R** in game to switch.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move (relative to the camera) |
| Shift | Sprint |
| O | Solo (resets the step count) |
| B | Bounce (resets the step count, not twice in a row) |
| J | Hand-pass |
| K (hold) | Lofted kick, hold longer for more power |
| L (hold) | Low drilled kick, for goal shots |
| E | Toe-pick a ball on the ground |
| G | Pick up with the hands (a foul, to show the rule) |
| C | Switch between the behind-the-player and broadcast cameras |
| R | Switch between classic and 2025 rules |

## Rules

Rule sets live in `src/rules/ruleSets.ts`:

- **Classic**: 4 steps, goals 3, points 1. Hand-passed goals are not allowed; hand-passed points are.
- **2025 rules** (option): adds the 40 m two-point arc for kicked points, kick-outs past the arc, 3 up and 4 back, and 50 m free advances. These values still need checking against the current GAA Official Guide.

Scores are shown as goals-points (total), for example `2-12 (18)`.

## Layout

```
src/
  rules/   pure TypeScript rules engine (rule sets, scoring, carry tracking), unit tested
  scene/   pitch and markings, stadium and crowd, H-posts, greybox players, lighting
  game/    ball (Havok body + air drag), input, HUD, and the match slice
tests/     Vitest tests for the rules engine
```
