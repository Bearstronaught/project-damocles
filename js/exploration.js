// =============================================================
// js/exploration.js
// -------------------------------------------------------------
// EXPLORATION: scouts, survey targets and deep scans
// (design doc, Early exploration - agreed 30 Oct).
//
// A scout (the Pathfinder) flies out to a TARGET in the home
// system, scans it, and flies home with what it found:
//
//   OUTBOUND  fly to the target
//   SCANNING  scan it (Exploration levels make this faster)
//   RETURNING fly home; the find and the XP arrive on docking
//
// Each SURVEY TARGET (content.js) is a one-off: once surveyed it's
// done, and its find and its line of lore are kept. When a trip
// ends, the scout moves straight on to the next target it can do,
// so it keeps working while the player is away. With no targets
// left it runs DEEP SCANS, which never run out.
//
// A scout job looks like this (it lives in state.jobs with the
// ships' other jobs, and jobs.js plays it out on the same
// timeline):
//   {
//     id: "job-1712345678901-ship-3",
//     type: "scout",
//     shipId: "ship-3",
//     targetId: "inner_belt_survey",   or "deep_scan"
//     startedAt: 1712345678901,        when the CURRENT trip began
//     outboundMs, scanMs, returnMs,    each phase's length
//     durationMs,                      the three added together
//     repeat: true,                    carry on after this trip?
//   }
// If it's recalled mid-scan, job.abandoned = true: the scan is
// unfinished, so it brings nothing back (see jobs.js, recallJob).
// =============================================================

import { SURVEY_TARGETS, DEEP_SCAN, EXPLORATION, SHIP_TYPES, FLEET_XP_EXPONENT } from "../data/content.js";
import { getLevel, addXp } from "./skills.js";
import { addItem, findShip } from "./state.js";
import { getShipStats, getHullGrades } from "./ship-upgrades.js";

// The deep scan isn't in SURVEY_TARGETS (it never runs out), but
// a scout's destination can be it, under this ID.
export const DEEP_SCAN_ID = "deep_scan";


// =============================================================
// TARGETS: what can be surveyed, and what's done
// =============================================================

// -------------------------------------------------------------
// getTarget(targetId)
// The data for a target or the deep scan: name, numbers, words.
// -------------------------------------------------------------
export function getTarget(targetId) {
  return targetId === DEEP_SCAN_ID ? DEEP_SCAN : SURVEY_TARGETS[targetId];
}

// Every place a scout can go, in order: the targets, then the
// deep scan. (Used for the destination dropdown.)
export function getAllTargetIds() {
  return [...Object.keys(SURVEY_TARGETS), DEEP_SCAN_ID];
}

// -------------------------------------------------------------
// isSurveyed(state, targetId)
// True once this target's survey has been finished.
// -------------------------------------------------------------
export function isSurveyed(state, targetId) {
  return Boolean(state.exploration.surveyed[targetId]);
}

// -------------------------------------------------------------
// getTargetStatus(state, targetId)
// Where a target stands, as one word:
//   "surveyed"   done (never for the deep scan: it repeats)
//   "locked"     Exploration level too low
//   "needs"      another target must be surveyed first
//                (the wreck's stages go in order)
//   "available"  a scout can go there now
// -------------------------------------------------------------
export function getTargetStatus(state, targetId) {
  const target = getTarget(targetId);
  if (targetId !== DEEP_SCAN_ID && isSurveyed(state, targetId)) {
    return "surveyed";
  }
  if (getLevel(state, "exploration") < target.unlockLevel) {
    return "locked";
  }
  if (target.requires && !isSurveyed(state, target.requires)) {
    return "needs";
  }
  return "available";
}

// -------------------------------------------------------------
// isTargetTaken(state, targetId, shipId)
// True if ANOTHER scout is already heading for this target, so
// two scouts never survey the same place. (Any number of scouts
// can run deep scans.)
// -------------------------------------------------------------
export function isTargetTaken(state, targetId, shipId) {
  if (targetId === DEEP_SCAN_ID) return false;
  return state.jobs.some((job) => job.type === "scout" && job.targetId === targetId && job.shipId !== shipId);
}

