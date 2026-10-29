// =============================================================
// js/jobs.js
// -------------------------------------------------------------
// JOBS: timed work - mining trips and hauling runs.
//
// THE BIG IDEA: a job never "counts down". It only remembers
// WHEN it started and HOW LONG each part takes. To know what's
// happened, we compare that with the clock.
//
// Why? Because it means it doesn't matter whether the game was
// open the whole time or closed for 6 hours - the maths is the
// same. Offline progress comes for free.
//
// There are two kinds of SHIP job. (The refinery's batches are
// jobs too - see js/refinery.js - so they play out on the same
// timeline as the ships.)
//
// A MINING trip has three phases, one after the other:
//   OUTBOUND  fly from home to the field
//   MINING    fill the hold
//   RETURNING fly home and unload the ore into the home hold
//
// A HAUL run (freighters) is a loop:
//   WAITING   docked at home until there's ore to load
//             (a full hold, or any ore at all - see HAUL_MODES)
//   OUTBOUND  fly the cargo to the merchant hub
//   TRADING   dock at the hub and sell (paid at the END of this)
//   RETURNING fly home empty, then back to WAITING
//
// A mining job looks like this:
//   {
//     id: "job-1712345678901-ship-1",  unique name for this job
//     type: "mining",                  what kind of work it is
//     shipId: "ship-1",                which ship is doing it
//     fieldId: "inner_belt",           where it's mining
//     startedAt: 1712345678901,        when the CURRENT trip began
//     outboundMs: 45000,               length of each phase (ms)
//     miningMs: 60000,
//     returnMs: 45000,
//     durationMs: 150000,              the three added together
//     repeat: true,                    start another trip when done?
//   }
//
// A haul job looks like this:
//   {
//     id, type: "haul", shipId, repeat: true,
//     status: "waiting",       "waiting" at home, or "travelling"
//     startedAt: 1712345678901, when the current run LEFT home
//     outboundMs, tradeMs, returnMs, durationMs,
//     cargo: { iron_ore: 60 }, what's on board (null when empty)
//     sold: false,             has this run's cargo been sold yet?
//   }
// =============================================================

import { FIELDS, SHIP_TYPES, ITEMS, HUB, FLEET_XP_EXPONENT } from "../data/content.js";
import { addItem, findShip } from "./state.js";
import { addXp, isFieldUnlocked } from "./skills.js";
import { sellAtHub } from "./trade.js";
import { startWaitingBatches, finishBatch } from "./refinery.js";


// =============================================================
// PLANNING: how long things take
// =============================================================

// -------------------------------------------------------------
// getTripPlan(shipTypeId, fieldId)
// Works out how long each phase of a MINING trip takes for this
// kind of ship at this field, plus what one trip brings back.
// Used to start jobs AND to show stats in the shipyard.
// -------------------------------------------------------------
export function getTripPlan(shipTypeId, fieldId) {
  const shipType = SHIP_TYPES[shipTypeId];
  const field = FIELDS[fieldId];

  // Travel: a speed of 0.75 makes the trip take 1 ÷ 0.75 = 1.33x as long.
  const travelMs = Math.round((field.travelSeconds / shipType.speed) * 1000);

  // Mining: minutes to fill the hold = cargo ÷ (tonnes per minute).
  const miningMs = Math.round((shipType.cargoCapacity / shipType.miningRate) * 60 * 1000);

  return {
    outboundMs: travelMs,
    miningMs: miningMs,
    returnMs: travelMs,
    durationMs: travelMs + miningMs + travelMs,
    orePerTrip: shipType.cargoCapacity,
    xpPerTrip: shipType.cargoCapacity / field.tonnesPerXp,   // e.g. 120 t ÷ 10 = 12 XP
  };
}


// -------------------------------------------------------------
// getMiningXpShare(state)
// How much of a trip's Mining XP each ship keeps, given how many
// ships are out mining right now (Dan, 29 Oct). Big fleets still
// earn more XP in total, but each extra ship adds less:
//     ships working:   1      2      4      12
//     share each:     100%    76%    57%    37%
// (the share is ships ^ (FLEET_XP_EXPONENT - 1)).
// Credits are never reduced - only XP.
// -------------------------------------------------------------
export function getMiningXpShare(state) {
  // Count the mining jobs: one per ship that's out working
  // (including ships turned for home with a part-load).
  const shipsMining = state.jobs.filter((job) => job.type === "mining").length;
  return getFleetXpShare(shipsMining);
}


