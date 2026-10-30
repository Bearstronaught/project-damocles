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
// There are three kinds of SHIP job: mining trips and haul runs
// (below), and scout trips (js/exploration.js). The refinery's
// batches and the workshop's work orders are jobs too - see
// js/refinery.js and js/workshop.js - so everything plays out on
// the same timeline.
//
// A MINING trip has four phases, one after the other:
//   OUTBOUND  fly from home to the field
//   MINING    fill the hold
//   RETURNING fly home
//   UNLOADING move the ore into the home hold (it arrives at the end)
//
// A HAUL run (freighters) is a loop:
//   WAITING   docked at home until there's ore to load
//             (a full hold, or any ore at all - see HAUL_MODES)
//   LOADING   move the cargo aboard (it leaves the hold at the start)
//   OUTBOUND  fly the cargo to the merchant hub
//   TRADING   unload at the hub and sell (paid at the END of this)
//   RETURNING fly home empty, then back to WAITING
//
// Loading and unloading take time by tonnes moved, at a rate set
// by hull size (bigger hulls, bigger cargo doors - loadingRate in
// HULL_SIZES), so a part load is quicker than a full one.
//
// Every trip is planned FRESH from the ship's current stats
// (ship-upgrades.js), so a new level or upgrade shows up on the
// ship's next trip. The trip already under way keeps its timings.
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
//     unloadMs: 6000,
//     durationMs: 156000,              the four added together
//     orePerTrip: 120,                 tonnes it brings back (a full hold)
//     repeat: true,                    start another trip when done?
//   }
//
// A haul job looks like this:
//   {
//     id, type: "haul", shipId, repeat: true,
//     status: "waiting",       "waiting" at home, or "travelling"
//     startedAt: 1712345678901, when the current run LEFT home
//     loadMs, outboundMs, tradeMs, returnMs, durationMs,
//     cargo: { iron_ore: 60 }, what's on board (null when empty)
//     sold: false,             has this run's cargo been sold yet?
//   }
// =============================================================

import { FIELDS, SHIP_TYPES, ITEMS, HUB, FLEET_XP_EXPONENT, HULL_SIZES } from "../data/content.js";
import { addItem, findShip } from "./state.js";
import { addXp, isFieldUnlocked } from "./skills.js";
import { sellAtHub } from "./trade.js";
import { startWaitingBatches, finishBatch } from "./refinery.js";
import { startWaitingOrders, finishWorkshopBatch } from "./workshop.js";
import { getSellable } from "./bonded.js";
import { getShipStats, getHullGrades } from "./ship-upgrades.js";
import { finishScoutTrip } from "./exploration.js";
import { checkContracts, nextBoardEvent, boardEvent, getCharter, takeCharterHaul } from "./contracts.js";


// =============================================================
// PLANNING: how long things take
// =============================================================

// -------------------------------------------------------------
// getLoadMs(shipTypeId, tonnes)
// How long a ship of this type takes to load or unload this much
// cargo, in ms. The rate comes from its hull size:
//   Prospector (small, 20 t/s), 120 t  ->  6,000 ms (6 seconds)
//   Excavator (medium, 40 t/s), 480 t  -> 12,000 ms
//   0 t = no time.
// -------------------------------------------------------------
export function getLoadMs(shipTypeId, tonnes) {
  const rate = HULL_SIZES[SHIP_TYPES[shipTypeId].size].loadingRate;
  return Math.round((tonnes / rate) * 1000);
}


