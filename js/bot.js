// FOUR IN A ROWBOAT — the two computer opponents.
//
// This module only talks to the engine through its public API (legalMoves,
// applyMove, getStatus, and the exported constants) plus reading the plain
// state object. No rule logic lives here — if the engine says a move is
// legal, it's legal.
//
//   PADDLER — shallow lookahead with real randomness. Takes an open win,
//             usually (not always) blocks yours, and sometimes just enjoys
//             the scenery. A kid can beat the Paddler.
//   SKIPPER — negamax with alpha-beta pruning and center-first move
//             ordering, iteratively deepened from 6 to 8 plies under a time
//             budget: depth 6 always completes (a few ms), deeper passes run
//             only while the clock allows, so a move always lands in well
//             under 300ms — even on a mid-range phone.

import {
  ROWS, COLS, EMPTY, RED, GOLD, legalMoves, applyMove, getStatus,
} from './engine.js';

const WIN_SCORE = 1_000_000;
const MIN_DEPTH = 6; // this pass always runs to completion
const MAX_DEPTH = 8;
const TIME_BUDGET_MS = 200;
// Try the middle of the boat first — center columns win more, and good
// ordering is what makes alpha-beta pruning fast.
const ORDER = [3, 2, 4, 1, 5, 0, 6];

/** Pick a column for the side to move. level: 'paddler' | 'skipper'. */
export function chooseMove(state, level) {
  const moves = legalMoves(state);
  if (moves.length === 0) throw new Error('No legal moves — the game is over.');
  return level === 'skipper' ? skipperMove(state, moves) : paddlerMove(state, moves);
}

/* ------------------------------------------------------------- Paddler */

function paddlerMove(state, moves) {
  // Always grab a win that's sitting right there — even a beginner does that.
  const winNow = moves.find((c) => getStatus(applyMove(state, c)).winner !== null);
  if (winNow !== undefined) return winNow;

  // Block an immediate loss... most of the time. The 25% miss rate is the
  // whole reason a kid can beat the Paddler.
  const me = state.turn;
  const them = me === RED ? GOLD : RED;
  const theirState = { grid: state.grid, turn: them };
  const block = legalMoves(theirState).find(
    (c) => getStatus(applyMove(theirState, c)).winner !== null
  );
  if (block !== undefined && moves.includes(block) && Math.random() < 0.75) return block;

  // Occasionally drift with the current: any legal column at all.
  if (Math.random() < 0.2) return moves[Math.floor(Math.random() * moves.length)];

  // Otherwise a 2-ply peek: avoid handing over a win, lean toward the middle.
  let best = [];
  let bestScore = -Infinity;
  for (const col of moves) {
    const next = applyMove(state, col);
    const givesWin = legalMoves(next).some(
      (c) => getStatus(applyMove(next, c)).winner !== null
    );
    const score = (givesWin ? -100 : 0) + (3 - Math.abs(col - 3)) + Math.random() * 2;
    if (score > bestScore + 1e-9) {
      bestScore = score;
      best = [col];
    } else if (Math.abs(score - bestScore) <= 1e-9) {
      best.push(col);
    }
  }
  return best[Math.floor(Math.random() * best.length)];
}

/* ------------------------------------------------------------- Skipper */

// Search bookkeeping for the time budget. The clock lives here in bot.js —
// the engine itself stays clock-free and pure.
let deadline = 0;
let abortable = false;
let aborted = false;
let nodeCount = 0;

function now() {
  return (typeof performance !== 'undefined' ? performance : Date).now();
}

function skipperMove(state, moves) {
  // A win sitting on the surface needs no search.
  const winNow = moves.find((c) => getStatus(applyMove(state, c)).winner !== null);
  if (winNow !== undefined) return winNow;

  const ordered = ORDER.filter((c) => moves.includes(c));
  deadline = now() + TIME_BUDGET_MS;
  let bestCol = ordered[0];
  for (let depth = MIN_DEPTH; depth <= MAX_DEPTH; depth++) {
    abortable = depth > MIN_DEPTH; // the floor pass must finish, and does in a few ms
    aborted = false;
    nodeCount = 0;
    const col = rootSearch(state, ordered, depth);
    if (aborted) break; // out of time mid-pass: keep the previous depth's answer
    bestCol = col;
    if (now() >= deadline) break;
  }
  return bestCol;
}

function rootSearch(state, ordered, depth) {
  let bestCol = ordered[0];
  let alpha = -Infinity;
  for (const col of ordered) {
    const score = -negamax(applyMove(state, col), depth - 1, -Infinity, -alpha);
    if (aborted) break;
    if (score > alpha) {
      alpha = score;
      bestCol = col;
    }
  }
  return bestCol;
}

// Score from the perspective of the side to move in `state`.
function negamax(state, depth, alpha, beta) {
  if (abortable && (++nodeCount & 2047) === 0 && now() >= deadline) {
    aborted = true;
  }
  if (aborted) return 0; // value is discarded once aborted

  const status = getStatus(state);
  if (status.winner !== null) {
    // The player who just moved won; that's a loss for the side to move.
    // Add depth so nearer wins (and farther losses) score better.
    return -(WIN_SCORE + depth);
  }
  if (status.draw) return 0;
  if (depth === 0) return evaluate(state.grid, state.turn);

  for (const col of ORDER) {
    if (state.grid[ROWS - 1][col] !== EMPTY) continue;
    const score = -negamax(applyMove(state, col), depth - 1, -beta, -alpha);
    if (aborted) return 0;
    if (score >= beta) return score;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

// Heuristic for non-terminal leaves: score every 4-cell window on the board,
// from the point of view of player `me`.
function evaluate(grid, me) {
  const them = me === RED ? GOLD : RED;
  let score = 0;

  // Buoys in the center column control the most windows.
  for (let r = 0; r < ROWS; r++) {
    if (grid[r][3] === me) score += 3;
    else if (grid[r][3] === them) score -= 3;
  }

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 3 < COLS) score += windowScore(grid, me, them, r, c, 0, 1);
      if (r + 3 < ROWS) {
        score += windowScore(grid, me, them, r, c, 1, 0);
        if (c + 3 < COLS) score += windowScore(grid, me, them, r, c, 1, 1);
        if (c - 3 >= 0) score += windowScore(grid, me, them, r, c, 1, -1);
      }
    }
  }
  return score;
}

function windowScore(grid, me, them, r, c, dr, dc) {
  let mine = 0;
  let theirs = 0;
  for (let i = 0; i < 4; i++) {
    const v = grid[r + dr * i][c + dc * i];
    if (v === me) mine++;
    else if (v === them) theirs++;
  }
  if (mine > 0 && theirs > 0) return 0; // dead window
  if (mine === 3) return 40;
  if (mine === 2) return 6;
  if (theirs === 3) return -45;
  if (theirs === 2) return -6;
  return 0;
}