// -------------------------------------------------------------
// canScoutGo(state, shipId, targetId)
// Can this scout be sent to this target right now?
// -------------------------------------------------------------
export function canScoutGo(state, shipId, targetId) {
  return getTarget(targetId) !== undefined
    && getTargetStatus(state, targetId) === "available"
    && !isTargetTaken(state, targetId, shipId);
}

// -------------------------------------------------------------
// chooseNextTarget(state, shipId)
// Where a scout should go next: the first target in the list it
// can do, or the deep scan when there are none.
// -------------------------------------------------------------
export function chooseNextTarget(state, shipId) {
  for (const targetId of Object.keys(SURVEY_TARGETS)) {
    if (canScoutGo(state, shipId, targetId)) {
      return targetId;
    }
  }
  return DEEP_SCAN_ID;
}

// -------------------------------------------------------------
// getTargetUnlocksAtLevel(level)
// Which targets open at exactly this Exploration level (for the
// level-up banner and log), e.g. ["wreck_1"].
// -------------------------------------------------------------
export function getTargetUnlocksAtLevel(level) {
  return Object.keys(SURVEY_TARGETS).filter((id) => SURVEY_TARGETS[id].unlockLevel === level);
}

// How many targets are surveyed, and how many there are.
export function getSurveyCount(state) {
  const all = Object.keys(SURVEY_TARGETS);
  return { done: all.filter((id) => isSurveyed(state, id)).length, total: all.length };
}


// =============================================================
// PLANNING A TRIP
// =============================================================

// -------------------------------------------------------------
// getScanFactor(state)
// Exploration's level perk: each level above 1 makes the scan
// part of a trip 0.5% shorter (EXPLORATION.scanSpeedPerLevel),
// the same way Refining levels speed up the refinery.
//   level 1 -> 1.00 (full time), level 11 -> 0.95
// -------------------------------------------------------------
export function getScanFactor(state) {
  const level = getLevel(state, "exploration");
  // Never less than a tenth of the normal time, whatever the sheet says.
  return Math.max(0.1, 1 - EXPLORATION.scanSpeedPerLevel * (level - 1));
}

// -------------------------------------------------------------
// getScoutPlan(state, shipTypeId, targetId, grades)
// One trip for a scout of this type to this target, using its
// stats right now. A Pathfinder (speed 1.25) to the Inner Belt
// (45 s away, 120 s scan) at Exploration 1:
//   outbound 36 s + scanning 120 s + returning 36 s = 3 min 12 s
// ("grades" is optional: one ship's fitted parts.)
// -------------------------------------------------------------
export function getScoutPlan(state, shipTypeId, targetId, grades) {
  const stats = getShipStats(state, shipTypeId, grades);
  const target = getTarget(targetId);

  const travelMs = Math.round((target.travelSeconds / stats.speed) * 1000);
  const scanMs = Math.round(target.scanSeconds * 1000 * getScanFactor(state));

  return {
    outboundMs: travelMs,
    scanMs: scanMs,
    returnMs: travelMs,
    durationMs: travelMs + scanMs + travelMs,
    xp: target.xp,
  };
}


// =============================================================
// STARTING A SCOUT
// =============================================================

// -------------------------------------------------------------
// startScoutJob(state, shipId, targetId, now)
// Sends a scout to a target. Returns the new job, or null if it
// can't go (busy, not a scout, or the target isn't available).
// -------------------------------------------------------------
export function startScoutJob(state, shipId, targetId, now) {
  const ship = findShip(state, shipId);
  if (!ship || SHIP_TYPES[ship.type].role !== "scout") return null;
  if (state.jobs.some((job) => job.shipId === shipId)) return null;   // one job at a time
  if (!canScoutGo(state, shipId, targetId)) return null;

  const job = {
    id: "job-" + now + "-" + shipId,
    type: "scout",
    shipId: shipId,
    targetId: targetId,
    startedAt: now,
    repeat: true,              // move on to the next target when done
  };
  planScoutTrip(state, job);
  state.jobs.push(job);
  ship.destination = targetId;
  return job;
}