// -------------------------------------------------------------
// getFreightXpShare(state)
// The same rule for Trade XP: freighters out flying share it.
// A freighter waiting at home for a load doesn't count.
// -------------------------------------------------------------
export function getFreightXpShare(state) {
  const freightersFlying = state.jobs.filter(
    (job) => job.type === "haul" && job.status === "travelling"
  ).length;
  return getFleetXpShare(freightersFlying);
}


// -------------------------------------------------------------
// getFleetXpShare(shipsWorking)
// Each ship's share of its XP when this many are working:
// shipsWorking ^ (FLEET_XP_EXPONENT - 1). A lone ship gets 100%.
// -------------------------------------------------------------
function getFleetXpShare(shipsWorking) {
  if (shipsWorking <= 1) {
    return 1;                      // a lone ship always gets full XP
  }
  return shipsWorking ** (FLEET_XP_EXPONENT - 1);
}


// -------------------------------------------------------------
// getHaulPlan(shipTypeId)
// How long each phase of a freighter's hub run takes.
// -------------------------------------------------------------
export function getHaulPlan(shipTypeId) {
  const shipType = SHIP_TYPES[shipTypeId];
  const travelMs = Math.round((HUB.travelSeconds / shipType.speed) * 1000);
  const tradeMs = HUB.tradeSeconds * 1000;

  return {
    outboundMs: travelMs,
    tradeMs: tradeMs,
    returnMs: travelMs,
    durationMs: travelMs + tradeMs + travelMs,
    capacity: shipType.cargoCapacity,
  };
}


// =============================================================
// STARTING AND STOPPING JOBS
// =============================================================

// -------------------------------------------------------------
// startMiningJob(state, shipId, fieldId, now)
// Sends a ship off to mine. Returns the new job (or null).
// "now" is the current time - passed in (rather than read here)
// so that tests can pretend it's any time they like.
// -------------------------------------------------------------
export function startMiningJob(state, shipId, fieldId, now) {
  // A ship can only do one job at a time (design doc), so
  // refuse if this ship is already busy.
  if (getJobForShip(state, shipId)) {
    return null;
  }

  // ...and refuse a field the player hasn't unlocked yet.
  if (!isFieldUnlocked(state, fieldId)) {
    return null;
  }

  const ship = findShip(state, shipId);

  // Only mining ships can mine.
  if (SHIP_TYPES[ship.type].role !== "mining") {
    return null;
  }

  const plan = getTripPlan(ship.type, fieldId);

  const job = {
    id: "job-" + now + "-" + shipId,
    type: "mining",
    shipId: shipId,
    fieldId: fieldId,
    startedAt: now,
    outboundMs: plan.outboundMs,
    miningMs: plan.miningMs,
    returnMs: plan.returnMs,
    durationMs: plan.durationMs,
    repeat: true,                            // keep mining until recalled
  };

  state.jobs.push(job);
  return job;
}


// -------------------------------------------------------------
// startHaulJob(state, shipId, now)
// Puts a freighter on hub runs. It starts WAITING at home, and
// leaves straight away if there's already enough ore to load.
// Returns the new job (or null).
// -------------------------------------------------------------
export function startHaulJob(state, shipId, now) {
  if (getJobForShip(state, shipId)) {
    return null;
  }

  const ship = findShip(state, shipId);

  // Only freighters haul.
  if (SHIP_TYPES[ship.type].role !== "freight") {
    return null;
  }

  const plan = getHaulPlan(ship.type);

  const job = {
    id: "job-" + now + "-" + shipId,
    type: "haul",
    shipId: shipId,
    status: "waiting",
    startedAt: now,
    outboundMs: plan.outboundMs,
    tradeMs: plan.tradeMs,
    returnMs: plan.returnMs,
    durationMs: plan.durationMs,
    cargo: null,
    sold: false,
    repeat: true,
  };

  state.jobs.push(job);

  // Ore already waiting? Then it loads and leaves right now.
  departWaitingFreighters(state, now);
  return job;
}


