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
import { OnlineMatch, savedSession, clearSession, getName } from './rooms.js';

const $ = (id) => document.getElementById(id);
const menuEl = $('menu');
const gameEl = $('game');
const lakeEl = $('lake');
const boatEl = $('boat');
const boardEl = $('board');
const piecesEl = $('pieces');
const landingPreview = $('landingPreview');
const holesEl = $('holes');
const colsEl = $('cols');
const threatChip = $('threatChip');
const dropSplash = $('dropSplash');
const turnChip = $('turnChip');
const tallyEl = $('tally');
const resultBar = $('resultbar');
const resultText = $('resultText');
const gloatEl = $('gloat');
const gloatIcon = $('gloatIcon');
const gloatBubble = $('gloatBubble');
const champEl = $('champ');
const champBubble = $('champBubble');
const dockBtn = $('dockBtn');
const rematchBtn = $('rematchBtn');
const onlinePanel = $('onlinePanel');
const opTitle = $('opTitle');
const opName = $('opName');
const opCodeWrap = $('opCodeWrap');
const opCode = $('opCode');
const opError = $('opError');
const lobbyEl = $('lobby');
const lobbyCode = $('lobbyCode');
const rejoinBtn = $('rejoinBtn');

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
const GLOAT_LINES = {
  paddler: [
    'Caught a lucky current!',
    'A lazy float still gets there.',
    'The lake did most of the work.',
  ],
  skipper: [
    'Keep your eyes on the wind, captain.',
    'Forty summers teaches a thing or two.',
    'Good race. Mind the crosscurrent.',
  ],
  online: [
    'Good race, captain!',
    'Caught the right current!',
    'Good pull — rematch?',
  ],
};

/* ------------------------------------------------------------- game shell */

let mode = 'pass'; // 'pass' | 'paddler' | 'skipper' | 'online'
let state = createInitialState();
let busy = false; // an animation or bot think is in flight
let botTimer = 0;
let firstPlayer = RED; // who tosses first this game
let tally = { red: 0, gold: 0, calm: 0 };
let online = null; // { match, myPlayer } while in an online crew
let effectRun = 0;
let previewCol = null;
const effectTimers = new Set();
const usedGloatLines = new Set();

// Build the 42 porthole cells and 7 column tap strips once.
for (let i = 0; i < ROWS * COLS; i++) holesEl.appendChild(document.createElement('div'));
for (let c = 0; c < COLS; c++) {
  const strip = document.createElement('button');
  strip.dataset.col = String(c);
  strip.setAttribute('aria-label', `Drop a buoy in column ${c + 1}`);
  strip.addEventListener('click', () => onColumnTap(c));
  strip.addEventListener('pointerenter', () => {
    previewCol = c;
    showLandingPreview(c);
  });
  strip.addEventListener('pointerdown', () => showLandingPreview(c));
  strip.addEventListener('pointerleave', () => {
    previewCol = null;
    hideLandingPreview();
  });
  strip.addEventListener('pointerup', (event) => {
    if (event.pointerType !== 'mouse') {
      previewCol = null;
      hideLandingPreview();
    }
  });
  strip.addEventListener('pointercancel', () => {
    previewCol = null;
    hideLandingPreview();
  });
  strip.addEventListener('focus', () => {
    previewCol = c;
    showLandingPreview(c);
  });
  strip.addEventListener('blur', () => {
    previewCol = null;
    hideLandingPreview();
  });
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
  usedGloatLines.clear();
  firstPlayer = RED; // the human (or red captain) opens the first game
  menuEl.classList.add('hidden');
  gameEl.classList.remove('hidden');
  boatEl.classList.add('afloat');
  newGame();
}

