# FOUR IN A ROWBOAT 🚣🔴🟡

Connect 4, Burlington style: drop red and gold **buoys** into a rowboat
floating on Lake Champlain and line up four — across, up, or on the diagonal —
before your rival does. Champ pops up to celebrate the winner. A game for
[Btown Games](https://play.btownbrief.com/), the browser arcade of the
[BTown Brief](https://www.btownbrief.com).

**Play it live:** https://play.btownbrief.com/four-in-a-rowboat/

## Modes

- **Pass & play** — two captains, one phone (the default).
- **The Paddler** 🛶 — shallow lookahead plus genuine randomness; beatable by a kid.
- **The Skipper** ⛵ — minimax with alpha–beta pruning, 8 plies deep. Moves in
  well under 300ms and does not go easy on you.

## How it works

Plain static site — no build step, no frameworks, no npm. `index.html` +
`style.css` + ES modules in `js/`:

| file | what it does |
| --- | --- |
| `js/engine.js` | **all** the Connect 4 rules, as pure functions over a plain JSON state object — see the rule below |
| `js/bot.js` | the Paddler and the Skipper; only ever calls the engine's public API |
| `js/main.js` | UI only: renders state, animates buoy drops, dispatches moves, keeps the session tally |
| `js/audio.js` | procedural WebAudio plops and fanfares, no audio files |
| `js/leaderboard.js` | monthly leaderboard client (Supabase); vs-bot wins only, no accounts |

Every push to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`.

## The engine rule (the one non-negotiable)

Online multiplayer gets bolted on later by syncing the engine's state object
between phones. That only works if **every** rule lives in `js/engine.js`:

- `createInitialState()`, `legalMoves(state)`, `applyMove(state, move)` (returns
  a NEW state, never mutates), `getStatus(state)`.
- `engine.js` imports nothing and never touches the DOM, timers, `Date`, or
  `Math.random`.
- The whole game survives `JSON.stringify` → `JSON.parse` → resume.

If you add a rule anywhere else, you've broken the multiplayer plan.

## Testing

```bash
node scripts/test-engine.mjs
```

Plain Node, no test framework. Covers all four win directions, draws, illegal
moves, state immutability, the JSON round trip, and that the Skipper takes and
blocks immediate wins fast enough.

## Regenerating the app icon

`icon-180.png` is rendered from `icon.svg`:

```bash
chrome --headless --screenshot=icon-180.png --window-size=180,180 --default-background-color=00000000 "file://$(pwd)/icon.svg"
```
