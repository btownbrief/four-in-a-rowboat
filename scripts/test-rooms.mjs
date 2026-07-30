// Online-rooms wiring test: drives the real vendored client (js/rooms.js)
// against the local shim (scripts/rooms-shim.mjs) as two simulated phones,
// then plays a full online game through the real engine. No network, no
// Supabase — the SQL file has its own referee tests; this proves OUR side.
//
//   node scripts/test-rooms.mjs

import { startShim } from './rooms-shim.mjs';
import { createInitialState, applyMove, getStatus, RED, GOLD } from '../js/engine.js';

const GAME = 'four-in-a-rowboat';

/* ------------------------------------------------- two-phone environment */

const stores = new Map();
let current = 'A';
globalThis.localStorage = {
  getItem: (k) => (stores.get(current).has(k) ? stores.get(current).get(k) : null),
  setItem: (k, v) => stores.get(current).set(k, String(v)),
  removeItem: (k) => stores.get(current).delete(k),
};
function device(d) {
  if (!stores.has(d)) stores.set(d, new Map());
  current = d;
}
device('A');
device('B');

let passed = 0;
function t(cond, label) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`  ok — ${label}`);
}
async function expectCode(promise, code, label) {
  try {
    await promise;
    t(false, `${label} (no error thrown)`);
  } catch (e) {
    t(e && e.code === code, `${label} (got ${e && e.code})`);
  }
}

const shim = await startShim();
globalThis.BTOWN_ROOMS_URL = shim.url;
const { OnlineMatch, savedSession, RoomsError } = await import('../js/rooms.js');

/* ------------------------------------------------------------ the tests */

// create + join
device('A');
const host = await OnlineMatch.create({
  game: GAME, name: 'Cap A', state: createInitialState(), seats: 2,
});
t(/^[A-Z2-9]{4}$/.test(host.code) && host.seat === 0 && host.status === 'waiting', 'host creates room, seat 0');
t(savedSession(GAME)?.roomId === host.roomId, 'host session saved');

device('B');
await expectCode(OnlineMatch.join({ game: GAME, code: 'ZZZZ', name: 'X' }), 'not_found', 'bad code rejected');
await expectCode(OnlineMatch.join({ game: 'crazy-eights', code: host.code, name: 'X' }), 'wrong_game', 'wrong game rejected');
await expectCode(OnlineMatch.join({ game: null, code: host.code, name: 'X' }), 'bad_game', 'null game rejected (SQL parity)');
const guest = await OnlineMatch.join({ game: GAME, code: ` ${host.code.toLowerCase()} `, name: 'Cap B' });
t(guest.seat === 1 && guest.status === 'playing', 'guest joins (sloppy code ok), game starts');
t(guest.opponents().length === 1 && guest.opponents()[0].name === 'Cap A', 'guest sees host name');

device('A');
await host._fetch();
t(host.status === 'playing' && host.opponents()[0].name === 'Cap B', 'host poll sees game start');

// referee: push, sync, conflict
let sA = applyMove(host.state, 3);
await host.push(sA);
t(host.version === 1, 'host pushes move, version 1');

device('B');
await guest._fetch();
t(guest.state.grid[0][3] === RED && guest.state.turn === GOLD, 'guest poll receives the move');
await guest.push(applyMove(guest.state, 0));
t(guest.version === 2, 'guest pushes reply, version 2');

device('A');
const staleState = applyMove(sA, 6);
await expectCode(host.push(staleState), 'version_conflict', 'stale push rejected');
t(host.version === 2 && host.state.grid[0][0] === GOLD, 'conflict refetches the truth');

// full game through the engine: red stacks col 0, gold col 1 — red wins
device('A'); await host._fetch();
device('B'); await guest._fetch();
const phones = { [RED]: { m: host, d: 'A' }, [GOLD]: { m: guest, d: 'B' } };
// state after the earlier moves: red@3, gold@0 — keep playing from here
let mover;
while (!getStatus(phones[RED].m.state).over) {
  const stateNow = phones[RED].m.state;
  mover = phones[stateNow.turn];
  device(mover.d);
  await mover.m._fetch();
  const next = applyMove(mover.m.state, mover.m.state.turn === RED ? 5 : 1);
  await mover.m.push(next, { over: getStatus(next).over });
  device(phones[RED].d);
  await phones[RED].m._fetch();
  device(phones[GOLD].d);
  await phones[GOLD].m._fetch();
}
t(getStatus(host.state).winner === RED && host.status === 'over', 'full online game to a win, both phones agree');
t(JSON.stringify(host.state) === JSON.stringify(guest.state), 'end states identical');

// rematch: either phone deals into the finished room
device('B');
await guest.push(createInitialState(), {});
t(guest.status === 'playing' && guest.version === host.version + 1, 'rematch deal accepted');

// resume after a "refresh"
device('A');
const resumed = await OnlineMatch.resume({ game: GAME });
t(resumed.roomId === host.roomId && resumed.seat === 0 && resumed.status === 'playing', 'resume reattaches to the room');

// out-of-order responses must never roll state backwards
{
  const before = { state: guest.state, version: guest.version };
  await guest._fetch();
  guest.state = before.state; // simulate a stale response landing late…
  guest.version = before.version + 1000; // …after a much newer one applied
  const res = await guest._fetch();
  t(guest.version === before.version + 1000, 'stale poll response is ignored');
  guest.version = res.version; // restore truth for the tests below
  guest.state = res.state;
  guest.status = res.status;
}

// leave: other side sees the flag, session cleared, pushes barred
await resumed.leave();
t(savedSession(GAME) === null, 'leave clears the session');
device('B');
await guest._fetch();
t(guest.status === 'over' && guest.opponents()[0].left === true, 'guest sees host left');
await expectCode(guest.push(createInitialState(), {}), 'opponent_left', 'push into an abandoned room barred');

// full room turns a third phone away
device('A');
const h2 = await OnlineMatch.create({ game: GAME, name: 'A', state: createInitialState() });
device('B');
await OnlineMatch.join({ game: GAME, code: h2.code, name: 'B' });
device('C');
await expectCode(OnlineMatch.join({ game: GAME, code: h2.code, name: 'C' }), 'room_started', 'third phone turned away');

// backend not installed → clean 'not_ready' (a bare server that 404s RPCs)
{
  const { createServer } = await import('node:http');
  const dead = createServer((req, res) => { res.writeHead(404); res.end('{}'); });
  await new Promise((r) => dead.listen(0, '127.0.0.1', r));
  globalThis.BTOWN_ROOMS_URL = `http://127.0.0.1:${dead.address().port}`;
  const fresh = await import('../js/rooms.js?not-ready');
  await expectCode(
    fresh.OnlineMatch.create({ game: GAME, name: 'A', state: {} }),
    'not_ready', 'missing backend reads as not_ready');
  dead.close();
}

shim.server.close();
console.log(`\nALL ROOMS TESTS PASSED (${passed} checks)`);
process.exit(0);