function backToDock() {
  if (online) {
    // Leaving mid-crew ends the game for both phones — ask for a second tap.
    if (dockBtn.dataset.armed !== '1') {
      dockBtn.dataset.armed = '1';
      dockBtn.textContent = '⚓ LEAVE?';
      setTimeout(() => {
        dockBtn.dataset.armed = '';
        dockBtn.textContent = '⚓ DOCK';
      }, 2500);
      return;
    }
    online.match.leave(); // fire and forget; stops polling + clears session
    online = null;
    dockBtn.dataset.armed = '';
    dockBtn.textContent = '⚓ DOCK';
  }
  clearTimeout(botTimer);
  clearEffects();
  busy = false;
  gameEl.classList.add('hidden');
  menuEl.classList.remove('hidden');
  refreshRejoin();
}

function rematch() {
  if (online) {
    onlineRematch();
  } else {
    newGame();
  }
}

function newGame() {
  clearTimeout(botTimer);
  clearEffects();
  state = createInitialState(firstPlayer);
  busy = false;
  piecesEl.innerHTML = '';
  boardEl.classList.remove('showdown');
  resultBar.classList.add('hidden');
  gloatEl.classList.add('hidden');
  champEl.classList.add('hidden');
  colsEl.classList.remove('disabled');
  renderTally();
  renderTurn();
  if (isBotsTurn()) scheduleBotMove();
}

function scheduleEffect(fn, delay, run = effectRun) {
  const timer = setTimeout(() => {
    effectTimers.delete(timer);
    if (run === effectRun) fn();
  }, delay);
  effectTimers.add(timer);
  return timer;
}

function clearEffects() {
  effectRun++;
  for (const timer of effectTimers) clearTimeout(timer);
  effectTimers.clear();
  previewCol = null;
  boardEl.classList.remove('win-impact');
  boatEl.classList.remove('drop-impact');
  dropSplash.classList.remove('active');
  resultBar.classList.remove('fresh');
  gloatEl.classList.remove('fresh');
  piecesEl.querySelectorAll('.impact').forEach((el) => el.classList.remove('impact'));
  hideLandingPreview();
  clearThreat();
}

/* ------------------------------------------------------------- turns */

function isBotsTurn() {
  return mode !== 'pass' && mode !== 'online' && !getStatus(state).over && state.turn === GOLD;
}

function onColumnTap(col) {
  if (busy || isBotsTurn()) return;
  if (online && (state.turn !== online.myPlayer || online.match.status !== 'playing')) return;
  if (!legalMoves(state).includes(col)) return; // full column or game over
  hideLandingPreview();
  clearThreat();
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
  if (online) pushOnline(); // publish my toss while the buoy falls

  dropPiece(player, row, col, () => {
    const status = getStatus(state);
    if (status.over) {
      finishGame(status, { fresh: true, lastMove: { row, col } });
    } else {
      busy = false;
      renderTurn();
      if (isBotsTurn()) scheduleBotMove();
    }
  });
}

/* ------------------------------------------------------------- rendering */

function canChooseColumn() {
  if (busy || getStatus(state).over || isBotsTurn()) return false;
  return !online || (state.turn === online.myPlayer && online.match.status === 'playing');
}

function pieceAt(row, col, player) {
  const el = document.createElement('div');
  el.className = `piece ${player === RED ? 'red' : 'gold'}`;
  el.dataset.cell = `${row},${col}`;
  const dispRow = ROWS - 1 - row; // engine row 0 is the bottom
  el.style.left = `${(col * 100) / COLS}%`;
  el.style.top = `${(dispRow * 100) / ROWS}%`;
  return el;
}

function showLandingPreview(col) {
  if (!canChooseColumn() || !legalMoves(state).includes(col)) {
    hideLandingPreview();
    return;
  }
  const row = landingRow(state, col);
  const dispRow = ROWS - 1 - row;
  landingPreview.className = `piece preview ${state.turn === RED ? 'red' : 'gold'}`;
  landingPreview.style.left = `${(col * 100) / COLS}%`;
  landingPreview.style.top = `${(dispRow * 100) / ROWS}%`;
}

function hideLandingPreview() {
  landingPreview.className = 'piece hidden';
}

