// =============================================================
// js/jobs.js
// -------------------------------------------------------------
// JOBS: timed work, like a ship's mining trip.
//
// THE BIG IDEA: a job never "counts down". It only remembers
// WHEN it started and HOW LONG it takes. To know if it's done,
// we just compare that with the clock.
//
// Why? Because it means it doesn't matter whether the game was
// open the whole time or closed for 6 hours - the maths is the
// same. Offline progress comes for free.
//
// A mining trip has three phases, one after the other:
//   OUTBOUND  fly from home to the field
//   MINING    fill the hold
//   RETURNING fly home and unload
//
// A job looks like this:
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
// =============================================================

import { FIELDS, SHIP_TYPES } from "../data/content.js";
import { addItem, findShip } from "./state.js";
import { addXp, isFieldUnlocked } from "./skills.js";


// -------------------------------------------------------------
// getTripPlan(shipTypeId, fieldId)
// Works out how long each phase of a trip takes for this kind
// of ship at this field, plus what one trip brings back.
// Used to start jobs AND to show stats in the shipyard.
// -------------------------------------------------------------
export function getTripPlan(shipTypeId, fieldId) {
  const shipType = SHIP_TYPES[shipTypeId];
  const field = FIELDS[fieldId];

  // Travel: a speed of 0.75 makes the trip take 1 ÷ 0.75 = 1.33x as long.
  const travelMs = Math.round((field.travelSeconds / shipType.speed) * 1000);

  // Mining: minutes to fill the hold = cargo ÷ (units per minute).
  const miningMs = Math.round((shipType.cargoCapacity / shipType.miningRate) * 60 * 1000);

  return {
    outboundMs: travelMs,
    miningMs: miningMs,
    returnMs: travelMs,
    durationMs: travelMs + miningMs + travelMs,
    orePerTrip: shipType.cargoCapacity,
    xpPerTrip: shipType.cargoCapacity * field.xpPerUnit,
  };
}


// -------------------------------------------------------------
// startMiningJob(state, shipId, fieldId, now)
// Sends a ship off to mine. Returns the new job.
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
// cancelJob(state, jobId)
// Removes a job. Any trip in progress is lost (the ship turns
// back before filling its hold).
// -------------------------------------------------------------
export function cancelJob(state, jobId) {
  // .filter keeps every job EXCEPT the one with this ID.
  state.jobs = state.jobs.filter((job) => job.id !== jobId);
}


// -------------------------------------------------------------
// getJobForShip(state, shipId)
// Returns the job a ship is doing, or undefined if it's idle.
// -------------------------------------------------------------
export function getJobForShip(state, shipId) {
  return state.jobs.find((job) => job.shipId === shipId);
}


// -------------------------------------------------------------
// getJobProgress(job, now)
// How far through its current trip a job is, from 0 to 1.
// (0 = just left, 0.5 = halfway, 1 = done.)
// -------------------------------------------------------------
export function getJobProgress(job, now) {
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
//     phase: "outbound" | "mining" | "returning",
//     msLeftInPhase: 12000,
//     fills: [1, 0.4, 0],   how full each phase is, 0 to 1
//   }
// -------------------------------------------------------------
export function getJobPhase(job, now) {
  // Time into this trip, kept between 0 and the trip length.
  const elapsed = Math.min(Math.max(now - job.startedAt, 0), job.durationMs);

  const outEnd = job.outboundMs;                 // when outbound finishes
  const mineEnd = job.outboundMs + job.miningMs; // when mining finishes

  // How full each phase is: "elapsed minus where the phase
  // starts, divided by its length", kept between 0 and 1.
  const fill = (start, length) => Math.min(Math.max((elapsed - start) / length, 0), 1);
  const fills = [
    fill(0, job.outboundMs),
    fill(outEnd, job.miningMs),
    fill(mineEnd, job.returnMs),
  ];

  if (elapsed < outEnd) {
    return { phase: "outbound", msLeftInPhase: outEnd - elapsed, fills };
  }
  if (elapsed < mineEnd) {
    return { phase: "mining", msLeftInPhase: mineEnd - elapsed, fills };
  }
  return { phase: "returning", msLeftInPhase: job.durationMs - elapsed, fills };
}


// -------------------------------------------------------------
// processJobs(state, now)
// THE HEART OF THE IDLE GAME.
// Finishes every trip that's due, gives out the rewards, and
// starts the next trip for repeating jobs.
//
// Called many times a second while playing, AND once on load
// to catch up on time away. Same function either way.
//
// Returns a list of what happened, so the screen can report it:
//   [ { shipId, itemId, amount, trips, skillId, xpGained, newLevels }, ... ]
// -------------------------------------------------------------
export function processJobs(state, now) {
  const results = [];
  const jobsStillRunning = [];

  for (const job of state.jobs) {
    // How many FULL trips fit between the start and now?
    // e.g. 400 seconds passed, 150 second trips -> 2 trips done.
    const elapsed = now - job.startedAt;
    let tripsDone = Math.floor(elapsed / job.durationMs);

    // Safety: if the clock reads earlier than the start time
    // (e.g. the computer's clock was changed), count no trips
    // rather than a negative number.
    if (tripsDone < 0) {
      tripsDone = 0;
    }

    // A one-off job can only ever finish once.
    if (!job.repeat && tripsDone > 1) {
      tripsDone = 1;
    }

    // Hand out rewards for every finished trip.
    if (tripsDone > 0) {
      const reward = completeTrips(state, job, tripsDone);
      results.push(reward);
    }

    if (tripsDone === 0) {
      // Still on its first trip: keep it as it is.
      jobsStillRunning.push(job);
    } else if (job.repeat) {
      // Move the start time forward by the trips we just paid
      // out, so the leftover time counts towards the next trip.
      // (400s passed, 2 x 150s paid -> next trip is already 100s in.)
      job.startedAt += tripsDone * job.durationMs;
      jobsStillRunning.push(job);
    }
    // A one-off job that finished is simply not kept.
  }

  state.jobs = jobsStillRunning;
  return results;
}


// -------------------------------------------------------------
// completeTrips(state, job, trips)
// Gives the player the reward for a number of finished trips.
// Kept separate so each job TYPE can have its own reward later
// (refining, hauling, scouting...).
// -------------------------------------------------------------
function completeTrips(state, job, trips) {
  if (job.type === "mining") {
    const ship = findShip(state, job.shipId);
    const plan = getTripPlan(ship.type, job.fieldId);
    const field = FIELDS[job.fieldId];

    // Each trip brings back a full hold of the field's ore.
    const amount = plan.orePerTrip * trips;
    addItem(state, field.yields, amount);

    // ...and earns Mining XP for every unit brought home.
    // addXp tells us about any level-ups.
    const xpGained = plan.xpPerTrip * trips;
    const newLevels = addXp(state, "mining", xpGained);

    return {
      shipId: job.shipId,
      itemId: field.yields,
      amount: amount,
      trips: trips,
      skillId: "mining",
      xpGained: xpGained,
      newLevels: newLevels,
    };
  }

  // Any job type we don't recognise gives nothing (safety net).
  return { shipId: job.shipId, itemId: null, amount: 0, trips: trips, xpGained: 0, newLevels: [] };
}
