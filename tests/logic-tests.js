// =============================================================
// tests/logic-tests.js
// -------------------------------------------------------------
// AUTOMATED CHECKS for the game rules (no browser needed).
//
// Each test sets up a situation, runs some game code, and then
// "asserts" what should be true. If any assert is wrong, the
// test fails and tells us which one.
//
// How to run (needs Node.js installed):
//     node tests/logic-tests.js
//
// We pass a made-up "now" time into the functions, so we can
// jump forward minutes or days instantly instead of waiting.
// =============================================================

import assert from "node:assert/strict";
import { createNewGame } from "../js/state.js";
import { startMiningJob, processJobs, cancelJob, getJobProgress } from "../js/jobs.js";
import { sellAll } from "../js/trade.js";
import { parseSave, applyOfflineProgress } from "../js/save.js";

const SECOND = 1000;                 // milliseconds in a second
const HOUR = 60 * 60 * SECOND;
const START = 1_000_000_000_000;     // a fixed pretend "start" time

let passed = 0;
let failed = 0;

// A tiny helper: runs one test and prints PASS or FAIL.
function test(name, testFunction) {
  try {
    testFunction();
    console.log("PASS  " + name);
    passed++;
  } catch (error) {
    console.log("FAIL  " + name);
    console.log("      " + error.message);
    failed++;
  }
}


// -------------------------------------------------------------
test("A new game starts with no credits, no ore, one idle ship", () => {
  const state = createNewGame();
  assert.equal(state.credits, 0);
  assert.equal(state.inventory.iron_ore, 0);
  assert.equal(state.ships.length, 1);
  assert.equal(state.jobs.length, 0);
});

test("Nothing is mined before the first 20 second trip finishes", () => {
  const state = createNewGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  processJobs(state, START + 19 * SECOND);
  assert.equal(state.inventory.iron_ore, 0);
});

test("One finished trip brings back a full hold (10 ore)", () => {
  const state = createNewGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  processJobs(state, START + 20 * SECOND);
  assert.equal(state.inventory.iron_ore, 10);
});

test("Leftover time carries into the next trip (65s = 3 trips, next trip 5s in)", () => {
  const state = createNewGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  processJobs(state, START + 65 * SECOND);
  assert.equal(state.inventory.iron_ore, 30);
  // The repeating job is still running, 5 seconds into trip 4.
  assert.equal(state.jobs.length, 1);
  assert.equal(getJobProgress(state.jobs[0], START + 65 * SECOND), 5 / 20);
});

test("Ticking often gives the same result as one big jump", () => {
  // This is what makes offline progress fair: 4 small checks a
  // second for 10 minutes must equal one check after 10 minutes.
  const ticking = createNewGame();
  const jumping = createNewGame();
  startMiningJob(ticking, "ship-1", "inner_belt", START);
  startMiningJob(jumping, "ship-1", "inner_belt", START);

  for (let t = 0; t <= 600 * SECOND; t += 250) {
    processJobs(ticking, START + t);
  }
  processJobs(jumping, START + 600 * SECOND);

  assert.equal(ticking.inventory.iron_ore, jumping.inventory.iron_ore);
  assert.equal(ticking.inventory.iron_ore, 300);   // 600s / 20s = 30 trips x 10
});

test("A ship can't be sent on two jobs at once", () => {
  const state = createNewGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  const second = startMiningJob(state, "ship-1", "inner_belt", START);
  assert.equal(second, null);
  assert.equal(state.jobs.length, 1);
});

test("Recalling a ship cancels its job and loses the partial trip", () => {
  const state = createNewGame();
  const job = startMiningJob(state, "ship-1", "inner_belt", START);
  cancelJob(state, job.id);
  processJobs(state, START + 60 * SECOND);
  assert.equal(state.jobs.length, 0);
  assert.equal(state.inventory.iron_ore, 0);
});

test("A clock set backwards doesn't take ore away", () => {
  const state = createNewGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  processJobs(state, START - 100 * SECOND);
  assert.equal(state.inventory.iron_ore, 0);
  assert.equal(state.jobs[0].startedAt, START);
});

test("Selling all ore pays 5 cr each and empties the hold", () => {
  const state = createNewGame();
  state.inventory.iron_ore = 30;
  const earned = sellAll(state, "iron_ore");
  assert.equal(earned, 150);
  assert.equal(state.credits, 150);
  assert.equal(state.inventory.iron_ore, 0);
});

test("Selling with an empty hold earns nothing", () => {
  const state = createNewGame();
  assert.equal(sellAll(state, "iron_ore"), 0);
  assert.equal(state.credits, 0);
});

test("A save turned into text and back is identical", () => {
  const state = createNewGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  state.credits = 1234;
  const loaded = parseSave(JSON.stringify(state));
  assert.deepEqual(loaded, state);
});

test("A broken save is rejected safely instead of crashing", () => {
  assert.equal(parseSave("this is not a save {{{"), null);
});

test("Offline: 1 hour away mines 180 trips (1,800 ore)", () => {
  const state = createNewGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  state.lastSavedAt = START;
  const report = applyOfflineProgress(state, START + 1 * HOUR);
  assert.equal(state.inventory.iron_ore, 1800);
  assert.equal(report.secondsAway, 3600);
  assert.equal(report.secondsCounted, 3600);
});

test("Offline: 3 days away only counts the 24 hour cap", () => {
  const state = createNewGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  state.lastSavedAt = START;
  const now = START + 72 * HOUR;
  const report = applyOfflineProgress(state, now);

  // 24h / 20s = 4,320 trips x 10 ore
  assert.equal(state.inventory.iron_ore, 43200);
  assert.equal(report.secondsCounted, 24 * 3600);

  // The ship carries on from "now", not with 48 hours of backlog.
  processJobs(state, now);
  assert.equal(state.inventory.iron_ore, 43200);
});


// -------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);   // tells the computer "something went wrong"
}