function dropPiece(player, row, col, onLanded) {
  const run = effectRun;
  const el = pieceAt(row, col, player);
  piecesEl.appendChild(el);

  if (reducedMotion || !el.animate) {
    dropImpact(row, col, run);
    if (run === effectRun) onLanded();
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
  scheduleEffect(() => dropImpact(row, col, run), duration * 0.62, run);
  // Finish via whichever fires first: browsers throttle animation events in
  // backgrounded/occluded tabs, and the game must never wait on one.
  let landed = false;
  const land = () => {
    if (landed || run !== effectRun) return;
    landed = true;
    onLanded();
  };
  anim.onfinish = land;
  setTimeout(land, duration + 130);
}

function dropImpact(row, col, run) {
  if (run !== effectRun) return;
  sound.plop(row);
  if (reducedMotion) return;

  const lakeRect = lakeEl.getBoundingClientRect();
  const boardRect = boardEl.getBoundingClientRect();
  const x = boardRect.left - lakeRect.left + ((col + 0.5) * boardRect.width) / COLS;
  dropSplash.style.left = `${x}px`;

  boatEl.classList.remove('drop-impact');
  dropSplash.classList.remove('active');
  void boatEl.offsetWidth;
  boatEl.classList.add('drop-impact');
  dropSplash.classList.add('active');
  scheduleEffect(() => boatEl.classList.remove('drop-impact'), 380, run);
  scheduleEffect(() => dropSplash.classList.remove('active'), 520, run);
}

function clearThreat() {
  threatChip.classList.add('hidden');
  colsEl.querySelectorAll('.danger').forEach((el) => {
    el.classList.remove('danger');
    el.setAttribute('aria-label', `Drop a buoy in column ${Number(el.dataset.col) + 1}`);
  });
}

function renderThreat() {
  clearThreat();
  if (!canChooseColumn()) return;

  const status = getStatus(state);
  const opponent = status.turn === RED ? GOLD : RED;
  const opponentTurn = { grid: state.grid, turn: opponent };
  const dangerColumns = legalMoves(opponentTurn).filter((col) => {
    const hypothetical = applyMove(opponentTurn, col);
    return getStatus(hypothetical).winner === opponent;
  });
  if (!dangerColumns.length) return;

  for (const col of dangerColumns) {
    const strip = colsEl.children[col];
    strip.classList.add('danger');
    strip.setAttribute(
      'aria-label',
      `Danger: opponent can win in column ${col + 1}. Drop a buoy in column ${col + 1}`
    );
  }
  threatChip.classList.remove('hidden');
}

function renderTurn() {
  const status = getStatus(state);
  if (status.over) {
    clearThreat();
    hideLandingPreview();
    turnChip.className = '';
    turnChip.textContent = '';
    return;
  }
  const red = status.turn === RED;
  turnChip.className = red ? 'red' : 'gold';
  if (mode === 'pass') {
    turnChip.textContent = red ? "RED'S TOSS" : "GOLD'S TOSS";
  } else if (mode === 'online') {
    if (status.turn === online.myPlayer) {
      turnChip.textContent = 'YOUR TOSS';
    } else {
      const opp = online.match.opponents()[0] || {};
      turnChip.textContent = opp.away
        ? `${(opp.name || 'YOUR PAL').toUpperCase()} STEPPED AWAY…`
        : `WAITING ON ${(opp.name || 'YOUR PAL').toUpperCase()}…`;
      turnChip.classList.add('thinking');
    }
  } else if (red) {
    turnChip.textContent = 'YOUR TOSS';
  } else {
    turnChip.textContent = THINKING[mode];
    turnChip.classList.add('thinking');
  }
  renderThreat();
  if (previewCol !== null) showLandingPreview(previewCol);
}

function renderTally() {
  const calm = tally.calm ? ` · ${tally.calm} calm` : '';
  if (mode === 'pass') {
    tallyEl.innerHTML =
      `<span class="t-red">RED ${tally.red}</span> — ` +
      `<span class="t-gold">${tally.gold} GOLD</span>${calm}`;
  } else if (mode === 'online') {
    const opp = online.match.opponents()[0] || {};
    const mine = online.myPlayer === RED ? 'red' : 'gold';
    const theirs = online.myPlayer === RED ? 'gold' : 'red';
    tallyEl.innerHTML =
      `<span class="t-${mine}">YOU ${tally[mine]}</span> — ` +
      `<span class="t-${theirs}">${tally[theirs]} ${esc((opp.name || 'PAL').toUpperCase())}</span>${calm}`;
  } else {
    tallyEl.innerHTML =
      `<span class="t-red">YOU ${tally.red}</span> — ` +
      `<span class="t-gold">${tally.gold} ${BOT_NAMES[mode]}</span>${calm}`;
  }
}

// Opponent names come from the network — never let them into innerHTML raw.
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/* ------------------------------------------------------------- endgame */

function finishGame(status, { fresh = false, lastMove = null } = {}) {
  colsEl.classList.add('disabled');
  clearThreat();
  hideLandingPreview();
  turnChip.className = '';
  turnChip.textContent = '';
  gloatEl.classList.add('hidden');
  gloatEl.classList.remove('fresh');

  if (status.winner !== null) {
    for (const { row, col } of status.winLine) {
      const el = piecesEl.querySelector(`[data-cell="${row},${col}"]`);
      if (el) el.classList.add('winner');
    }
    if (fresh && lastMove && !reducedMotion) {
      presentWinImpact(lastMove);
    } else {
      boardEl.classList.add('showdown');
    }
  }

  let text = '';
  let cls = '';
  if (status.draw) {
    tally.calm++;
    text = "DEAD CALM — IT'S A DRAW";
    if (fresh) sound.draw();
    firstPlayer = firstPlayer === RED ? GOLD : RED; // swap openers after a stalemate
  } else if (mode === 'online') {
    const opp = online.match.opponents()[0] || {};
    const iWon = status.winner === online.myPlayer;
    tally[status.winner === RED ? 'red' : 'gold']++;
    cls = status.winner === RED ? 'red-win' : 'gold-win';
    if (iWon) {
      text = 'YOU ROW IT HOME!';
      if (fresh) {
        sound.win();
        celebrateChamp();
      }
    } else {
      text = `${(opp.name || 'YOUR PAL').toUpperCase()} TAKES IT`;
      if (fresh) sound.lose();
      showGloat('online', opp.name || 'YOUR PAL', '🌊', fresh);
    }
    firstPlayer = status.winner === RED ? GOLD : RED; // loser opens the rematch
  } else if (status.winner === RED) {
    tally.red++;
    cls = 'red-win';
    text = mode === 'pass' ? 'RED ROWS IT HOME!' : 'YOU ROW IT HOME!';
    if (fresh) {
      sound.win();
      celebrateChamp();
    }
    firstPlayer = GOLD; // loser tosses first next game
  } else {
    tally.gold++;
    cls = 'gold-win';
    if (mode === 'pass') {
      text = 'GOLD ROWS IT HOME!';
      if (fresh) {
        sound.win();
        celebrateChamp();
      }
    } else {
      text = BOT_WIN_LINES[mode];
      if (fresh) sound.lose();
      showGloat(
        mode,
        `THE ${BOT_NAMES[mode]}`,
        mode === 'skipper' ? '⛵' : '🛶',
        fresh
      );
    }
    firstPlayer = RED;
  }

  renderTally();
  resultText.textContent = text;
  resultText.className = cls;
  resultBar.classList.toggle('fresh', fresh && !reducedMotion);
  // Let the winning line sink in for a beat before the banner lands.
  const resultDelay = fresh ? (status.winner !== null ? 650 : 250) : 0;
  if (resultDelay) {
    scheduleEffect(() => resultBar.classList.remove('hidden'), resultDelay);
    scheduleEffect(() => {
      resultBar.classList.remove('fresh');
      gloatEl.classList.remove('fresh');
    }, resultDelay + 700);
  } else {
    resultBar.classList.remove('hidden');
  }
}

function presentWinImpact(lastMove) {
  const fourth = piecesEl.querySelector(
    `[data-cell="${lastMove.row},${lastMove.col}"]`
  );
  if (fourth) fourth.classList.add('impact');
  boardEl.classList.add('win-impact');
  scheduleEffect(() => boardEl.classList.add('showdown'), 280);
  scheduleEffect(() => boardEl.classList.remove('win-impact'), 420);
  if (fourth) scheduleEffect(() => fourth.classList.remove('impact'), 720);
}

function showGloat(kind, speaker, icon, fresh) {
  const available = GLOAT_LINES[kind].filter((line) => !usedGloatLines.has(`${kind}:${line}`));
  const line = fresh
    ? (available[Math.floor(Math.random() * available.length)]
      || `Another one for the logbook — round ${tally.red + tally.gold + tally.calm}.`)
    : GLOAT_LINES[kind][0];
  if (fresh) usedGloatLines.add(`${kind}:${line}`);
  gloatIcon.textContent = icon;
  gloatBubble.textContent = `${speaker}: “${line}”`;
  gloatEl.classList.remove('hidden');
  gloatEl.classList.toggle('fresh', fresh && !reducedMotion);
}

function celebrateChamp() {
  champBubble.textContent = CHAMP_LINES[Math.floor(Math.random() * CHAMP_LINES.length)];
  // Re-trigger the pop-up animation even on back-to-back wins.
  champEl.classList.add('hidden');
  void champEl.offsetWidth;
  champEl.classList.remove('hidden');
}

/* ------------------------------------------------------------- online play */
// Two phones, one shared engine state, refereed by the rooms layer
// (js/rooms.js → Supabase). Host sits in seat 0 and tosses red; the friend
// who joins with the 4-letter code is gold. Every rule still lives in
// engine.js — this section only ferries state and animates what arrives.

const GAME = 'four-in-a-rowboat';
let panelIntent = 'host'; // which flow the setup panel is collecting for
let pollErrors = 0;

$('hostBtn').addEventListener('click', () => openPanel('host'));
$('joinBtn').addEventListener('click', () => openPanel('join'));
$('opCancel').addEventListener('click', closePanel);
$('opGo').addEventListener('click', onlineGo);
$('lobbyCancel').addEventListener('click', cancelLobby);
rejoinBtn.addEventListener('click', rejoinCrew);
opCode.addEventListener('input', () => {
  opCode.value = opCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
[opName, opCode].forEach((el) => el.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') onlineGo();
}));

function openPanel(intent) {
  panelIntent = intent;
  opTitle.textContent = intent === 'host' ? 'START A CREW' : 'JOIN A CREW';
  $('opGo').textContent = intent === 'host' ? 'GET A CODE' : 'HOP ABOARD';
  opCodeWrap.classList.toggle('hidden', intent === 'host');
  opError.classList.add('hidden');
  opName.value = opName.value || getName();
  onlinePanel.classList.remove('hidden');
  (intent === 'join' && opName.value ? opCode : opName).focus();
}

function closePanel() {
  onlinePanel.classList.add('hidden');
}

const FRIENDLY_ERRORS = {
  not_found: 'No crew with that code — double-check the letters.',
  room_full: 'That crew already set sail without you.',
  room_started: 'That crew already set sail without you.',
  not_ready: "Online play isn't switched on yet — check back soon!",
  offline: "Can't reach the lake — are you online?",
};
function friendly(err) {
  if (err && err.code === 'wrong_game') {
    return `That code is for ${String(err.detail || 'another game').replace(/-/g, ' ')} — head there to use it.`;
  }
  return (err && FRIENDLY_ERRORS[err.code]) || 'Choppy water — please try again.';
}

async function onlineGo() {
  if ($('opGo').disabled) return; // Enter key can't double-submit
  const name = opName.value.trim();
  if (!name) {
    opError.textContent = 'Every captain needs a name.';
    opError.classList.remove('hidden');
    opName.focus();
    return;
  }
  const go = $('opGo');
  go.disabled = true;
  opError.classList.add('hidden');
  try {
    if (panelIntent === 'host') {
      const match = await OnlineMatch.create({
        game: GAME, name, state: createInitialState(RED), seats: 2,
      });
      closePanel();
      openLobby(match);
    } else {
      const code = opCode.value.trim();
      if (code.length !== 4) {
        opError.textContent = 'The crew code is 4 letters.';
        opError.classList.remove('hidden');
        opCode.focus();
        return;
      }
      const match = await OnlineMatch.join({ game: GAME, code, name });
      closePanel();
      enterOnlineGame(match);
    }
  } catch (err) {
    opError.textContent = friendly(err);
    opError.classList.remove('hidden');
  } finally {
    go.disabled = false;
  }
}

function openLobby(match) {
  if (lobbyEl._match && lobbyEl._match !== match) lobbyEl._match.stop();
  lobbyCode.textContent = match.code;
  lobbyEl.classList.remove('hidden');
  match.start({
    onStatus: (status) => {
      if (status === 'playing') {
        lobbyEl.classList.add('hidden');
        enterOnlineGame(match);
      }
    },
    onError: () => {}, // waiting-room hiccups resolve themselves on the next poll
  });
  lobbyEl._match = match;
}

function cancelLobby() {
  const match = lobbyEl._match;
  if (match) match.leave();
  lobbyEl._match = null;
  lobbyEl.classList.add('hidden');
  refreshRejoin();
}

async function rejoinCrew() {
  rejoinBtn.disabled = true;
  try {
    const match = await OnlineMatch.resume({ game: GAME });
    if (match.status === 'waiting') {
      openLobby(match);
    } else {
      enterOnlineGame(match);
    }
  } catch (err) {
    // Only a room that's truly gone forfeits the session — a flaky
    // connection must not delete the one path back to the game.
    if (err && (err.code === 'not_found' || err.code === 'not_seated' || err.code === 'room_started')) {
      clearSession(GAME);
      refreshRejoin();
    }
  } finally {
    rejoinBtn.disabled = false;
  }
}

function refreshRejoin() {
  const saved = savedSession(GAME);
  rejoinBtn.classList.toggle('hidden', !saved);
  if (saved) rejoinBtn.textContent = `↩ REJOIN YOUR CREW (${saved.code})`;
}

function enterOnlineGame(match) {
  clearTimeout(botTimer);
  mode = 'online';
  online = { match, myPlayer: match.seat === 0 ? RED : GOLD };
  tally = { red: 0, gold: 0, calm: 0 };
  pollErrors = 0;
  state = match.state;
  menuEl.classList.add('hidden');
  onlinePanel.classList.add('hidden');
  lobbyEl.classList.add('hidden');
  gameEl.classList.remove('hidden');
  boatEl.classList.add('afloat');
  rebuildBoard();
  match.start({
    onState: onRemoteState,
    onStatus: onRemoteStatus,
    onPresence: onRemotePresence,
    onError: onPollError,
  });
  // Resuming into a room the friend already abandoned: status is 'over'
  // but the board isn't — say so instead of waiting forever.
  if (match.status === 'over' && !getStatus(state).over) onRemoteStatus('over');
}

/** Redraw the whole board from `state`, no animation (resume, conflicts). */
function rebuildBoard() {
  clearEffects();
  busy = false;
  piecesEl.innerHTML = '';
  boardEl.classList.remove('showdown');
  resultBar.classList.add('hidden');
  champEl.classList.add('hidden');
  colsEl.classList.remove('disabled');
  rematchBtn.classList.remove('hidden');
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (state.grid[r][c] !== EMPTY_CELL) piecesEl.appendChild(pieceAt(r, c, state.grid[r][c]));
    }
  }
  renderTally();
  const status = getStatus(state);
  if (status.over) {
    finishGame(status, { fresh: false });
  } else {
    renderTurn();
  }
}
const EMPTY_CELL = 0; // engine's EMPTY, spelled locally to keep imports tidy