// -------------------------------------------------------------
// cancelJob(state, jobId)
// Removes a job (the "Recall" button).
//   Mining: any trip in progress is lost (the barge turns back
//           before filling its hold).
//   Hauling: if the cargo hasn't been sold yet, the freighter
//           turns round and puts it back in the home hold.
// -------------------------------------------------------------
export function cancelJob(state, jobId) {
  const job = state.jobs.find((j) => j.id === jobId);

  if (job && job.type === "haul" && job.cargo && !job.sold) {
    for (const [itemId, amount] of Object.entries(job.cargo)) {
      addItem(state, itemId, amount);
    }
  }

  // .filter keeps every job EXCEPT the one with this ID.
  state.jobs = state.jobs.filter((j) => j.id !== jobId);
}


// =============================================================
// RECALLING A SHIP ("come home") AND RESUMING
// =============================================================
//
// Recall never teleports a ship. It always FLIES home, so
// recalling is never quicker than waiting (no shortcuts):
//
//   Barge, outbound     turns round: the flight home takes as long
//                       as it had flown out. No ore.
//   Barge, at the field leaves now with what it has mined so far
//                       (a part-full hold), then the normal flight.
//   Barge, returning    carries on home and unloads as normal.
//   Freighter, outbound turns round and brings the cargo back.
//   Freighter, at hub   finishes selling, then flies home.
//   Freighter, returning carries on home.
//   Freighter, waiting  already home: stands down straight away.
//
// In every case it STAYS DOCKED afterwards instead of starting
// another trip. Recalling is stored on the job as:
//   job.recall = { mode, at, original }
//     mode     "turnback", "leftEarly" or "finishing"
//     at       how far into the trip (ms) it was recalled
//     original the trip's normal timings, so Resume can restore them

// -------------------------------------------------------------
// recallJob(state, jobId, now)
// Calls a ship home. Returns what happened, for the log:
//   { mode, docksInMs, amount }   (amount: tonnes a barge brings)
// or { mode: "stoodDown" } for a freighter already at the dock,
// or null if there's nothing to recall.
// -------------------------------------------------------------
export function recallJob(state, jobId, now) {
  const job = state.jobs.find((j) => j.id === jobId);
  if (!job || job.recall) {
    return null;   // no such job, or already recalled
  }

  // A freighter waiting for cargo is already home.
  if (job.type === "haul" && job.status === "waiting") {
    cancelJob(state, jobId);
    return { mode: "stoodDown" };
  }

  // How far into this trip it is (kept within the trip).
  const at = Math.min(Math.max(now - job.startedAt, 0), job.durationMs);

  // Remember the normal timings, in case the player resumes.
  const original = {
    outboundMs: job.outboundMs,
    returnMs: job.returnMs,
    durationMs: job.durationMs,
  };
  if (job.type === "mining") original.miningMs = job.miningMs;
  if (job.type === "haul") original.tradeMs = job.tradeMs;

  let mode;

  if (at < job.outboundMs) {
    // STILL FLYING OUT: turn round. The trip becomes "fly out
    // for 'at' ms, then fly back for 'at' ms", with no middle.
    mode = "turnback";
    job.outboundMs = at;
    job.returnMs = at;
    job.durationMs = at * 2;
    if (job.type === "mining") {
      job.miningMs = 0;
      job.amountOverride = 0;      // nothing mined
    } else {
      job.tradeMs = 0;
      job.noSale = true;           // bring the cargo back unsold
    }
  } else if (job.type === "mining" && at < job.outboundMs + job.miningMs) {
    // AT THE FIELD: stop mining now, keep what's in the hold.
    mode = "leftEarly";
    const minedMs = at - job.outboundMs;
    const capacity = SHIP_TYPES[findShip(state, job.shipId).type].cargoCapacity;
    // The hold fills evenly while mining, so half the time = half
    // the hold. Math.floor rounds down to whole tonnes.
    job.amountOverride = Math.floor(capacity * (minedMs / job.miningMs));
    job.miningMs = minedMs;
    job.durationMs = job.outboundMs + minedMs + job.returnMs;
  } else {
    // ALREADY HEADING HOME (or selling at the hub): carry on as
    // normal, just don't start another trip.
    mode = "finishing";
  }

  job.repeat = false;
  job.recall = { mode: mode, at: at, original: original };

  const amount = job.type === "mining"
    ? (job.amountOverride ?? getTripPlan(findShip(state, job.shipId).type, job.fieldId).orePerTrip)
    : null;
  // ("??" means: use the left side unless it's missing, then the right.)

  return { mode: mode, docksInMs: job.startedAt + job.durationMs - now, amount: amount };
}


