// FOUR IN A ROWBOAT — UI only. A Btown Games production for the BTown Brief.
//
// This file renders state, animates buoys, and dispatches moves. Every rule
// lives in js/engine.js and every bot decision in js/bot.js — if you're
// tempted to check for a win here, stop and use getStatus() instead.

import {
  ROWS, COLS, RED, GOLD, createInitialState, legalMoves, applyMove, getStatus, landingRow,
} from './engine.js';
import { chooseMove } from './bot.js';
import { sound } from './audio.js';

const $ = (id) => document.getElementById(id);
const menuEl = $('menu');
const gameEl = $('game');
const boatEl = $('boat');
const boardEl = $('board');
const piecesEl = $('pieces');
const holesEl = $('holes');
const colsEl = $('cols');
const turnChip = $('turnChip');
const tallyEl = $('tally');
const resultBar = $('resultbar');
const resultText = $('resultText');
const champEl = $('champ');
const champBubble = $('champBubble');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------- copy desk */

const BOT_NAMES = { paddler: 'PADDLER', skipper: 'SKIPPER' };
const THINKING = {
  paddler: "THE PADDLER'S DRIFTING…",
  skipper: "THE SKIPPER'S CHARTING…",
};
const CHAMP_LINES = [
  'FOUR IN A ROWBOAT!',
  "That's a keeper!",
  'Champ approves. 🦕',
  'Nice tossing, captain!',
  'Smoothest line since the ferry.',
  'The breakwater is cheering.',
];
const BOT_WIN_LINES = {
  paddler: 'THE PADDLER DRIFTS PAST YOU',
  skipper: 'THE SKIPPER TAKES IT',
};

/* ------------------------------------------------------------- game shell */

let mode = 'pass'; // 'pass' | 'paddler' | 'skipper'
let state = createInitialState();
let busy = false; // an animation or bot think is in flight
let botTimer = 0;
let firstPlayer = RED; // who tosses first this game
let tally = { red: 0, gold: 0, calm: 0 };

// Build the 42 porthole cells and 7 column tap strips once.
for (let i = 0; i < ROWS * COLS; i++) holesEl.appendChild(document.createElement('div'));
for (let c = 0; c < COLS; c++) {
  const strip = document.createElement('button');
  strip.dataset.col = String(c);
  strip.setAttribute('aria-label', `Drop a buoy in column ${c + 1}`);
  strip.addEventListener('click', () => onColumnTap(c));
  colsEl.appendChild(strip);
}

document.querySelectorAll('[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => startMatch(btn.dataset.mode));
});
$('dockBtn').addEventListener('click', backToDock);
$('rematchBtn').addEventListener('click', rematch);
$('mute').addEventListener('click', () => {
  $('mute').textContent = sound.toggleMuted() ? '🔇' : '🔊';
});
$('mute').textContent = sound.muted ? '🔇' : '🔊';

function startMatch(chosen) {
  mode = chosen;
  tally = { red: 0, gold: 0, calm: 0 };
  firstPlayer = RED; // the human (or red captain) opens the first game
  menuEl.classList.add('hidden');
  gameEl.classList.remove('hidden');
  boatEl.classList.add('afloat');
  newGame();
}

function backToDock() {
  clearTimeout(botTimer);
  busy = false;
  gameEl.classList.add('hidden');
  menuEl.classList.remove('hidden');
}

function rematch() {
  newGame();
}

function newGame() {
  clearTimeout(botTimer);
  state = createInitialState(firstPlayer);
  busy = false;
  piecesEl.innerHTML = '';
  boardEl.classList.remove('showdown');
  resultBar.classList.add('hidden');
  champEl.classList.add('hidden');
  colsEl.classList.remove('disabled');
  renderTally();
  renderTurn();
  if (isBotsTurn()) scheduleBotMove();
}

/* ------------------------------------------------------------- turns */

function isBotsTurn() {
  return mode !== 'pass' && !getStatus(state).over && state.turn === GOLD;
}

function onColumnTap(col) {
  if (busy || isBotsTurn()) return;
  if (!legalMoves(state).includes(col)) return; // full column or game over
  playMove(col);
}

function scheduleBotMove() {
  busy = true;
  renderTurn();
  // A short, human-ish pause — the Skipper squints at the horizon first.
  const pause = 350 + Math.random() * 450;
  botTimer = setTimeout(() => {
    playMove(chooseMove(state, mode));
  }, pause);
}

function playMove(col) {
  busy = true;
  const player = state.turn;
  const row = landingRow(state, col);
  state = applyMove(state, col);

  dropPiece(player, row, col, () => {
    const status = getStatus(state);
    if (status.over) {
      finishGame(status);
    } else {
      busy = false;
      renderTurn();
      if (isBotsTurn()) scheduleBotMove();
    }
  });
}

/* ------------------------------------------------------------- rendering */