function countPieces(s) {
  let n = 0;
  for (const row of s.grid) for (const v of row) if (v !== EMPTY_CELL) n++;
  return n;
}

function onRemoteState(newState) {
  const prev = state;
  state = newState;
  const added = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (prev.grid[r][c] === EMPTY_CELL && newState.grid[r][c] !== EMPTY_CELL) {
        added.push({ r, c, v: newState.grid[r][c] });
      }
    }
  }
  if (added.length === 1 && countPieces(newState) === countPieces(prev) + 1) {
    // exactly one new buoy — their toss; let it splash properly
    hideLandingPreview();
    clearThreat();
    busy = true;
    resultBar.classList.add('hidden');
    dropPiece(added[0].v, added[0].r, added[0].c, () => {
      const status = getStatus(state);
      if (status.over) {
        finishGame(status, {
          fresh: true,
          lastMove: { row: added[0].r, col: added[0].c },
        });
      } else {
        busy = false;
        renderTurn();
      }
    });
  } else {
    // rematch deal, conflict truth, or anything unexpected — redraw cold
    rebuildBoard();
  }
}

function onRemoteStatus(status) {
  if (status !== 'over') return;
  const opp = online && online.match.opponents()[0];
  if (opp && opp.left && !getStatus(state).over) {
    // they abandoned ship mid-game
    clearEffects();
    colsEl.classList.add('disabled');
    turnChip.className = '';
    turnChip.textContent = '';
    resultText.textContent = `${(opp.name || 'YOUR PAL').toUpperCase()} ROWED OFF`;
    resultText.className = '';
    rematchBtn.classList.add('hidden');
    resultBar.classList.remove('hidden');
  }
}