// -------------------------------------------------------------
// planScoutTrip(state, job)
// Sets a scout job's timings from the ship's stats and the
// Exploration level RIGHT NOW. Called when the job starts and at
// the start of every trip after, so a level-up counts from the
// next trip.
// -------------------------------------------------------------
function planScoutTrip(state, job) {
  const ship = findShip(state, job.shipId);
  const plan = getScoutPlan(state, ship.type, job.targetId);
  job.outboundMs = plan.outboundMs;
  job.scanMs = plan.scanMs;
  job.returnMs = plan.returnMs;
  job.durationMs = plan.durationMs;
  job.fitted = getHullGrades(state, ship.type);   // refitted at the dock
}


// =============================================================
// FINISHING A TRIP (called by jobs.js when a scout docks)
// =============================================================

// -------------------------------------------------------------
// getScoutXpShare(state)
// Scouts out working share Exploration XP by the same fleet rule
// as barges and freighters: each extra scout adds a little less.
// -------------------------------------------------------------
export function getScoutXpShare(state) {
  const scouting = state.jobs.filter((job) => job.type === "scout").length;
  return scouting <= 1 ? 1 : scouting ** (FLEET_XP_EXPONENT - 1);
}

// -------------------------------------------------------------
// finishScoutTrip(state, job)
// A scout has docked. If its scan was finished, it hands over its
// find and earns Exploration XP. Then it either sets off for the
// next target (repeat) or stays docked (recalled).
//
// Returns a result for the log:
//   { kind: "scout", shipId, trips: 1, surveys: ["wreck_1"],
//     deepScans: 0, finds: [{ targetId, credits, item, tonnes }],
//     skillId: "exploration", xpGained, newLevels }
// An abandoned scan (recalled mid-scan) returns kind "docked".
// -------------------------------------------------------------
export function finishScoutTrip(state, job) {
  const targetId = job.targetId;
  const abandoned = Boolean(job.abandoned);
  delete job.abandoned;

  const result = {
    kind: abandoned ? "docked" : "scout",
    shipId: job.shipId,
    trips: 1,
    surveys: [],
    deepScans: 0,
    finds: [],
    skillId: "exploration",
    xpGained: 0,
    newLevels: [],
  };

  if (!abandoned) {
    // XP is worked out BEFORE a recalled scout leaves the job list,
    // so it counts itself in the fleet share (like barges do).
    const xp = getTarget(targetId).xp * getScoutXpShare(state);
    const find = targetId === DEEP_SCAN_ID ? rollDeepScanFind(state) : collectSurvey(state, targetId);
    if (targetId === DEEP_SCAN_ID) {
      result.deepScans = 1;
    } else {
      result.surveys.push(targetId);
    }
    if (find) {
      result.finds.push(find);
    }
    result.xpGained = xp;
    result.newLevels = addXp(state, "exploration", xp);
  }

  if (job.repeat) {
    // Straight on to the next trip, from the moment this one ended.
    job.startedAt += job.durationMs;
    // An unfinished scan goes back to the same target (if it still
    // can); otherwise pick the next target, or a deep scan.
    job.targetId = abandoned && canScoutGo(state, job.shipId, targetId)
      ? targetId
      : chooseNextTarget(state, job.shipId);
    findShip(state, job.shipId).destination = job.targetId;
    planScoutTrip(state, job);
  } else {
    // Recalled: it docks and stays docked.
    state.jobs = state.jobs.filter((j) => j !== job);
  }
  return result;
}

// -------------------------------------------------------------
// collectSurvey(state, targetId)
// Marks a target surveyed and hands over its find: credits and/or
// goods into the home hold. Returns the find, for the log.
// -------------------------------------------------------------
function collectSurvey(state, targetId) {
  const target = SURVEY_TARGETS[targetId];
  state.exploration.surveyed[targetId] = true;

  if (target.credits > 0) {
    state.credits += target.credits;
  }
  if (target.item && target.tonnes > 0) {
    addItem(state, target.item, target.tonnes);
  }
  return { targetId, credits: target.credits, item: target.item, tonnes: target.tonnes };
}