// -------------------------------------------------------------
// resumeJob(state, jobId, now)
// Cancels a recall: the ship goes back to work.
//   turnback:  it turns round again from wherever it has got to.
//              Only the time spent heading home is lost.
//   leftEarly: it carries on home with its part-full hold (it has
//              already left the field), then trips go back to normal.
//   finishing: nothing changed yet, so it simply keeps going.
// Returns true if it resumed.
// -------------------------------------------------------------
export function resumeJob(state, jobId, now) {
  const job = state.jobs.find((j) => j.id === jobId);
  if (!job || !job.recall) {
    return false;
  }

  const { mode, at, original } = job.recall;

  if (mode === "turnback") {
    // Where is it? It flew out for "at" ms, then has been heading
    // home for (elapsed - at) ms, so it's this far out:
    const elapsed = Math.min(Math.max(now - job.startedAt, 0), job.durationMs);
    const distanceOut = Math.max(0, at - (elapsed - at));

    // Put the normal trip back, and pretend it left home just
    // long enough ago to be exactly where it is now.
    Object.assign(job, original);
    job.startedAt = now - distanceOut;
    delete job.amountOverride;
    delete job.noSale;
  } else if (mode === "leftEarly") {
    // This short trip finishes as it is; the NEXT one is normal.
    job.restoreAfterTrip = original;
  }

  job.repeat = true;
  delete job.recall;
  return true;
}


// -------------------------------------------------------------
// getJobForShip(state, shipId)
// Returns the job a ship is doing, or undefined if it's idle.
// -------------------------------------------------------------
export function getJobForShip(state, shipId) {
  return state.jobs.find((job) => job.shipId === shipId);
}


// =============================================================
// LOADING A FREIGHTER
// =============================================================

// -------------------------------------------------------------
// getOreInHold(state)
// How many tonnes of ore are in the home hold, all types added up.
// -------------------------------------------------------------
export function getOreInHold(state) {
  let total = 0;
  for (const itemId of Object.keys(ITEMS)) {
    total += state.inventory[itemId] || 0;
  }
  return total;
}


// -------------------------------------------------------------
// loadCargo(state, capacity, mode)
// Takes ore out of the home hold to fill a freighter, MOST
// VALUABLE FIRST (by hub price), so the best ore always goes.
// Returns what was loaded, e.g. { nickel_ore: 20, iron_ore: 40 },
// or null if the freighter shouldn't leave yet:
//   "full" mode:     not enough ore to fill the whole hold
//   "constant" mode: no ore at all
// -------------------------------------------------------------
export function loadCargo(state, capacity, mode) {
  const available = getOreInHold(state);

  if (available === 0) return null;
  if (mode === "full" && available < capacity) return null;

  // Item IDs sorted by hub price, highest first.
  // (sort compares two items at a time: b - a puts bigger first)
  const byValue = Object.keys(ITEMS).sort((a, b) => ITEMS[b].hubPrice - ITEMS[a].hubPrice);

  const cargo = {};
  let space = capacity;

  for (const itemId of byValue) {
    if (space === 0) break;
    const take = Math.min(space, state.inventory[itemId] || 0);   // as much as fits
    if (take > 0) {
      cargo[itemId] = take;
      state.inventory[itemId] -= take;   // it leaves the home hold
      space -= take;
    }
  }
  return cargo;
}


