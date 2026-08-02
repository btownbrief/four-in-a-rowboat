# Wiring a Btown game to the online rooms layer

This repo is the CANONICAL reference. To give any sibling game online
two-phone play, follow exactly this recipe. The result everywhere: a menu
gains "start a crew / join a crew" (re-theme the words, keep the flow),
the host reads a 4-letter code to a friend, and the two phones play the
same pure engine with the rooms layer refereeing.

## 1. Vendor two files VERBATIM — never edit them

- `js/rooms.js`         (the client; game-agnostic)
- `scripts/rooms-shim.mjs` (local backend stand-in for tests)

If either file needs a change, it must change HERE first and be re-vendored
everywhere. Both carry a header saying so.

## 2. Copy the UI pattern from this repo

Read `index.html` (online panel + lobby markup), `style.css` (the
`online play` section — adapt colors to the game's own CSS variables), and
`js/main.js` (the `online play` section). Keep these element ids EXACTLY —
the fleet's shared UI test drives them: `hostBtn joinBtn rejoinBtn
onlinePanel opTitle opName opCodeWrap opCode opError opGo opCancel lobby
lobbyCode lobbyCancel`. Re-theme all visible copy to the game's voice.

The pattern in main.js, in order: mode `'online'` joins the existing mode
list; `online = { match, myPlayer }`; taps gated by
`state.turn === online.myPlayer && match.status === 'playing'`; after MY
move `match.push(newState, { over })`; poll callbacks `onState onStatus
onPresence onError`; rejoin chip from `savedSession`; two-tap leave on the
back button; `not_ready` shows "online play isn't switched on yet" copy.

## 3. The five rules that are not optional

1. **Seats**: seat 0 = host = whichever side the engine's fresh
   `createInitialState()` has moving first; seat 1 (2, 3) join in order.
   Seat index = engine player index. The host's phone builds the initial
   state (including any shuffle/deal — every deck game keeps its RNG seed
   inside the state, so all phones replay identically).
2. **Perspective**: online, this phone IS one player. Render from my
   seat's point of view (my side at the bottom, my hand visible). Games
   whose pass-and-play flips the board or shows handoff/blocker screens:
   never flip, never block online.
3. **Hidden information** (hands, racks, fleets): render ONLY my seat's
   private info. The full state does reach every phone (a devtools snoop
   could peek — accepted for friendly games; note it in a comment), but
   the honest UI never shows it.
4. **Remote state application**: when `onState` delivers a new state,
   repaint from it. Animate the opponent's move if the game already has a
   natural animation and the diff is one move; a cold repaint is fine
   when diffing is complex. Must also handle a rematch (fresh state,
   fewer pieces) and a conflict repaint.
5. **Rematch**: on a finished room, either phone pushes a fresh
   `createInitialState(...)` (loser opens if the game has that
   convention); `version_conflict` means the other phone dealt first —
   take their deal.

## 4. Tests before you finish

Adapt `scripts/test-rooms.mjs`: keep the generic client checks, then play
a full online game THROUGH THIS GAME'S ENGINE as two (or N) simulated
phones — random legal moves via `legalMoves()` until `getStatus().over`
(cap ~400 moves), asserting the phones' end states are identical. Run and
report:

    node scripts/test-engine.mjs
    node scripts/test-rooms.mjs
    node --check js/main.js   (and any other touched file)

## 5. Update AGENTS.md

Add the "Online play (the rooms layer)" section (copy this repo's wording,
noting the canonical copies live in four-in-a-rowboat) and extend the
"before you finish" checklist with test-rooms.mjs.

## Backend

One shared Supabase schema serves every game:
`btownbrief.github.io/supabase/rooms-2026-07-30.sql`. Games self-register —
no per-game setup. Until Stephen pastes that file into the Supabase SQL
editor, clients get `not_ready` and the UI degrades gracefully.

## 6. Crew-link invites (added 2026-08-02)

The lobby carries a "📲 send an invite" button sharing
`<game-url>?join=CODE` (navigator.share on mobile, clipboard fallback with
a "link copied" flash). On load, a valid `?join=XXXX` opens the join panel
with the code prefilled and is scrubbed with history.replaceState so a
refresh never re-triggers it. Reference implementation: the end of this
repo's js/main.js. Applies to duel games too (see maple-scramble).