// -------------------------------------------------------------
// getTripPlan(state, shipTypeId, fieldId)
// Works out one mining trip for a ship of this type, using its
// stats RIGHT NOW (upgrades and the Mining level perk included -
// see getShipStats in ship-upgrades.js).
// -------------------------------------------------------------
// ("grades" is optional: one ship's fitted parts, for the screen.)
export function getTripPlan(state, shipTypeId, fieldId, grades) {
  const stats = getShipStats(state, shipTypeId, grades);
  const field = FIELDS[fieldId];

  // Travel: a speed of 0.75 makes the trip take 1 ÷ 0.75 = 1.33x as long.
  const travelMs = Math.round((field.travelSeconds / stats.speed) * 1000);

  // Mining: minutes to fill the hold = cargo ÷ (tonnes per minute).
  const miningMs = Math.round((stats.cargoCapacity / stats.miningRate) * 60 * 1000);

  // Unloading a full hold at home.
  const unloadMs = getLoadMs(shipTypeId, stats.cargoCapacity);

  return {
    outboundMs: travelMs,
    miningMs: miningMs,
    returnMs: travelMs,
    unloadMs: unloadMs,
    durationMs: travelMs + miningMs + travelMs + unloadMs,
    orePerTrip: stats.cargoCapacity,
    xpPerTrip: stats.cargoCapacity / field.tonnesPerXp,   // e.g. 120 t ÷ 10 = 12 XP
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
// getHaulPlan(state, shipTypeId, tonnes)
// Works out one hub run for a freighter of this type carrying
// "tonnes" (leave it out for a full hold), using its stats now.
//   loadMs   loading at home      (by tonnes)
//   tradeMs  unloading at the hub (by tonnes; it's paid at the end)
// -------------------------------------------------------------
export function getHaulPlan(state, shipTypeId, tonnes, grades) {
  const stats = getShipStats(state, shipTypeId, grades);
  // "??" means: use tonnes, unless it was left out.
  const load = tonnes ?? stats.cargoCapacity;
  const travelMs = Math.round((HUB.travelSeconds / stats.speed) * 1000);
  const loadMs = getLoadMs(shipTypeId, load);

  return {
    loadMs: loadMs,
    outboundMs: travelMs,
    tradeMs: loadMs,          // unloading takes as long as loading
    returnMs: travelMs,
    durationMs: loadMs + travelMs + loadMs + travelMs,
    capacity: stats.cargoCapacity,
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

  const job = {
    id: "job-" + now + "-" + shipId,
    type: "mining",
    shipId: shipId,
    fieldId: fieldId,
    startedAt: now,
    repeat: true,                            // keep mining until recalled
  };
  // The trip's timings and load (see planNextTrip below).
  planNextTrip(state, job);

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

  // A full run's timings, for now. The real ones are set when it
  // loads up and leaves (departWaitingFreighters), once it's
  // known how much cargo it took.
  const plan = getHaulPlan(state, ship.type);

  const job = {
    id: "job-" + now + "-" + shipId,
    type: "haul",
    shipId: shipId,
    status: "waiting",
    startedAt: now,
    loadMs: plan.loadMs,
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
// planNextTrip(state, job)
// Sets a mining job's timings and load for its next trip from
// the ship's stats right now. Called when the job starts, and
// again at the end of every trip, so an upgrade or level-up
// counts from the very next trip.
// -------------------------------------------------------------
function planNextTrip(state, job) {
  const ship = findShip(state, job.shipId);

  // On a charter (contracts.js)? Then this trip goes to the
  // charter's field, and its haul is the client's. A charter
  // starts from the ship's next departure, never mid-trip.
  const charter = getCharter(state, ship.id);
  if (charter) {
    job.fieldId = charter.fieldId;
    job.charter = charter.number;
  } else {
    delete job.charter;
  }

  const plan = getTripPlan(state, ship.type, job.fieldId);
  job.outboundMs = plan.outboundMs;
  job.miningMs = plan.miningMs;
  job.returnMs = plan.returnMs;
  job.unloadMs = plan.unloadMs;
  job.durationMs = plan.durationMs;
  job.orePerTrip = plan.orePerTrip;
  // The ship is at the station now, so it's refitted to the hull's
  // current parts; remember them for this trip (ship-upgrades.js).
  job.fitted = getHullGrades(state, ship.type);
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
//                       (a part-full hold, quicker to unload),
//                       then the normal flight.
//   Barge, returning    carries on home and unloads as normal.
//   Freighter, loading  still at the dock: the cargo goes back in
//                       the hold and it stands down straight away.
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

  // A freighter still loading hasn't left the dock: the cargo goes
  // back in the hold (cancelJob does that) and it stands down.
  // ("|| 0": runs saved before loading time existed have none.)
  const loadMs = job.type === "haul" ? (job.loadMs || 0) : 0;
  if (job.type === "haul" && at < loadMs) {
    cancelJob(state, jobId);
    return { mode: "stoodDown" };
  }

  // Remember the normal timings, in case the player resumes.
  const original = {
    outboundMs: job.outboundMs,
    returnMs: job.returnMs,
    durationMs: job.durationMs,
  };
  if (job.type === "mining") {
    original.miningMs = job.miningMs;
    original.unloadMs = job.unloadMs;
  }
  if (job.type === "haul") original.tradeMs = job.tradeMs;
  if (job.type === "scout") original.scanMs = job.scanMs;

  // How long it has been FLYING out (a freighter loads first).
  const flownOut = at - loadMs;

  let mode;

  if (flownOut < job.outboundMs) {
    // STILL FLYING OUT: turn round. The trip becomes "fly out for
    // 'flownOut' ms, then fly back for the same", with no middle.
    // (A freighter keeps its loading time at the start; its cargo
    // goes back in the hold the moment it docks.)
    mode = "turnback";
    job.outboundMs = flownOut;
    job.returnMs = flownOut;
    job.durationMs = loadMs + flownOut * 2;
    if (job.type === "mining") {
      job.miningMs = 0;
      job.unloadMs = 0;            // nothing to unload
      job.amountOverride = 0;      // nothing mined
    } else if (job.type === "scout") {
      job.scanMs = 0;
      job.abandoned = true;        // never reached the target: no find
    } else {
      job.tradeMs = 0;
      job.noSale = true;           // bring the cargo back unsold
    }
  } else if (job.type === "mining" && at < job.outboundMs + job.miningMs) {
    // AT THE FIELD: stop mining now, keep what's in the hold.
    mode = "leftEarly";
    const minedMs = at - job.outboundMs;
    // The hold fills evenly while mining, so half the time = half
    // the hold. Math.floor rounds down to whole tonnes.
    job.amountOverride = Math.floor(job.orePerTrip * (minedMs / job.miningMs));
    job.miningMs = minedMs;
    job.unloadMs = getLoadMs(findShip(state, job.shipId).type, job.amountOverride);   // a part load unloads quicker
    job.durationMs = job.outboundMs + minedMs + job.returnMs + job.unloadMs;
  } else if (job.type === "scout" && at < job.outboundMs + job.scanMs) {
    // SCANNING: stop now and fly home. An unfinished scan finds
    // nothing and earns no XP (the target stays unsurveyed).
    mode = "leftEarly";
    job.scanMs = at - job.outboundMs;
    job.durationMs = job.outboundMs + job.scanMs + job.returnMs;
    job.abandoned = true;
  } else {
    // ALREADY HEADING HOME (or selling at the hub): carry on as
    // normal, just don't start another trip.
    mode = "finishing";
  }

  job.repeat = false;
  job.recall = { mode: mode, at: at, original: original };

  const amount = job.type === "mining"
    ? (job.amountOverride ?? job.orePerTrip)
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
    // A freighter loaded before flying; a barge flies straight off.
    const loadMs = job.type === "haul" ? (job.loadMs || 0) : 0;

    // Where is it? It flew out for "flownOut" ms, then has been
    // heading home for (flying time - flownOut) ms, so it's this
    // far out:
    const elapsed = Math.min(Math.max(now - job.startedAt, 0), job.durationMs);
    const flownOut = at - loadMs;
    const flying = Math.max(0, elapsed - loadMs);
    const distanceOut = Math.max(0, flownOut - (flying - flownOut));

    // Put the normal trip back, and pretend it set off just long
    // enough ago to be exactly where it is now.
    Object.assign(job, original);
    job.startedAt = now - loadMs - distanceOut;
    delete job.amountOverride;
    delete job.noSale;
    delete job.abandoned;
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
// How many tonnes of goods in the home hold a freighter could
// take, all types added up. Bonded stock doesn't count: freighters
// never take it (see bonded.js).
// -------------------------------------------------------------
export function getOreInHold(state) {
  let total = 0;
  for (const itemId of Object.keys(ITEMS)) {
    total += getSellable(state, itemId);
  }
  return total;
}


// -------------------------------------------------------------
// loadCargo(state, capacity, mode)
// Takes goods out of the home hold to fill a freighter, MOST
// VALUABLE FIRST (by hub price), so the best goods always go.
// Bonded stock is left behind.
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
    const take = Math.min(space, getSellable(state, itemId));   // as much as fits, above the bond
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
    const capacity = getShipStats(state, ship.type).cargoCapacity;
    const cargo = loadCargo(state, capacity, ship.haulMode || "full");

    if (cargo) {
      job.status = "travelling";
      job.startedAt = time;
      job.cargo = cargo;
      job.sold = false;

      // Plan this run for what it actually loaded: a part load
      // loads and unloads quicker. The stats are the ship's now,
      // so an upgrade counts from the next run.
      const tonnes = Object.values(cargo).reduce((sum, t) => sum + t, 0);
      const plan = getHaulPlan(state, ship.type, tonnes);
      job.loadMs = plan.loadMs;
      job.outboundMs = plan.outboundMs;
      job.tradeMs = plan.tradeMs;
      job.returnMs = plan.returnMs;
      job.durationMs = plan.durationMs;
      // Refitted at the dock before leaving (ship-upgrades.js).
      job.fitted = getHullGrades(state, ship.type);
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
//     phase: one of the names below, or "waiting",
//     msLeftInPhase: 12000,
//     fills: [1, 0.4, 0, 0],   how full each phase is, 0 to 1
//   }
// The phases, in order:
//   barge:      outbound, mining, returning, unloading
//   freighter:  loading, outbound, trading, returning
//   scout:      outbound, scanning, returning
// -------------------------------------------------------------
export function getJobPhase(job, now) {
  // A freighter waiting at home hasn't started its run yet.
  if (job.type === "haul" && job.status === "waiting") {
    return { phase: "waiting", msLeftInPhase: 0, fills: [0, 0, 0, 0] };
  }

  // Each phase's name and length, in order. ("|| 0" covers trips
  // saved before loading time existed.)
  let phases;
  if (job.type === "haul") {
    phases = [
      ["loading", job.loadMs || 0],
      ["outbound", job.outboundMs],
      ["trading", job.tradeMs],
      ["returning", job.returnMs],
    ];
  } else if (job.type === "scout") {
    // A scout carries no cargo, so it has nothing to unload.
    phases = [
      ["outbound", job.outboundMs],
      ["scanning", job.scanMs],
      ["returning", job.returnMs],
    ];
  } else {
    phases = [
      ["outbound", job.outboundMs],
      ["mining", job.miningMs],
      ["returning", job.returnMs],
      ["unloading", job.unloadMs || 0],
    ];
  }

  // Time into this trip, kept between 0 and the trip length.
  const elapsed = Math.min(Math.max(now - job.startedAt, 0), job.durationMs);

  // Walk through the phases, adding up where each one starts.
  const fills = [];
  let current = null;
  let start = 0;
  for (const [name, length] of phases) {
    const end = start + length;
    // How full: "elapsed minus where the phase starts, divided by
    // its length", kept between 0 and 1. A phase of length 0 (a
    // recalled ship that never reached the field) counts as full
    // once we're past it, so we never divide by 0.
    if (length === 0) {
      fills.push(elapsed >= start ? 1 : 0);
    } else {
      fills.push(Math.min(Math.max((elapsed - start) / length, 0), 1));
    }
    // The first phase that hasn't finished is the one we're in.
    if (current === null && elapsed < end) {
      current = { phase: name, msLeftInPhase: end - elapsed };
    }
    start = end;
  }

  // Past every phase: it's in the last moment of the last one.
  if (current === null) {
    const [lastName] = phases[phases.length - 1];
    current = { phase: lastName, msLeftInPhase: 0 };
  }
  return { ...current, fills };
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
//   workshop: { kind: "workshop", slot, recipeId, itemId, amount,
//             trips, ordersFinished, slotIdle,
//             skillId: "manufacturing", xpGained, newLevels }
//           (the same, for the workshop)
//   scout:  { kind: "scout", shipId, trips, surveys, deepScans,
//             finds, skillId: "exploration", xpGained, newLevels }
//           (see exploration.js, finishScoutTrip)
// -------------------------------------------------------------
export function processJobs(state, now) {
  const results = [];

  // A freighter might be able to leave because of something the
  // player just did (like switching to constant runs). The
  // earliest that can count is the next event, or now.
  // The same goes for a refinery or workshop slot waiting for
  // ore or metal.
  const first = findNextEvent(state, now);
  const startTime = first ? Math.min(first.time, now) : now;
  startWaitingAll(state, startTime);
  // The contracts board too: finished work pays out, a new board
  // posts its first contracts (contracts.js).
  results.push(...checkContracts(state, startTime));

  // Then replay every due event, earliest first.
  // (The safety limit stops a bug from freezing the browser.)
  for (let count = 0; count < 1_000_000; count++) {
    const next = findNextEvent(state, now);
    if (!next) break;   // nothing else is due yet

    // A board slot due a new contract, or a job's event
    const result = next.board !== undefined
      ? boardEvent(state, next.board)
      : runEvent(state, next.job, next.time);
    if (result) {
      results.push(result);
    }

    // Ore may have just arrived, a batch just finished, or a
    // freighter just docked: anyone waiting gets a chance to
    // start. And a contract's work may now be done.
    startWaitingAll(state, next.time);
    results.push(...checkContracts(state, next.time));
  }

  return mergeResultsByShip(results);
}


// -------------------------------------------------------------
// startWaitingAll(state, time)
// Everything that waits for goods in the home hold gets a
// chance to start, in a fixed order of who gets first pick:
//   1. the refinery (takes ore)
//   2. the workshop (takes metal and components)
//   3. freighters   (take whatever is left, most valuable first)
// The order matters when they want the same goods: freighters
// come last, so they never empty the hold of metal the workshop
// was about to use.
// -------------------------------------------------------------
function startWaitingAll(state, time) {
  startWaitingBatches(state, time);
  startWaitingOrders(state, time);
  departWaitingFreighters(state, time);
}


// -------------------------------------------------------------
// findNextEvent(state, now)
// The earliest thing due to happen at or before "now", as
// { job, time }, or null if nothing is due yet.
//   Mining job:  the trip finishing (ship docks with ore)
//   Scout job:   the trip finishing (scout docks with its find)
//   Haul job:    selling at the hub, then docking back home
//   Refinery or workshop job: the current batch finishing
//   Waiting freighters, refinery slots and workshop slots have
//   no event - they wait for goods.
// -------------------------------------------------------------
function findNextEvent(state, now) {
  let best = null;

  for (const job of state.jobs) {
    let time;

    if (job.type === "mining" || job.type === "scout") {
      time = job.startedAt + job.durationMs;              // docks home
    } else if (job.type === "refine" && job.status === "working") {
      time = job.startedAt + job.durationMs;              // batch done
    } else if (job.type === "workshop" && job.status === "working") {
      time = job.startedAt + job.durationMs;              // workshop batch done
    } else if (job.type === "haul" && job.status === "travelling") {
      time = (job.sold || job.noSale)
        ? job.startedAt + job.durationMs                  // docks back home
        : job.startedAt + (job.loadMs || 0) + job.outboundMs + job.tradeMs;   // sells at the hub
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

  // A contracts board slot due a new contract (contracts.js). On a
  // tie with a job, the job goes first (strictly earlier only).
  const board = nextBoardEvent(state, now);
  if (board && (best === null || board.time < best.time)) {
    best = { board: board.slot, time: board.time };
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

  // --- A workshop batch finishes: a product into the hold ---
  if (job.type === "workshop") {
    return finishWorkshopBatch(state, job);
  }

  // --- A scout docks: its find and Exploration XP ---
  if (job.type === "scout") {
    return finishScoutTrip(state, job);
  }

  // --- A mining trip finishes: unload ore, earn Mining XP ---
  if (job.type === "mining") {
    const field = FIELDS[job.fieldId];

    // A full hold - unless it was recalled before filling up.
    // (The load was fixed when the trip was planned, so an upgrade
    // bought mid-trip can't add ore the ship never mined.)
    const amount = job.amountOverride ?? job.orePerTrip;
    // Full XP for the ore, times this ship's share of the fleet's XP.
    // Worked out BEFORE a recalled ship leaves the job list below.
    const xp = (amount / field.tonnesPerXp) * getMiningXpShare(state);
    delete job.amountOverride;

    let newLevels = [];
    let chartered = 0;   // tonnes handed to a charter's client
    if (amount > 0) {
      // A chartered trip: the client takes what's still owed, and
      // anything over goes into your hold like any other haul.
      if (job.charter !== undefined) {
        chartered = takeCharterHaul(state, job.charter, amount);
      }
      if (amount > chartered) addItem(state, field.yields, amount - chartered);
      // Mining XP either way: the ship did the work.
      newLevels = addXp(state, "mining", xp);
      // The running total of ore mined at each field
      state.stats.mined[job.fieldId] = (state.stats.mined[job.fieldId] || 0) + amount;
    }

    if (job.repeat) {
      // The next trip starts the moment this one ends, so no
      // time is lost between trips.
      job.startedAt += job.durationMs;
      // Plan the next trip from the ship's stats NOW: a level just
      // gained or an upgrade just bought counts from here. (This
      // also puts a trip that was cut short back to normal.)
      delete job.restoreAfterTrip;
      planNextTrip(state, job);
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
      chartered: chartered,        // of which went to a charter's client
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
    // Contracts are never added together: each one is its own line.
    if (result.kind === "contract" || result.kind === "posted") {
      merged.push(result);
      continue;
    }

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
      if (copy.surveys) copy.surveys = [...copy.surveys];
      if (copy.finds) copy.finds = [...copy.finds];
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
      if (result.kind === "mining") total.chartered = (total.chartered || 0) + result.chartered;
    } else if (result.kind === "scout") {
      // Several trips: every survey and find, one after another.
      total.surveys.push(...result.surveys);
      total.deepScans += result.deepScans;
      total.finds.push(...result.finds);
    } else if (result.kind === "workshop") {
      total.amount += result.amount;
      total.ordersFinished += result.ordersFinished;
      // Idle only if the LAST batch left it idle (a slot can go
      // idle, then get a new order, then keep working).
      total.slotIdle = result.slotIdle;
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