// =============================================================
// DEEP SCAN FINDS: a fixed dice roll per save
// =============================================================
// Some deep scans find something. Which ones is decided by a
// "dice roll", but NOT Math.random(): that would give different
// finds each time the same hour is played, and the design doc's
// promise is that an hour away gives exactly the same result as
// an hour played. Instead each save has its own random "seed"
// (made once, in createNewGame), and the roll for deep scan
// number N is worked out from the seed and N. Same save, same
// scan number -> same roll, every time.

// -------------------------------------------------------------
// rollFor(seed, scanNumber, which)
// A number from 0 up to (not including) 1, fixed for these three
// inputs. "which" picks a different roll for the same scan (0 =
// is there a find, 1 = what kind, 2 = how much).
//
// How: the three numbers are mixed into one 32-bit number and
// stirred with multiplications and bit shifts (a standard "hash",
// the kind used to spread numbers evenly). The result looks
// random but is always the same for the same inputs.
// -------------------------------------------------------------
export function rollFor(seed, scanNumber, which) {
  // ">>> 0" keeps a number as a whole number from 0 to 4,294,967,295
  // (32 bits). Math.imul multiplies two of those the way a 32-bit
  // computer would, throwing away the overflow.
  let x = (seed + Math.imul(scanNumber + 1, 0x9e3779b1) + Math.imul(which + 1, 0x85ebca77)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;   // 2^32: turns 0..4,294,967,295 into 0..1
}

// -------------------------------------------------------------
// rollDeepScanFind(state)
// Counts one more deep scan, and rolls for a find. Returns the
// find ({ targetId: "deep_scan", credits, item, tonnes }) or null.
// With findChance 0.3, about 3 scans in 10 find something; of
// those, alloyShare are wreck alloy and the rest are credits.
// -------------------------------------------------------------
function rollDeepScanFind(state) {
  const explore = state.exploration;
  const scanNumber = explore.deepScans;
  explore.deepScans += 1;

  if (rollFor(explore.seed, scanNumber, 0) >= DEEP_SCAN.findChance) {
    return null;   // nothing this time
  }

  let find;
  if (rollFor(explore.seed, scanNumber, 1) < DEEP_SCAN.alloyShare) {
    addItem(state, "wreck_alloy", DEEP_SCAN.alloyTonnes);
    find = { targetId: DEEP_SCAN_ID, credits: 0, item: "wreck_alloy", tonnes: DEEP_SCAN.alloyTonnes };
  } else {
    // Somewhere between creditsMin and creditsMax, rounded to 50.
    const spread = DEEP_SCAN.creditsMax - DEEP_SCAN.creditsMin;
    const credits = Math.round((DEEP_SCAN.creditsMin + spread * rollFor(explore.seed, scanNumber, 2)) / 50) * 50;
    state.credits += credits;
    find = { targetId: DEEP_SCAN_ID, credits, item: null, tonnes: 0 };
  }
  explore.deepFinds += 1;
  return find;
}


// =============================================================
// MILESTONES (content.js MILESTONES)
// =============================================================

// True once the player has done this, e.g. "firstSale".
export function hasMilestone(state, milestoneId) {
  return Boolean(state.milestones[milestoneId]);
}

// Records a milestone. Returns true if it's new (so the screen
// can announce it once).
export function reachMilestone(state, milestoneId) {
  if (state.milestones[milestoneId]) return false;
  state.milestones[milestoneId] = true;
  return true;
}

// -------------------------------------------------------------
// isExplorationOpen(state)
// The Exploration tab and the Pathfinder appear together, once
// the player has sold their first ore (design doc).
// -------------------------------------------------------------
export function isExplorationOpen(state) {
  return hasMilestone(state, SHIP_TYPES.pathfinder.unlockAfter);
}