// -------------------------------------------------------------
// departWaitingFreighters(state, time)
// Every freighter waiting at home checks whether it can load
// up now. Those that can, leave at "time".
// Waiting freighters are checked in fleet order, so if two are
// waiting for the same ore, the one bought first goes first.
// -------------------------------------------------------------
function departWaitingFreighters(state, time) {
  for (const job of state.jobs) {
    if (job.type !== "haul" || job.status !== "waiting") continue;

    const ship = findShip(state, job.shipId);
    const capacity = SHIP_TYPES[ship.type].cargoCapacity;
    const cargo = loadCargo(state, capacity, ship.haulMode || "full");

    if (cargo) {
      job.status = "travelling";
      job.startedAt = time;
      job.cargo = cargo;
      job.sold = false;
    }
  }
}


// =============================================================
// WHERE A JOB IS UP TO (for the screen)
// =============================================================

// -------------------------------------------------------------
// getJobProgress(job, now)
// How far through its current trip a job is, from 0 to 1.
// (0 = just left, 0.5 = halfway, 1 = done.)
// A freighter waiting at home is at 0.
// -------------------------------------------------------------
export function getJobProgress(job, now) {
  if (job.type === "haul" && job.status === "waiting") {
    return 0;
  }
  // A ship recalled the instant it left has a 0 ms trip: it's done.
  if (job.durationMs === 0) {
    return 1;
  }
  const elapsed = now - job.startedAt;
  const progress = elapsed / job.durationMs;

  // Keep it between 0 and 1 even if the clock is a bit off.
  return Math.min(Math.max(progress, 0), 1);
}


// -------------------------------------------------------------
// getJobPhase(job, now)
// Which phase the trip is in right now, and how full each
// phase is, for the route tracker on screen. Returns:
//   {
//     phase: "outbound" | "mining" | "trading" | "returning" | "waiting",
//     msLeftInPhase: 12000,
//     fills: [1, 0.4, 0],   how full each phase is, 0 to 1
//   }
// -------------------------------------------------------------
export function getJobPhase(job, now) {
  // A freighter waiting at home hasn't started its run yet.
  if (job.type === "haul" && job.status === "waiting") {
    return { phase: "waiting", msLeftInPhase: 0, fills: [0, 0, 0] };
  }

  // The middle phase is mining for barges, trading for freighters.
  const middleMs = job.type === "haul" ? job.tradeMs : job.miningMs;
  const middleName = job.type === "haul" ? "trading" : "mining";

  // Time into this trip, kept between 0 and the trip length.
  const elapsed = Math.min(Math.max(now - job.startedAt, 0), job.durationMs);

  const outEnd = job.outboundMs;              // when outbound finishes
  const middleEnd = job.outboundMs + middleMs; // when the middle phase finishes

  // How full each phase is: "elapsed minus where the phase
  // starts, divided by its length", kept between 0 and 1.
  // A phase of length 0 (a recalled ship that never reached the
  // field) counts as full once we're past it, so we never divide by 0.
  const fill = (start, length) => {
    if (length === 0) return elapsed >= start ? 1 : 0;
    return Math.min(Math.max((elapsed - start) / length, 0), 1);
  };
  const fills = [
    fill(0, job.outboundMs),
    fill(outEnd, middleMs),
    fill(middleEnd, job.returnMs),
  ];

  if (elapsed < outEnd) {
    return { phase: "outbound", msLeftInPhase: outEnd - elapsed, fills };
  }
  if (elapsed < middleEnd) {
    return { phase: middleName, msLeftInPhase: middleEnd - elapsed, fills };
  }
  return { phase: "returning", msLeftInPhase: job.durationMs - elapsed, fills };
}


// =============================================================
// PROCESSING: the heart of the idle game
// =============================================================

