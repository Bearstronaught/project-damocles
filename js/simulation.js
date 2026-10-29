// =============================================================
// js/simulation.js
// -------------------------------------------------------------
// THE ONE WAY TIME MOVES FORWARD.
//
// Everything that "happens by itself" in the game - ships
// docking, freighters selling, refinery batches finishing - is
// played out by advanceTo() below. Nothing else moves the clock.
//
// It's used in three places, and they all run the SAME code:
//   - the game loop, 4 times a second while you play  (main.js)
//   - loading the game after time away                (save.js)
//   - after importing a save                          (main.js)
//
// That's the design doc's promise: "an hour away must give the
// same result as an hour played". The tests check it by playing
// a busy economy three ways (tiny ticks, random ticks, one big
// jump) and comparing every number.
//
// The game remembers how far it has played up to in
//   state.simulatedUpTo   (a timestamp)
// and each call plays from there up to "now". Two clock rules
// sit on top (design doc, Technical safeguards):
//
//   CLOCK WENT BACKWARDS (someone changed the computer's time):
//     award nothing, and slide every job back by the same amount
//     so ships don't sit frozen until the clock catches up.
//
//   A HUGE JUMP FORWARDS (a week away, or a laptop asleep for
//   days with the game open): only the offline cap counts
//   (24 hours). The rest is skipped by sliding every job forward,
//   so ships carry on from "now" without a backlog.
//
// Before this file existed, the game loop called processJobs
// directly with no cap, so a laptop asleep for 3 days with the
// tab open earned all 3 days. Closing the game only earned 24h.
// Now both go through the same door.
// =============================================================

import { RULES } from "../data/content.js";
import { processJobs } from "./jobs.js";


// -------------------------------------------------------------
// advanceTo(state, now)
// Plays the game forward from where it got to, up to "now".
//
// Returns a report of what happened:
//   {
//     secondsAway:    how much clock time passed since last time
//     secondsCounted: how much of it was actually played (capped)
//     results:        what each ship / refinery slot did
//                     (the same list processJobs returns)
//   }
// -------------------------------------------------------------
export function advanceTo(state, now) {
  const gapMs = now - state.simulatedUpTo;

  // --- The clock went backwards (or hasn't moved) ---
  if (gapMs <= 0) {
    // Slide every job back by the same amount. Nothing finishes,
    // nothing is lost, and each ship still has exactly as long
    // left as it did before - it just doesn't freeze.
    shiftJobs(state, gapMs);   // gapMs is negative (or 0): moves them earlier
    state.simulatedUpTo = now;
    return { secondsAway: 0, secondsCounted: 0, results: [] };
  }

  // --- Normal case: play forward, up to the offline cap ---
  const capMs = RULES.offlineCapHours * 60 * 60 * 1000;   // hours -> ms
  const countedMs = Math.min(gapMs, capMs);

  // The engine itself (jobs.js): replays every event, earliest
  // first, up to this moment.
  const results = processJobs(state, state.simulatedUpTo + countedMs);

  // Time beyond the cap is skipped: slide the jobs forward by it.
  const skippedMs = gapMs - countedMs;
  if (skippedMs > 0) {
    shiftJobs(state, skippedMs);
  }

  state.simulatedUpTo = now;

  // The run clock: only time that was actually played counts.
  // (Prestige runs will be measured with this - design doc,
  // Prestige: "the run clock counts only simulated time".)
  state.simulatedMs += countedMs;

  return {
    secondsAway: Math.floor(gapMs / 1000),
    secondsCounted: Math.floor(countedMs / 1000),
    results: results,
  };
}


// -------------------------------------------------------------
// shiftJobs(state, ms)
// Moves every job's start time by "ms" (forwards if positive,
// backwards if negative). A job only stores WHEN it started, so
// this is all it takes to skip time or rewind it - nothing
// about the job itself changes.
// -------------------------------------------------------------
function shiftJobs(state, ms) {
  for (const job of state.jobs) {
    job.startedAt += ms;
  }
}
