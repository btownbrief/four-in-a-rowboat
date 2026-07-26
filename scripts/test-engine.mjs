// FOUR IN A ROWBOAT — engine + bot checks. Plain Node, no test framework.
// Run with:  node scripts/test-engine.mjs

import {
  ROWS, COLS, RED, GOLD, createInitialState, legalMoves, applyMove, getStatus,
} from '../js/engine.js';
import { chooseMove } from '../js/bot.js';

let passed = 0;

function assert(condition, label) {
  if (!condition) {
    console.error(`✗ FAIL: ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`✓ ${label}`);
}

/** Play a list of columns from a fresh board (players alternate automatically). */
function play(cols) {
  let state = createInitialState();
  for (const c of cols) state = applyMove(state, c);
  return state;
}

function sameLine(winLine, cells) {
  const key = (p) => `${p.row},${p.col}`;
  const got = new Set(winLine.map(key));
  return cells.every(([row, col]) => got.has(key({ row, col })));
}

/* ---------------------------------------------------------- basics */

{
  const s = createInitialState();
  const st = getStatus(s);
  assert(!st.over && st.turn === RED && st.winner === null, 'fresh board: red to move, nobody has won');
  assert(legalMoves(s).length === COLS, 'fresh board: all 7 columns are legal');
}

{
  // State must survive a JSON round trip — that's the multiplayer plan.
  let s = play([3, 3, 4]);
  s = JSON.parse(JSON.stringify(s));
  s = applyMove(s, 4);
  assert(s.grid[1][4] === GOLD && getStatus(s).turn === RED, 'state survives JSON.stringify → parse → resume');
}

{
  // applyMove must never mutate its input.
  const before = play([3, 3]);
  const snapshot = JSON.stringify(before);
  applyMove(before, 0);
  assert(JSON.stringify(before) === snapshot, 'applyMove returns a new state, never mutates');
}

/* ---------------------------------------------------------- win detection */

{
  // Red across the bottom row: cols 0-3.  R G R G R G R
  const s = play([0, 0, 1, 1, 2, 2, 3]);
  const st = getStatus(s);
  assert(st.over && st.winner === RED, 'horizontal win detected');
  assert(sameLine(st.winLine, [[0, 0], [0, 1], [0, 2], [0, 3]]), 'horizontal winLine is the right four cells');
  assert(legalMoves(s).length === 0, 'no legal moves after a win');
}

{
  // Red stacks column 5 four high.
  const s = play([5, 0, 5, 1, 5, 2, 5]);
  const st = getStatus(s);
  assert(st.over && st.winner === RED, 'vertical win detected');
  assert(sameLine(st.winLine, [[0, 5], [1, 5], [2, 5], [3, 5]]), 'vertical winLine is the right four cells');
}

{
  // Rising diagonal for red: (0,0) (1,1) (2,2) (3,3).
  const s = play([0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]);
  const st = getStatus(s);
  assert(st.over && st.winner === RED, 'diagonal ↗ win detected');
  assert(sameLine(st.winLine, [[0, 0], [1, 1], [2, 2], [3, 3]]), 'diagonal ↗ winLine is the right four cells');
}

{
  // Falling diagonal for red: (3,0) (2,1) (1,2) (0,3).
  const s = play([3, 2, 2, 1, 1, 0, 1, 0, 0, 6, 0]);
  const st = getStatus(s);
  assert(st.over && st.winner === RED, 'diagonal ↘ win detected');
  assert(sameLine(st.winLine, [[3, 0], [2, 1], [1, 2], [0, 3]]), 'diagonal ↘ winLine is the right four cells');
}

/* ---------------------------------------------------------- draw */

{
  // Fill all 42 cells with no four-in-a-row (sequence pre-solved so neither
  // side ever lines up four along the way).
  const order = [
    0, 0, 0, 0, 0, 0, 3, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3,
    3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 4,
  ];
  let state = createInitialState();
  for (const c of order) {
    state = applyMove(state, c);
    const st = getStatus(state);
    if (st.over && !st.draw) assert(false, 'draw sequence hit an accidental win');
  }
  const st = getStatus(state);
  assert(ROWS * COLS === order.length, 'draw sequence fills all 42 cells');
  assert(st.over && st.draw && st.winner === null, 'full board with no winner is a draw');
  assert(legalMoves(state).length === 0, 'no legal moves on a drawn board');
}

/* ---------------------------------------------------------- illegal moves */

{
  // Stuff column 6 to the top, then try once more.
  const s = play([6, 6, 6, 6, 6, 6]);
  assert(!legalMoves(s).includes(6), 'full column is not a legal move');
  let threw = false;
  try {
    applyMove(s, 6);
  } catch {
    threw = true;
  }
  assert(threw, 'move into a full column is rejected');
}

{
  let threw = false;
  try {
    applyMove(createInitialState(), 7);
  } catch {
    threw = true;
  }
  assert(threw, 'move into a nonexistent column is rejected');
}

/* ---------------------------------------------------------- Skipper */

{
  // Gold (Skipper) has 3 stacked in column 0 — it must take the win.
  // R:1  G:0  R:2  G:0  R:3  G:0  R:5 → gold to move, col 0 wins.
  const s = play([1, 0, 2, 0, 3, 0, 5]);
  const t0 = performance.now();
  const move = chooseMove(s, 'skipper');
  const ms = performance.now() - t0;
  assert(move === 0, 'Skipper takes its own immediate win');
  console.log(`  (Skipper decided in ${ms.toFixed(0)}ms)`);
}

{
  // Red threatens 0-1-2-3 across the bottom; gold (Skipper) must block col 3.
  // R:0  G:0  R:1  G:1  R:2 → gold to move.
  const s = play([0, 0, 1, 1, 2]);
  const t0 = performance.now();
  const move = chooseMove(s, 'skipper');
  const ms = performance.now() - t0;
  assert(move === 3, "Skipper blocks the opponent's immediate win");
  console.log(`  (Skipper decided in ${ms.toFixed(0)}ms)`);
}

{
  // Speed check on the slowest position there is: the empty board.
  const t0 = performance.now();
  const move = chooseMove(createInitialState(), 'skipper');
  const ms = performance.now() - t0;
  assert(legalMoves(createInitialState()).includes(move), 'Skipper opens with a legal move');
  console.log(`  (Skipper's opening move took ${ms.toFixed(0)}ms — target ≈300ms)`);
  assert(ms < 800, 'Skipper moves fast enough');
}

{
  // Paddler sanity: always returns a legal move, and takes a gift win.
  const s = play([1, 0, 2, 0, 3, 0, 5]); // gold to move, col 0 wins
  assert(chooseMove(s, 'paddler') === 0, 'Paddler takes an immediate win');
  for (let i = 0; i < 50; i++) {
    const m = chooseMove(createInitialState(), 'paddler');
    if (!legalMoves(createInitialState()).includes(m)) {
      assert(false, 'Paddler only plays legal moves');
    }
  }
  assert(true, 'Paddler only plays legal moves (50 random openings)');
}

console.log(`\n⛵ All ${passed} checks passed. Ship it.`);
