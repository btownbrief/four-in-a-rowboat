// FOUR IN A ROWBOAT — pure Connect 4 rules. A Btown Games production.
//
// THE ONE NON-NEGOTIABLE: everything in this file is a pure function over a
// plain JSON-serializable state object. No DOM, no timers, no Date, no
// Math.random, no imports. Online multiplayer will later sync this exact
// state object between phones, so any rule logic outside this file breaks
// that plan. The whole game must survive JSON.stringify → JSON.parse → resume.
//
// State shape: { grid, turn }
//   grid — 6 rows × 7 cols of 0 (empty) | 1 (red) | 2 (gold); row 0 is the
//          BOTTOM of the board (buoys stack upward)
//   turn — whose toss it is next, 1 or 2

export const ROWS = 6;
export const COLS = 7;
export const EMPTY = 0;
export const RED = 1;
export const GOLD = 2;
export const CONNECT = 4;

/** A fresh board. Red tosses first unless you say otherwise. */
export function createInitialState(firstPlayer = RED) {
  if (firstPlayer !== RED && firstPlayer !== GOLD) {
    throw new Error(`First player must be ${RED} (red) or ${GOLD} (gold).`);
  }
  const grid = [];
  for (let r = 0; r < ROWS; r++) grid.push(new Array(COLS).fill(EMPTY));
  return { grid, turn: firstPlayer };
}

/** Columns that can still take a buoy. Empty array once the game is over. */
export function legalMoves(state) {
  if (getStatus(state).over) return [];
  const moves = [];
  for (let c = 0; c < COLS; c++) {
    if (state.grid[ROWS - 1][c] === EMPTY) moves.push(c);
  }
  return moves;
}

/**
 * Drop the current player's buoy into `col` (0–6). Returns a NEW state —
 * the input state is never mutated. Throws if the move is illegal
 * (bad column, full column, or game already over).
 */
export function applyMove(state, col) {
  if (!Number.isInteger(col) || col < 0 || col >= COLS) {
    throw new Error(`No column ${col} on this boat (0–${COLS - 1}).`);
  }
  if (getStatus(state).over) {
    throw new Error('The game is over — no more tosses.');
  }
  const row = landingRow(state, col);
  if (row === -1) {
    throw new Error(`Column ${col} is full of buoys.`);
  }
  const grid = state.grid.map((cells, r) =>
    r === row ? cells.map((v, c) => (c === col ? state.turn : v)) : cells.slice()
  );
  return { grid, turn: state.turn === RED ? GOLD : RED };
}

/** Row (0 = bottom) where a buoy dropped in `col` would land, or -1 if full. */
export function landingRow(state, col) {
  for (let r = 0; r < ROWS; r++) {
    if (state.grid[r][col] === EMPTY) return r;
  }
  return -1;
}

/**
 * Where the game stands:
 *   { over, turn, winner, draw, winLine }
 *   over    — true once somebody won or the board is full
 *   turn    — whose toss is next (1|2), or null when over
 *   winner  — 1|2, or null
 *   draw    — true only on a full board with no winner
 *   winLine — the four winning cells as [{ row, col }, ...], or null
 */
export function getStatus(state) {
  const winLine = findWinLine(state.grid);
  if (winLine) {
    const winner = state.grid[winLine[0].row][winLine[0].col];
    return { over: true, turn: null, winner, draw: false, winLine };
  }
  for (let c = 0; c < COLS; c++) {
    if (state.grid[ROWS - 1][c] === EMPTY) {
      return { over: false, turn: state.turn, winner: null, draw: false, winLine: null };
    }
  }
  return { over: true, turn: null, winner: null, draw: true, winLine: null };
}

// Directions to scan from each cell: right, up, up-right, up-left.
const DIRS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

function findWinLine(grid) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const piece = grid[r][c];
      if (piece === EMPTY) continue;
      for (const [dr, dc] of DIRS) {
        const endR = r + dr * (CONNECT - 1);
        const endC = c + dc * (CONNECT - 1);
        if (endR >= ROWS || endC >= COLS || endC < 0) continue;
        let run = 1;
        while (run < CONNECT && grid[r + dr * run][c + dc * run] === piece) run++;
        if (run === CONNECT) {
          const line = [];
          for (let i = 0; i < CONNECT; i++) line.push({ row: r + dr * i, col: c + dc * i });
          return line;
        }
      }
    }
  }
  return null;
}
