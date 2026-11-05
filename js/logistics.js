// =============================================================
// js/logistics.js
// -------------------------------------------------------------
// THE LOGISTICS OFFICE (design doc, Logistics office under Skills)
//
// An Anvil Station upgrade, bought on the Industry tab once Trade
// reaches 15 (Dan, 5 Nov). Without it, each freighter is set to
// one of two habits (HAUL_MODES in content.js):
//   "Full loads"     wait until the hold can fill it completely
//   "Constant runs"  leave with whatever is in the hold
//
// With the office, every freighter on hub runs is MANAGED instead,
// by two rules that apply to all of them:
//
//   1. DEPARTURE RULES. A freighter leaves when the hold can fill
//      it to a set percentage (say 75%), or after it has waited a
//      set time (say 20 minutes) with at least some goods to take,
//      whichever comes first. A hold that can fill it completely
//      always means it leaves straight away.
//
//   2. STAGGERING. Freighters that would leave part-full spread
//      their departures out instead of all leaving together and
//      coming back with near-empty holds. The gap between two
//      departures is one round trip divided by the number of
//      freighters on hub runs: 3 freighters on a 7-minute run
//      leave about 2m 20s apart.
//
// Everything here is worked out from the save and the clock, so
// time away gives exactly the same departures as time played
// (the engine in jobs.js asks getLeaveTime when the next one is).
// =============================================================

import { LOGISTICS } from "../data/content.js";
import { isOwned } from "./upgrades.js";

const MINUTE = 60 * 1000;


// -------------------------------------------------------------
// createLogistics()
// The office's settings for a new game (or an older save):
// the defaults from content.js, and no departure yet.
//   e.g. { fillPercent: 100, waitMinutes: 20, stagger: true,
//          lastDepartureAt: null }
// -------------------------------------------------------------
export function createLogistics() {
  return {
    fillPercent: LOGISTICS.defaultFillPercent,   // leave once the hold can fill it this full
    waitMinutes: LOGISTICS.defaultWaitMinutes,   // ...or after waiting this long
    stagger: true,                               // spread part-full departures out
    lastDepartureAt: null,                       // when a managed freighter last left
  };
}


// -------------------------------------------------------------
// hasLogisticsOffice(state)
// True once the office has been bought. Every freighter is then
// managed by its rules, and the Full loads / Constant runs choice
// on each freighter card is no longer used.
// -------------------------------------------------------------
export function hasLogisticsOffice(state) {
  return isOwned(state, "logistics_office");
}


// -------------------------------------------------------------
// getStaggerGapMs(state, roundTripMs, freightersOnRuns)
// How long a managed freighter waits after the last departure
// before it may leave part-full.
//   e.g. a 7-minute round trip and 3 freighters on hub runs
//        -> 7 / 3 = 2m 20s
// No gap when staggering is off, or with only one freighter
// (there's nobody to spread out from).
// -------------------------------------------------------------
export function getStaggerGapMs(state, roundTripMs, freightersOnRuns) {
  if (!state.logistics.stagger || freightersOnRuns <= 1) return 0;
  return roundTripMs / freightersOnRuns;
}


// -------------------------------------------------------------
// getLeaveTime(state, job, capacity, available, roundTripMs, freightersOnRuns)
// The earliest moment this WAITING freighter may leave, going by
// what's in the home hold right now. Returns a timestamp, or
// null if it can't leave until more goods arrive.
//   job          the freighter's haul job (job.startedAt is when
//                it began waiting)
//   capacity     its hold, in tonnes
//   available    tonnes in the home hold it's allowed to take
//                (bonded stock already left out)
//   roundTripMs  one full hub run for this hull
//   freightersOnRuns  how many freighters are on hub runs
//
// The rules, in order:
//   - nothing to take               -> null (wait for goods)
//   - enough to fill it completely  -> now: full loads never wait
//   - enough for the fill rule      -> as soon as staggering allows
//   - some goods, but not enough    -> when the wait runs out,
//                                      and staggering allows
//   e.g. fill 75%, wait 20 min, a 600 t hold:
//        500 t ready -> leaves now (500 is over 450)
//        200 t ready -> leaves 20 minutes after it started waiting
// -------------------------------------------------------------
export function getLeaveTime(state, job, capacity, available, roundTripMs, freightersOnRuns) {
  const rules = state.logistics;
  const waitingSince = job.startedAt;

  // Nothing at all to take: only more goods can change that.
  if (available <= 0) return null;

  // A full hold's worth: go now (staggering is for part loads).
  if (available >= capacity) return waitingSince;

  // Otherwise: when the fill rule or the wait allows...
  const fillMet = available >= capacity * (rules.fillPercent / 100);
  const ruleAllows = fillMet ? waitingSince : waitingSince + rules.waitMinutes * MINUTE;

  // ...but not sooner than one stagger gap after the last departure.
  // (Math.max picks the later of the two times.)
  const gap = getStaggerGapMs(state, roundTripMs, freightersOnRuns);
  const staggerAllows = rules.lastDepartureAt === null ? -Infinity : rules.lastDepartureAt + gap;

  return Math.max(ruleAllows, staggerAllows);
}


// -------------------------------------------------------------
// setLogisticsRule(state, rule, value)
// Changes one of the office's settings, checking the value is one
// the Industry tab offers. Returns { ok, reason }.
//   e.g. setLogisticsRule(state, "fillPercent", 75)
//        setLogisticsRule(state, "stagger", false)
// The new rule counts from the next check, which the engine runs
// straight after any player action.
// -------------------------------------------------------------
export function setLogisticsRule(state, rule, value) {
  if (!hasLogisticsOffice(state)) {
    return { ok: false, reason: "Needs the Logistics office." };
  }
  if (rule === "fillPercent" && LOGISTICS.fillChoices.includes(value)) {
    state.logistics.fillPercent = value;
    return { ok: true };
  }
  if (rule === "waitMinutes" && LOGISTICS.waitChoices.includes(value)) {
    state.logistics.waitMinutes = value;
    return { ok: true };
  }
  if (rule === "stagger" && typeof value === "boolean") {
    state.logistics.stagger = value;
    return { ok: true };
  }
  return { ok: false, reason: "That isn't one of the office's settings." };
}