function pieceAt(row, col, player) {
  const el = document.createElement('div');
  el.className = `piece ${player === RED ? 'red' : 'gold'}`;
  el.dataset.cell = `${row},${col}`;
  const dispRow = ROWS - 1 - row; // engine row 0 is the bottom
  el.style.left = `${(col * 100) / COLS}%`;
  el.style.top = `${(dispRow * 100) / ROWS}%`;
  return el;
}

function dropPiece(player, row, col, onLanded) {
  const el = pieceAt(row, col, player);
  piecesEl.appendChild(el);

  if (reducedMotion || !el.animate) {
    sound.plop(row);
    onLanded();
    return;
  }

  const dispRow = ROWS - 1 - row;
  const cellH = boardEl.clientHeight / ROWS;
  const fromY = -(dispRow + 1) * cellH; // start just above the board's rim
  const fall = 90 + 85 * (dispRow + 1); // farther drop, longer fall
  const bounce = Math.min(0.34 * cellH, 16);
  const duration = fall + 170;
  const anim = el.animate(
    [
      { transform: `translateY(${fromY}px)`, easing: 'cubic-bezier(0.5, 0, 0.9, 0.6)' },
      { transform: 'translateY(0)', offset: 0.62, easing: 'ease-out' },
      { transform: `translateY(${-bounce}px)`, offset: 0.82, easing: 'ease-in' },
      { transform: 'translateY(0)' },
    ],
    { duration }
  );
  setTimeout(() => sound.plop(row), fall * 0.62 + 60);
  // Finish via whichever fires first: browsers throttle animation events in
  // backgrounded/occluded tabs, and the game must never wait on one.
  let landed = false;
  const land = () => {
    if (landed) return;
    landed = true;
    onLanded();
  };
  anim.onfinish = land;
  setTimeout(land, duration + 130);
}

function renderTurn() {
  const status = getStatus(state);
  if (status.over) {
    turnChip.className = '';
    turnChip.textContent = '';
    return;
  }
  const red = status.turn === RED;
  turnChip.className = red ? 'red' : 'gold';
  if (mode === 'pass') {
    turnChip.textContent = red ? "RED'S TOSS" : "GOLD'S TOSS";
  } else if (red) {
    turnChip.textContent = 'YOUR TOSS';
  } else {
    turnChip.textContent = THINKING[mode];
    turnChip.classList.add('thinking');
  }
}

function renderTally() {
  const calm = tally.calm ? ` · ${tally.calm} calm` : '';
  if (mode === 'pass') {
    tallyEl.innerHTML =
      `<span class="t-red">RED ${tally.red}</span> — ` +
      `<span class="t-gold">${tally.gold} GOLD</span>${calm}`;
  } else {
    tallyEl.innerHTML =
      `<span class="t-red">YOU ${tally.red}</span> — ` +
      `<span class="t-gold">${tally.gold} ${BOT_NAMES[mode]}</span>${calm}`;
  }
}

/* ------------------------------------------------------------- endgame */

function finishGame(status) {
  colsEl.classList.add('disabled');
  turnChip.className = '';
  turnChip.textContent = '';

  if (status.winner !== null) {
    boardEl.classList.add('showdown');
    for (const { row, col } of status.winLine) {
      const el = piecesEl.querySelector(`[data-cell="${row},${col}"]`);
      if (el) el.classList.add('winner');
    }
  }

  let text = '';
  let cls = '';
  if (status.draw) {
    tally.calm++;
    text = "DEAD CALM — IT'S A DRAW";
    sound.draw();
    firstPlayer = firstPlayer === RED ? GOLD : RED; // swap openers after a stalemate
  } else if (status.winner === RED) {
    tally.red++;
    cls = 'red-win';
    text = mode === 'pass' ? 'RED ROWS IT HOME!' : 'YOU ROW IT HOME!';
    sound.win();
    celebrateChamp();
    firstPlayer = GOLD; // loser tosses first next game
  } else {
    tally.gold++;
    cls = 'gold-win';
    if (mode === 'pass') {
      text = 'GOLD ROWS IT HOME!';
      sound.win();
      celebrateChamp();
    } else {
      text = BOT_WIN_LINES[mode];
      sound.lose();
    }
    firstPlayer = RED;
  }

  renderTally();
  resultText.textContent = text;
  resultText.className = cls;
  // Let the winning line sink in for a beat before the banner lands.
  setTimeout(() => resultBar.classList.remove('hidden'), status.winner !== null ? 650 : 250);
}

function celebrateChamp() {
  champBubble.textContent = CHAMP_LINES[Math.floor(Math.random() * CHAMP_LINES.length)];
  // Re-trigger the pop-up animation even on back-to-back wins.
  champEl.classList.add('hidden');
  void champEl.offsetWidth;
  champEl.classList.remove('hidden');
}
