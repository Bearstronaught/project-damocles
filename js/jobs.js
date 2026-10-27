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
// A job looks like this:
//   {
//     id: "job-1712345678901",   unique name for this job
//     type: "mining",            what kind of work it is
//     shipId: "ship-1",          which ship is doing it
//     fieldId: "inner_belt",     where it's mining
//     startedAt: 1712345678901,  timestamp the CURRENT trip began
//     durationMs: 20000,         how long one trip takes (ms)
//     repeat: true,              start another trip when done?
//   }
// =============================================================

import { FIELDS, SHIP_TYPES } from "../data/content.js";
import { addItem, findShip } from "./state.js";


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

  const field = FIELDS[fieldId];

  const job = {
    id: "job-" + now + "-" + shipId,
    type: "mining",
    shipId: shipId,
    fieldId: fieldId,
    startedAt: now,
    durationMs: field.tripSeconds * 1000,   // seconds -> milliseconds
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
// (0 = just left, 0.5 = halfway, 1 = done.) Used for the
// progress bar.
// -------------------------------------------------------------
export function getJobProgress(job, now) {
  const elapsed = now - job.startedAt;
  const progress = elapsed / job.durationMs;

  // Math.min stops it going over 1 if we're a bit late checking.
  return Math.min(progress, 1);
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
//   [ { shipId, itemId, amount, trips }, ... ]
// -------------------------------------------------------------
export function processJobs(state, now) {
  const results = [];
  const jobsStillRunning = [];

  for (const job of state.jobs) {
    // How many FULL trips fit between the start and now?
    // e.g. 65 seconds passed, 20 second trips -> 3 trips done.
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
      // (65s passed, 3 x 20s paid -> next trip is already 5s in.)
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
    const shipType = SHIP_TYPES[ship.type];
    const field = FIELDS[job.fieldId];

    // Each trip brings back a full hold of the field's ore.
    const amount = shipType.cargoCapacity * trips;
    addItem(state, field.yields, amount);

    return { shipId: job.shipId, itemId: field.yields, amount: amount, trips: trips };
  }

  // Any job type we don't recognise gives nothing (safety net).
  return { shipId: job.shipId, itemId: null, amount: 0, trips: trips };
}