function onRemotePresence(opponents) {
  pollErrors = 0; // this callback only fires on a successful poll
  const opp = opponents[0];
  if (opp && opp.left && rematchBtn) rematchBtn.classList.add('hidden');
  if (!busy) renderTurn(); // clears any choppy-connection note, keeps away fresh
}

function onPollError(err) {
  if (err && err.code === 'not_found') {
    // room swept away (they left ages ago) — back to the dock
    clearEffects();
    online.match.stop();
    clearSession(GAME);
    online = null;
    mode = 'pass';
    gameEl.classList.add('hidden');
    menuEl.classList.remove('hidden');
    refreshRejoin();
    return;
  }
  pollErrors++;
  if (pollErrors >= 3 && !getStatus(state).over) {
    turnChip.className = 'thinking';
    turnChip.textContent = 'CHOPPY CONNECTION — HANG TIGHT…';
  }
}

async function pushOnline() {
  const status = getStatus(state);
  try {
    await online.match.push(state, { over: status.over });
    pollErrors = 0;
  } catch (err) {
    if (err && err.code === 'version_conflict') {
      // server had newer truth (rematch race etc.) — repaint from it
      state = online.match.state;
      rebuildBoard();
      return;
    }
    // one calm retry, then let the poll loop surface the trouble
    setTimeout(async () => {
      try {
        await online.match.push(state, { over: getStatus(state).over });
        pollErrors = 0;
      } catch {
        onPollError(err);
      }
    }, 1500);
  }
}

async function onlineRematch() {
  if (!online) return;
  const fresh = createInitialState(firstPlayer);
  state = fresh;
  rebuildBoard();
  try {
    await online.match.push(fresh, {});
  } catch (err) {
    if (err && err.code === 'version_conflict') {
      // they dealt first — take their deal
      state = online.match.state;
      rebuildBoard();
    }
  }
}

// Show the rejoin chip on first load if a crew is waiting on us.
refreshRejoin();