// -------------------------------------------------------------
// processJobs(state, now)
// Plays out everything that happened up to "now": mining trips
// finishing, freighters loading, selling and coming home.
//
// Called 4 times a second while playing, AND once on load to
// catch up on time away. Same function either way.
//
// WHY IN TIME ORDER: a freighter can only load ore that the
// barges have already brought home. So after 2 hours away, we
// can't just add up each ship on its own - we replay the
// events one by one, earliest first, like rewinding a tape:
//   12:00:00 barge docks with 12 iron  -> hold has 60
//   12:00:00 courier loads 60 and leaves
//   12:02:30 barge docks with 12 iron  -> hold has 12
//   ...
//
// Returns a list of what happened, ONE ENTRY PER SHIP (several
// trips by the same ship are added together), so the screen
// can report it:
//   mining: { kind: "mining", shipId, itemId, amount, trips,
//             skillId: "mining", xpGained, newLevels }
//   docked: { kind: "docked", shipId, returnedCargo? }  a recalled
//           ship arriving home to stand down
//   haul:   { kind: "haul", shipId, cargo, tonnes, credits,
//             trips, skillId: "trade", xpGained, newLevels }
//   refine: { kind: "refine", slot, recipeId, itemId, amount,
//             trips, skillId: "refining", xpGained, newLevels }
//           (one entry per slot and recipe, batches added up)
// -------------------------------------------------------------
export function processJobs(state, now) {
  const results = [];

  // A freighter might be able to leave because of something the
  // player just did (like switching to constant runs). The
  // earliest that can count is the next event, or now.
  // The same goes for a refinery slot waiting for ore.
  // The refinery gets first pick of the ore, then freighters.
  const first = findNextEvent(state, now);
  const startTime = first ? Math.min(first.time, now) : now;
  startWaitingBatches(state, startTime);
  departWaitingFreighters(state, startTime);

  // Then replay every due event, earliest first.
  // (The safety limit stops a bug from freezing the browser.)
  for (let count = 0; count < 1_000_000; count++) {
    const next = findNextEvent(state, now);
    if (!next) break;   // nothing else is due yet

    const result = runEvent(state, next.job, next.time);
    if (result) {
      results.push(result);
    }

    // Ore may have just arrived, a batch just finished, or a
    // freighter just docked: anyone waiting gets a chance to
    // start. The refinery gets first pick, then freighters.
    startWaitingBatches(state, next.time);
    departWaitingFreighters(state, next.time);
  }

  return mergeResultsByShip(results);
}


// -------------------------------------------------------------
// findNextEvent(state, now)
// The earliest thing due to happen at or before "now", as
// { job, time }, or null if nothing is due yet.
//   Mining job:  the trip finishing (ship docks with ore)
//   Haul job:    selling at the hub, then docking back home
//   Refinery job: the current batch finishing
//   Waiting freighters and refinery slots have no event - they
//   wait for ore.
// -------------------------------------------------------------
function findNextEvent(state, now) {
  let best = null;

  for (const job of state.jobs) {
    let time;

    if (job.type === "mining") {
      time = job.startedAt + job.durationMs;
    } else if (job.type === "refine" && job.status === "working") {
      time = job.startedAt + job.durationMs;              // batch done
    } else if (job.type === "haul" && job.status === "travelling") {
      time = (job.sold || job.noSale)
        ? job.startedAt + job.durationMs                  // docks back home
        : job.startedAt + job.outboundMs + job.tradeMs;   // sells at the hub
    } else {
      continue;   // waiting, or a job type we don't know
    }

    // Due yet? And earlier than anything found so far?
    // (Using "<" means two events at the exact same moment run
    // in fleet order, which keeps results predictable.)
    if (time <= now && (best === null || time < best.time)) {
      best = { job, time };
    }
  }
  return best;
}


