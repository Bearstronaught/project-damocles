// =============================================================
// js/clock.js
// -------------------------------------------------------------
// THE GAME CLOCK: what time it is INSIDE the game.
//
// Normally the game's time and the computer's time are the same.
// The playtest speed setting (dev panel) lets the game's clock
// run faster: at 10x, every real second is 10 game seconds.
// Everything in the game - ships, batches, offline time - reads
// THIS clock, never the computer's, so an hour at 10x plays out
// exactly like 10 hours at 1x.
//
// How it works: the save remembers one "anchor" moment, when the
// speed was last changed, as a pair of times:
//
//   state.clock = {
//     realAt: the computer's time at that moment,
//     gameAt: the game's time at that moment,
//     speed:  how fast the game clock has run since (1, 2, 5...)
//   }
//
// The game time now is then:
//
//   gameAt + (real time since realAt) x speed
//
// Example: the speed went to 10x when both clocks read 12:00.
// At 12:01 real time, the game clock reads 12:00 + 1 min x 10
// = 12:10.
//
// Because it's all worked out from the saved anchor, it keeps
// going while the game is closed too: shut the game at 10x, come
// back an hour later, and 10 game hours have passed (up to the
// usual 24-hour offline cap, which counts GAME time).
//
// At 1x with both anchors equal, game time IS real time, so a
// game that never touches the speed setting behaves exactly as
// it did before this file existed.
// =============================================================


// The speeds the dev panel offers.
export const SPEEDS = [1, 2, 5, 10, 60];


// -------------------------------------------------------------
// createClock(realNow)
// A fresh clock for a new game: game time = real time, at 1x.
// -------------------------------------------------------------
export function createClock(realNow) {
  return { realAt: realNow, gameAt: realNow, speed: 1 };
}


// -------------------------------------------------------------
// gameNow(state, realNow)
// What time it is in the game. "realNow" is the computer's time;
// leave it out to use the time right now. (Tests pass their own
// so they can pretend time has passed.)
// -------------------------------------------------------------
export function gameNow(state, realNow = Date.now()) {
  const clock = state.clock;
  const realPassed = realNow - clock.realAt;   // ms since the anchor
  return clock.gameAt + realPassed * clock.speed;
}


// -------------------------------------------------------------
// setSpeed(state, speed, realNow)
// Changes how fast the game clock runs from this moment on.
//
// The anchor moves to "now" first, so time already passed keeps
// the speed it had. Without that, switching from 10x to 1x would
// rewrite history: the last 5 minutes at 10x (50 game minutes)
// would suddenly count as 5 game minutes, and the clock would
// jump backwards.
// -------------------------------------------------------------
export function setSpeed(state, speed, realNow = Date.now()) {
  if (!SPEEDS.includes(speed)) {
    return false;   // only the speeds on offer
  }
  state.clock.gameAt = gameNow(state, realNow);   // game time now...
  state.clock.realAt = realNow;                   // ...pinned to real time now
  state.clock.speed = speed;
  return true;
}


// -------------------------------------------------------------
// jumpAhead(state, ms)
// Moves the game clock forward by "ms" in one go (the dev
// panel's "jump an hour"). The next advanceTo() call then plays
// out that time, exactly like coming back after time away.
// -------------------------------------------------------------
export function jumpAhead(state, ms) {
  state.clock.gameAt += ms;
}