// -------------------------------------------------------------
// runEvent(state, job, time)
// Makes one event happen. Returns a result for the report, or
// null for events with nothing to report (a freighter docking).
// -------------------------------------------------------------
function runEvent(state, job, time) {
  // --- A refinery batch finishes: metal into the hold ---
  if (job.type === "refine") {
    return finishBatch(state, job);
  }

  // --- A mining trip finishes: unload ore, earn Mining XP ---
  if (job.type === "mining") {
    const ship = findShip(state, job.shipId);
    const plan = getTripPlan(ship.type, job.fieldId);
    const field = FIELDS[job.fieldId];

    // A full hold - unless it was recalled before filling up.
    const amount = job.amountOverride ?? plan.orePerTrip;
    // Full XP for the ore, times this ship's share of the fleet's XP.
    // Worked out BEFORE a recalled ship leaves the job list below.
    const xp = (amount / field.tonnesPerXp) * getMiningXpShare(state);
    delete job.amountOverride;

    let newLevels = [];
    if (amount > 0) {
      addItem(state, field.yields, amount);
      newLevels = addXp(state, "mining", xp);
    }

    if (job.repeat) {
      // The next trip starts the moment this one ends, so no
      // time is lost between trips.
      job.startedAt += job.durationMs;
      // A trip cut short (then resumed) is over: back to normal.
      if (job.restoreAfterTrip) {
        Object.assign(job, job.restoreAfterTrip);
        delete job.restoreAfterTrip;
      }
    } else {
      // Recalled: it docks and stays docked.
      state.jobs = state.jobs.filter((j) => j !== job);
    }

    // Turned back before mining anything: just say it docked.
    if (amount === 0) {
      return { kind: "docked", shipId: job.shipId, trips: 1, xpGained: 0, newLevels: [] };
    }

    return {
      kind: "mining",
      shipId: job.shipId,
      itemId: field.yields,
      amount: amount,
      trips: 1,
      skillId: "mining",
      xpGained: xp,
      newLevels: newLevels,
    };
  }

  // --- A freighter turned back before selling docks: unload ---
  if (job.type === "haul" && job.noSale) {
    const cargo = job.cargo;
    for (const [itemId, amount] of Object.entries(cargo || {})) {
      addItem(state, itemId, amount);   // back into the home hold
    }
    state.jobs = state.jobs.filter((j) => j !== job);
    return { kind: "docked", shipId: job.shipId, trips: 1, xpGained: 0, newLevels: [], returnedCargo: cargo };
  }

  // --- A freighter finishes trading at the hub: get paid ---
  if (job.type === "haul" && !job.sold) {
    // Credits, plus Trade XP for the haul times this freighter's share
    const sale = sellAtHub(state, job.cargo, getFreightXpShare(state));
    const cargo = job.cargo;
    job.sold = true;
    job.cargo = null;                           // the hold is empty now

    return {
      kind: "haul",
      shipId: job.shipId,
      cargo: cargo,
      tonnes: sale.tonnes,
      credits: sale.credits,
      trips: 1,
      skillId: "trade",
      xpGained: sale.xp,
      newLevels: sale.newLevels,
    };
  }

  // --- A freighter docks back home ---
  if (job.type === "haul" && job.sold) {
    if (!job.repeat) {
      // Recalled: it stays docked.
      state.jobs = state.jobs.filter((j) => j !== job);
      return { kind: "docked", shipId: job.shipId, trips: 1, xpGained: 0, newLevels: [] };
    }
    // Otherwise wait for the next load.
    job.status = "waiting";
    job.sold = false;
    job.startedAt = time;   // (when it started waiting)
    return null;
  }

  return null;
}


// -------------------------------------------------------------
// mergeResultsByShip(results)
// Adds up several results from the same ship into one, so
// "Rusty Pick docked 3 times" is one log line, not three.
// -------------------------------------------------------------
function mergeResultsByShip(results) {
  const merged = [];
  const byShip = {};   // shipId -> its merged result

  for (const result of results) {
    // Ships are grouped by ship; refinery batches by slot and
    // recipe ("??" means: use the right side if the left is missing).
    const who = result.shipId ?? ("slot-" + result.slot + "-" + result.recipeId);
    const key = who + ":" + result.kind;
    const total = byShip[key];

    if (!total) {
      // First result for this ship: copy it (so we never change
      // the original) and keep it.
      const copy = { ...result, newLevels: [...result.newLevels] };
      if (copy.cargo) copy.cargo = { ...copy.cargo };
      byShip[key] = copy;
      merged.push(copy);
      continue;
    }

    // "Docked" has nothing to add up.
    if (result.kind === "docked") {
      continue;
    }

    total.trips += result.trips;
    total.xpGained += result.xpGained;
    total.newLevels.push(...result.newLevels);

    if (result.kind === "mining" || result.kind === "refine") {
      total.amount += result.amount;
    } else {
      total.tonnes += result.tonnes;
      total.credits += result.credits;
      for (const [itemId, amount] of Object.entries(result.cargo)) {
        total.cargo[itemId] = (total.cargo[itemId] || 0) + amount;
      }
    }
  }
  return merged;
}
