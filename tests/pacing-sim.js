// =============================================================
// tests/pacing-sim.js
// -------------------------------------------------------------
// A PACING SIMULATOR: plays the real game engine as a sensible,
// active early-game player, and prints when each Mining level
// and each purchase happens. Used to check the design doc's early
// cadence ("a next goal every 10 to 20 minutes in the first
// hour") and to try balance changes before making them.
//
// Run it with:   node tests/pacing-sim.js
// (or --hours=24 for a whole day, --weeks=4 for a daily report
// over 4 weeks: see the bottom of this file)
//
// There are two pretend players.
//
// The REALISTIC player (the default since 4 Nov) plays the whole
// game as built: freighters, the workshop, station upgrades, parts
// for every hull, and swapping Prospectors for Excavators once
// command points run out. Its habits live in tests/sim-player.js.
//
// The SIMPLE player (run with --simple) is the one the 3 Nov
// balance check used, kept so old and new results can be compared.
// It checks in once a minute and:
//   1. sells all ore at home (no freighters)
//   2. buys the cheapest useful thing it can afford: a Prospector
//      component, another Prospector or an Excavator, or a command
//      upgrade when there's no room for another Prospector
//   3. sends every docked ship to the field with the most Mining
//      XP per hour
// Once the refinery opens it also keeps the refinery smelting
// and sells the metal. No freighters or workshop.
//
// Both hand in contracts, lend ships and refinery slots to them,
// and buy and run a Pathfinder.
// With "explore" on (the default), it buys one Pathfinder as soon
// as it can and keeps it scouting (design doc, Early exploration);
// every finished survey and Exploration level is printed too.
// Surveys are launched by hand (Dan, 31 Oct): the pretend player
// launches each one "surveyDelay" minutes after it opens, to show
// what noticing late costs. Run with --survey-delay=15 to change it
// (the default, 0, is a player who launches the moment it opens).
// Run with "--no-explore" to see the game without it.
// It's simpler than a real player, so treat its times as a guide.
// =============================================================

import { FIELDS, SHIP_UPGRADES, REFINERY, RECIPES, SHIP_TYPES } from "../data/content.js";
import { createNewGame } from "../js/state.js";
import { advanceTo } from "../js/simulation.js";
import { startMiningJob, getJobForShip, getTripPlan } from "../js/jobs.js";
import { sellAll } from "../js/trade.js";
import { ITEMS } from "../data/content.js";
import { getLevel, isFieldUnlocked, canHullWorkField, XP_TABLE } from "../js/skills.js";
import { orderShip, getShipPrice, canBuyShip } from "../js/shipyard.js";
import { countOrdered } from "../js/slipway.js";
import { buyUpgrade, getNextUpgradeCost, canBuyUpgrade } from "../js/command.js";
import { canBuyShipUpgrade, buyShipUpgrade, getPartGrade } from "../js/ship-upgrades.js";
import { setBond } from "../js/bonded.js";
import { setRecipe, getRefineJob, getSlotCount, isRecipeUnlocked } from "../js/refinery.js";
import { getCommandFree } from "../js/command.js";
import { startScoutJob, chooseNextTarget, getTarget, getReadySurveys, launchSurvey } from "../js/exploration.js";
import { canHandIn, handInContract, canCharter, charterShip, getCharter, canLendSlot, lendSlot } from "../js/contracts.js";
const getCharterField = (state, shipId) => getCharter(state, shipId)?.fieldId;
import { CONTRACT_KINDS } from "../data/content.js";
import { startHaulJob } from "../js/jobs.js";
// The realistic player's habits (4 Nov): see tests/sim-player.js
import {
  stockToKeep, sellAtHome, runRefinery, runWorkshop, extraShopping,
  finishSwaps, shipsInSwaps, minerValuePerHour,
  chooseMiningField, rebalanceMiners, wantsFirstCourier,
} from "./sim-player.js";

const MINUTE = 60 * 1000;
const START = 1_000_000_000_000;

// -------------------------------------------------------------
// simulate(hours, untilMiningLevel, hourly)
// Plays up to "hours", stopping early at a Mining level. Returns
// a list of events: { minute, text }. Once the refinery opens,
// the player keeps every slot smelting (iron bars, or nickel bars
// when they can) and sells the metal too.
// "hourly" (optional) is called once an hour with a report:
//   { hour, earned, nextShipPrice, freePoints, blockedBy }
// -------------------------------------------------------------
// "realistic" (true unless --simple) picks which pretend player plays.
// "peek" (optional) is called every minute with (state, minute),
// for one-off checks that need to see inside the game, such as
// what's in the hold. It mustn't change anything.
// "casual" (--casual) makes the realistic player check in three
// times a day instead of every minute (see isCheckedIn).
export function simulate(hours, untilMiningLevel, hourly = null, explore = true, surveyDelay = 0, realistic = true, peek = null, casual = false) {
  const swaps = [];   // swaps waiting for their barges to dock (two small into one bigger)
  const state = createNewGame();
  // A fixed seed, so deep scan finds and contracts come out the same
  // every run and two runs can be compared (each real save has its own).
  state.exploration.seed = 12345;
  state.clock = { realAt: START, gameAt: START, speed: 1 };
  state.simulatedUpTo = START;
  const events = [];
  let lastLevel = 1;
  let lastDiplomacy = 1;
  let lastExploreLevel = 1;
  let scansAtLastLevel = 0;   // deep scans done when the last level came
  let earnedThisHour = 0;   // credits from selling, for the hourly report
  const readySince = {};    // survey -> the minute it was first ready to launch

  for (let minute = 0; minute <= hours * 60; minute++) {
    const now = START + minute * MINUTE;
    const report = advanceTo(state, now);
    if (peek) peek(state, minute);

    // Courier sales at Last Post count as income too (4 Nov)
    for (const result of report.results) {
      if (result.kind === "haul") earnedThisHour += result.credits || 0;
    }

    // Surveys finished since last time (deep scans are routine)
    for (const result of report.results) {
      if (result.kind !== "scout") continue;
      for (const targetId of result.surveys) {
        events.push({ minute, text: `surveyed ${getTarget(targetId).name}`, goal: true });
      }
    }
    // Each Exploration level, with how many deep scans it took
    // since the last level (Dan, 30 Oct: they should rise with the level)
    const exploreLevel = getLevel(state, "exploration");
    for (let l = lastExploreLevel + 1; l <= exploreLevel; l++) {
      const scans = state.exploration.deepScans - scansAtLastLevel;
      events.push({ minute, text: `Exploration ${l} (${scans} deep scan${scans === 1 ? "" : "s"} since level ${l - 1})` });
      scansAtLastLevel = state.exploration.deepScans;
    }
    lastExploreLevel = exploreLevel;

    // Level-ups since last time
    const level = getLevel(state, "mining");
    for (let l = lastLevel + 1; l <= level; l++) {
      events.push({ minute, text: `Mining ${l}` + (l === REFINERY.openAtMiningLevel ? " - REFINERY OPENS" : ""), goal: true });
    }
    lastLevel = level;
    if (level >= untilMiningLevel) break;

    // Diplomacy levels (from finishing contracts)
    const diplomacy = getLevel(state, "diplomacy");
    for (let l = lastDiplomacy + 1; l <= diplomacy; l++) {
      events.push({ minute, text: `Diplomacy ${l}` });
    }
    lastDiplomacy = diplomacy;

    // Once an hour: what the player earned, and what's holding up
    // the next Prospector - credits, or command points?
    if (hourly && minute > 0 && minute % 60 === 0) {
      const check = canBuyShip(state, "prospector");
      hourly({
        hour: minute / 60,
        earned: earnedThisHour,
        nextShipPrice: getShipPrice(state, "prospector"),
        ships: state.ships.length,
        freePoints: getCommandFree(state),
        commandUpgrades: state.commandUpgrades,   // how many of the 10 are bought
        miningXp: state.skills.mining.xp,         // for the long-run report (--weeks)
        // Every skill's XP (added 6 Nov), so the long run can project
        // when each one reaches 99, not just Mining
        xp: {
          refining: state.skills.refining.xp,
          manufacturing: state.skills.manufacturing.xp,
          trade: state.skills.trade.xp,
        },
        credits: state.credits,
        blockedBy: check.ok ? "nothing" : check.reason,
        // Added 4 Nov, so the long run shows every skill and the fleet mix
        levels: {
          refining: getLevel(state, "refining"),
          manufacturing: getLevel(state, "manufacturing"),
          trade: getLevel(state, "trade"),
          exploration: getLevel(state, "exploration"),
        },
        fleet: {
          prospector: state.ships.filter((s) => s.type === "prospector").length,
          excavator: state.ships.filter((s) => s.type === "excavator").length,
          deepCore: state.ships.filter((s) => s.type === "deep_core_barge").length,
          courier: state.ships.filter((s) => s.type === "courier").length,
          hauler: state.ships.filter((s) => s.type === "hauler").length,
        },
      });
      earnedThisHour = 0;
    }

    // The CASUAL player (--casual) only acts while it's checked in:
    // see isCheckedIn below. Between visits the game runs on by
    // itself, exactly as offline progress does in the real game.
    // (The hourly report above still counts every hour.)
    if (casual && !isCheckedIn(minute)) continue;

    // 0. Hand in every contract that's ready (by hand since 30 Oct;
    //    an active player checks the board), deliveries before
    //    their goods are sold
    for (let slot = 0; slot < state.contracts.slots.length; slot++) {
      if (canHandIn(state, slot).ok) {
        const done = handInContract(state, slot, now);
        earnedThisHour += done.credits;
        events.push({ minute, text: `contract: handed in ${done.contract.kindId} (${done.credits.toLocaleString("en-GB")} cr)`, goal: true });
      }
    }

    // 0b. Lend a mining ship to any charter waiting for one. A
    //     sensible player does: it pays 1.4x the ore's home price.
    for (let slot = 0; slot < state.contracts.slots.length; slot++) {
      const contract = state.contracts.slots[slot].contract;
      if (!contract || CONTRACT_KINDS[contract.kindId].kind !== "charter" || contract.shipId) continue;
      const free = state.ships.find((ship) => canCharter(state, slot, ship.id).ok);
      if (free) {
        charterShip(state, slot, free.id);
        events.push({ minute, text: `chartered ${free.name} to the ${FIELDS[contract.fieldId].name} (${contract.amount} t)` });
      }
    }
    // 0c. Lend a refinery slot to any toll smelting contract (the
    //     first free slot; it goes back to its own recipe after)
    for (let slot = 0; slot < state.contracts.slots.length; slot++) {
      const contract = state.contracts.slots[slot].contract;
      if (!contract || CONTRACT_KINDS[contract.kindId].kind !== "toll" || contract.refinerySlot !== null) continue;
      for (let refinerySlot = 0; refinerySlot < 3; refinerySlot++) {
        if (canLendSlot(state, slot, refinerySlot).ok) {
          lendSlot(state, slot, refinerySlot, now);
          events.push({ minute, text: `lent refinery slot ${refinerySlot + 1} for toll smelting (${contract.amount} t)` });
          break;
        }
      }
    }
    for (const result of report.results) {
      // Newly posted contracts (not goals, just so you can see the board)
      if (result.kind === "posted") {
        const c = result.contract;
        events.push({ minute, text: `  posted: ${c.kindId} ${c.itemId || c.targetId || ""} ${c.amount}` });
      }
    }

    // 1. Sell everything at home
    //    ...except goods an open delivery contract asks for: a
    //    sensible player holds those back until there's enough
    //    (they pay 1.5x selling at home).
    const wanted = new Set();
    for (const slot of state.contracts.slots) {
      const c = slot.contract;
      if (c && CONTRACT_KINDS[c.kindId].kind === "deliver") wanted.add(c.itemId);
    }
    //    ...and the metal its next Prospector component costs
    //    (Mk II is paid in bars since 1 Nov). It BONDS that much,
    //    the game's own way to keep stock from being sold, starting
    //    one Mining level before the part unlocks so the bars are
    //    ready on time. Everything above the bond still sells.
    // (The realistic player saves for every hull's parts and the
    // station upgrades too, and leaves freighters a load: see
    // stockToKeep and sellAtHome in sim-player.js. Then it skips
    // the simple player's selling and smelting below.)
    if (realistic) {
      const saving = stockToKeep(state);
      earnedThisHour += sellAtHome(state, saving, wanted);
      for (const line of runRefinery(state, saving, now)) events.push({ minute, text: line });
      for (const line of runWorkshop(state, saving, now, casual)) events.push({ minute, text: line });
    }

    const keep = {};                 // item -> tonnes to hold back
    for (const part of ["drill", "hold", "drive"]) {
      if (realistic) break;          // the realistic player did its own above
      const next = SHIP_UPGRADES[`prospector_${part}_${getPartGrade(state, "prospector", part) + 1}`];
      if (!next || getLevel(state, "mining") < next.level - 1) continue;
      for (const [item, tonnes] of Object.entries(next.costs)) {
        keep[item] = (keep[item] || 0) + tonnes;
      }
    }
    if (!realistic) {
      for (const itemId of Object.keys(RECIPES)) {   // the metal bars
        setBond(state, itemId, keep[itemId] || 0);
      }
      for (const itemId of Object.keys(ITEMS)) {
        if (!wanted.has(itemId)) earnedThisHour += sellAll(state, itemId).credits;
      }
    }

    // 1b. Keep every refinery slot smelting (once it's open).
    //     Normally slot 1 makes iron bars and slot 2 nickel. But
    //     while the next component needs nickel bars the player
    //     hasn't got (Prospector hold Mk II, since 1 Nov), slot 1
    //     switches to nickel until there's enough, then back.
    const needNickel = (keep.nickel_bar || 0) > (state.inventory.nickel_bar || 0) &&
      isRecipeUnlocked(state, "nickel_bar") && isFieldUnlocked(state, "outer_belt");
    for (let slot = 0; slot < getSlotCount(state) && !realistic; slot++) {
      const current = getRefineJob(state, slot);
      let recipe = isRecipeUnlocked(state, "nickel_bar") && isFieldUnlocked(state, "outer_belt") && slot % 2 === 1
        ? "nickel_bar" : "iron_bar";
      if (slot === 0 && needNickel) recipe = "nickel_bar";
      if (current && (current.recipeId === recipe || current.toll !== undefined)) continue;
      if (setRecipe(state, slot, recipe, now)) {
        events.push({ minute, text: `refinery slot ${slot + 1} set to ${RECIPES[recipe].name.toLowerCase()}` });
      }
    }


    // 2. Buy the cheapest useful thing, repeatedly, while affordable
    //    (the realistic player first finishes any Excavator swap
    //    whose Prospectors are home)
    if (realistic) {
      for (const line of finishSwaps(state, swaps, now)) events.push({ minute, text: line, goal: true });
    }
    // While a swap's Prospectors fly home, the player saves for
    // the Excavator and buys nothing else (found 4 Nov: otherwise
    // the money went on parts and the Excavator wasn't affordable
    // when they landed).
    for (; !(realistic && swaps.length > 0);) {
      const options = realistic ? extraShopping(state, now, swaps) : [];
      for (const id of Object.keys(SHIP_UPGRADES)) {
        if (SHIP_UPGRADES[id].hull === "prospector" && canBuyShipUpgrade(state, id).ok) {
          options.push({ cost: SHIP_UPGRADES[id].credits, buy: () => buyShipUpgrade(state, id), text: "component " + id });
        }
      }
      // An Excavator (Mining 10) once it's affordable: twice the
      // command points of a Prospector, but more ore per point.
      // The realistic player prefers a Deep-core barge (Mining 30,
      // 4 points) once it earns more per point than an Excavator
      // (added 4 Nov), and stops buying Excavators then.
      const barge = "deep_core_barge";
      const bargesBetter = realistic && getLevel(state, "mining") >= SHIP_TYPES[barge].unlockLevel &&
        minerValuePerHour(state, barge) / 4 > minerValuePerHour(state, "excavator") / 2;
      if (bargesBetter && canBuyShip(state, barge).ok) {
        options.push({ cost: getShipPrice(state, barge), buy: () => orderShip(state, barge, now), text: "Deep-core barge" });
      }
      if (!bargesBetter && canBuyShip(state, "excavator").ok) {
        options.push({ cost: getShipPrice(state, "excavator"), buy: () => orderShip(state, "excavator", now), text: "Excavator" });
      }
      // The realistic player stops buying Prospectors once an
      // Excavator earns more per command point (2 points) than a
      // Prospector (1); before that, cheap Prospectors still win.
      const excavatorsBetter = realistic &&
        getLevel(state, "mining") >= SHIP_TYPES.excavator.unlockLevel &&
        minerValuePerHour(state, "excavator") / 2 > minerValuePerHour(state, "prospector");
      if (bargesBetter && getCommandFree(state) < 4 && canBuyUpgrade(state).ok) {
        options.push({ cost: getNextUpgradeCost(state), buy: () => buyUpgrade(state), text: "command upgrade" });
      } else if (bargesBetter) {
        // (no Prospectors on the list)
      } else if (excavatorsBetter && getCommandFree(state) < 2 && canBuyUpgrade(state).ok) {
        // Out of points with no Prospector to buy: a command upgrade
        // makes room for the next Excavator.
        options.push({ cost: getNextUpgradeCost(state), buy: () => buyUpgrade(state), text: "command upgrade" });
      } else if (excavatorsBetter) {
        // (no Prospectors on the list)
      } else if (realistic && wantsFirstCourier(state) && getCommandFree(state) <= 1) {
        // (no Prospector: the last free command point is kept for
        // the first Courier, see wantsFirstCourier in sim-player.js)
      } else if (canBuyShip(state, "prospector").ok) {
        options.push({ cost: getShipPrice(state, "prospector"), buy: () => orderShip(state, "prospector", now), text: "Prospector #" + (state.ships.filter((s) => s.type === "prospector").length + countOrdered(state, "prospector") + 1) });
      } else if (canBuyShip(state, "prospector").reason === "Not enough command points" && canBuyUpgrade(state).ok) {
        options.push({ cost: getNextUpgradeCost(state), buy: () => buyUpgrade(state), text: "command upgrade" });
      }
      // Pathfinder components, once there's a Pathfinder
      for (const id of Object.keys(SHIP_UPGRADES)) {
        if (explore && SHIP_UPGRADES[id].hull === "pathfinder" && canBuyShipUpgrade(state, id).ok &&
            state.ships.some((ship) => ship.type === "pathfinder")) {
          options.push({ cost: SHIP_UPGRADES[id].credits, buy: () => buyShipUpgrade(state, id), text: "component " + id });
        }
      }
      // One Pathfinder, as soon as it's for sale and affordable
      // (one on the slipway counts: it's on its way)
      const hasScout = state.ships.some((ship) => ship.type === "pathfinder") || countOrdered(state, "pathfinder") > 0;
      if (explore && !hasScout && canBuyShip(state, "pathfinder").ok) {
        options.push({ cost: getShipPrice(state, "pathfinder"), buy: () => orderShip(state, "pathfinder", now), text: "Pathfinder" });
      }
      if (options.length === 0) break;
      options.sort((a, b) => a.cost - b.cost);
      options[0].buy();
      events.push({ minute, text: `bought ${options[0].text} (${options[0].cost.toLocaleString("en-GB")} cr)`, goal: true });
    }

    // 2b. Launch surveys that have been ready for surveyDelay minutes
    //     (a docked scout picks one up in step 3; one out deep
    //     scanning picks it up when its current scan ends).
    for (const targetId of getReadySurveys(state)) {
      if (readySince[targetId] === undefined) readySince[targetId] = minute;
      if (minute - readySince[targetId] >= surveyDelay) {
        launchSurvey(state, targetId);
        events.push({ minute, text: `launched survey: ${getTarget(targetId).name}` });
      }
    }

    // 3. Send docked ships to the best field for Mining XP per hour
    //    (the realistic player sends one for iron ore instead when
    //    the refinery runs short, recalling a barge if need be:
    //    see chooseMiningField and rebalanceMiners in sim-player.js)
    if (realistic) {
      for (const line of rebalanceMiners(state, now)) events.push({ minute, text: line });
    }
    const waitingToBeSold = shipsInSwaps(swaps);   // recalled for an Excavator swap
    for (const ship of state.ships) {
      if (getJobForShip(state, ship.id)) continue;
      if (waitingToBeSold.has(ship.id)) continue;   // stays docked to be sold
      // A docked Courier starts its run to Last Post (it repeats by itself)
      if (SHIP_TYPES[ship.type].role === "freight") {
        startHaulJob(state, ship.id, now);
        continue;
      }
      // A docked scout goes to the next target (it moves on by itself after that)
      if (ship.type === "pathfinder") {
        startScoutJob(state, ship.id, chooseNextTarget(state, ship.id), now);
        continue;
      }
      let best = null;
      for (const fieldId of Object.keys(FIELDS)) {
        if (!isFieldUnlocked(state, fieldId)) continue;
        if (!canHullWorkField(ship.type, fieldId)) continue;   // hull rules (4 Nov)
        const plan = getTripPlan(state, ship.type, fieldId);
        const xpPerHour = plan.xpPerTrip / plan.durationMs;
        if (!best || xpPerHour > best.xpPerHour) best = { fieldId, xpPerHour };
      }
      const field = realistic ? chooseMiningField(state, ship) : best.fieldId;
      // (A chartered ship goes where its charter says: jobs.js picks the field.)
      startMiningJob(state, ship.id, ship.destination && getCharterField(state, ship.id) ? ship.destination : field, now);
    }
  }
  return events;
}

// -------------------------------------------------------------
// isCheckedIn(minute)
// When the CASUAL player is at the game (added 4 Nov). Its first
// session is 2 hours of active play, like any new player. After
// that it checks in three times a day for 10 minutes: morning
// (8:00), lunch (13:00) and evening (20:00), taking the game's
// start as 8:00 on day 1. The overnight gap is 12 hours, past
// nothing (the offline cap is 24 hours).
//   e.g. minute 0 to 120: playing; minute 300 (13:00): playing;
//        minute 400: away
// -------------------------------------------------------------
const FIRST_SESSION_MINUTES = 120;
const VISIT_MINUTES = 10;
const VISITS = [8 * 60, 13 * 60, 20 * 60];   // times of day, in minutes after midnight
const START_TIME_OF_DAY = 8 * 60;             // the game starts at 8:00

function isCheckedIn(minute) {
  if (minute <= FIRST_SESSION_MINUTES) return true;
  const timeOfDay = (minute + START_TIME_OF_DAY) % (24 * 60);
  return VISITS.some((visit) => timeOfDay >= visit && timeOfDay < visit + VISIT_MINUTES);
}

// When this file is run directly (not imported), print a timeline.
// Also prints the gaps between GOALS (purchases, Mining levels and
// surveys): the design doc wants a next goal every 10 to 20 minutes
// in the first hour, and roughly every hour in the first day.
//
// Three ways to run it (added 3 Nov for the early-game balance check):
//   node tests/pacing-sim.js              up to the refinery (Mining 8), as before
//   node tests/pacing-sim.js --hours=24   a whole first day: no stop at Mining 8
//   node tests/pacing-sim.js --weeks=4    one line per day for 4 weeks, then
//                                         when Mining 99 would land
// --survey-delay=15 and --no-explore work with all three.
if (import.meta.url === `file://${process.argv[1]}`) {
  // Reads a "--name=value" option as a number, or null if it isn't there
  const option = (name) => {
    const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
    return arg ? Number(arg.split("=")[1]) : null;
  };
  const explore = !process.argv.includes("--no-explore");
  // e.g. --survey-delay=15: launch each survey 15 minutes after it opens
  const surveyDelay = option("survey-delay") ?? 0;
  const weeks = option("weeks");
  const hours = option("hours");
  // --simple: the 3 Nov pretend player, for comparing with old runs
  const realistic = !process.argv.includes("--simple");
  // --casual: the realistic player, checking in three times a day
  const casual = process.argv.includes("--casual");
  console.log(casual ? "Casual player: active first 2 hours, then 3 visits a day\n"
    : realistic ? "Realistic player, checking in every minute (--casual for 3 visits a day, --simple for the 3 Nov player)\n"
    : "Simple player (3 Nov)\n");

  if (weeks) {
    printWeeks(weeks, explore, surveyDelay, realistic, casual);
  } else if (hours) {
    // A level above 99 never comes, so the run doesn't stop early
    printTimeline(simulate(hours, Infinity, null, explore, surveyDelay, realistic, null, casual));
  } else {
    printTimeline(simulate(4, REFINERY.openAtMiningLevel, null, explore, surveyDelay, realistic, null, casual));
  }
}

// Formats a minute count as 2h05
function hoursAndMinutes(minute) {
  return `${Math.floor(minute / 60)}h${String(minute % 60).padStart(2, "0")}`;
}

// -------------------------------------------------------------
// printTimeline(events)
// Prints every event, then the longest wait for a next goal in
// each hour. An hour with no goal at all counts the wait still
// running at the end of that hour (it used to show 0, which only
// mattered once runs went past the busy first hours).
// -------------------------------------------------------------
function printTimeline(events) {
  for (const e of events) {
    console.log(`${hoursAndMinutes(e.minute)}  ${e.text}`);
  }
  const goals = events.filter((e) => e.goal).map((e) => e.minute);
  const end = events[events.length - 1].minute;
  console.log("\nLongest wait between goals:");
  for (let hour = 0; hour * 60 < end; hour++) {
    const hourStart = hour * 60;
    const hourEnd = hourStart + 60;
    let previous = goals.filter((m) => m < hourStart).pop() ?? 0;   // last goal before this hour
    const inHour = goals.filter((m) => m >= hourStart && m < hourEnd);
    let longest = 0;
    for (const m of inHour) {
      longest = Math.max(longest, m - previous);
      previous = m;
    }
    if (inHour.length === 0) longest = Math.min(hourEnd, end) - previous;   // still waiting
    console.log(`  hour ${hour + 1}: ${longest} min`);
  }
}

// -------------------------------------------------------------
// printWeeks(weeks, explore, surveyDelay)
// The long view: plays "weeks" weeks and prints one line per day,
// so price curves and the Mining XP rate can be checked against
// the design doc's targets (Mining 99 after about 20 weeks).
// The pretend player checks in every minute; offline progress is
// exact, so a player who checks in daily gets close to this, a
// little later. It doesn't use freighters or the workshop yet.
// -------------------------------------------------------------
function printWeeks(weeks, explore, surveyDelay, realistic, casual) {
  const days = [];    // the hourly report at the end of each day
  simulate(weeks * 7 * 24, Infinity, (report) => {
    if (report.hour % 24 === 0) days.push(report);
  }, explore, surveyDelay, realistic, null, casual);

  // XP total -> level, by walking up the XP table
  const levelFor = (xp) => {
    let level = 1;
    while (XP_TABLE[level + 1] !== undefined && xp >= XP_TABLE[level + 1]) level++;
    return level;
  };
  const cr = (n) => Math.round(n).toLocaleString("en-GB");

  // One line per day. Skill columns: Min(ing), Ref(ining),
  // Mfg (Manufacturing), Trd (Trade), Exp(loration).
  // Fleet: Prospectors / Excavators / Deep-core barges / Couriers.
  // cr per hour is the last hour of that day: sales at Anvil,
  // Courier sales at Last Post, and contracts.
  console.log("day | Min Ref Mfg Trd Exp | cr per hour | fleet P/E/D/C/H | cmd upg | credits banked");
  for (const d of days) {
    const lv = (n) => String(n).padStart(3);
    console.log(`${String(d.hour / 24).padStart(3)} | ${lv(levelFor(d.miningXp))} ${lv(d.levels.refining)} ` +
      `${lv(d.levels.manufacturing)} ${lv(d.levels.trade)} ${lv(d.levels.exploration)} | ` +
      `${cr(d.earned).padStart(11)} | ${`${d.fleet.prospector}/${d.fleet.excavator}/${d.fleet.deepCore}/${d.fleet.courier}/${d.fleet.hauler}`.padStart(15)} | ` +
      `${String(d.commandUpgrades).padStart(7)} | ${cr(d.credits).padStart(14)}`);
  }

  // When would Mining 99 land? Take the Mining XP earned per day over
  // the second half of the run and carry it on in a straight line.
  // (Real XP per day usually keeps rising slowly, so treat this as
  // the latest it would land with today's content.)
  const last = days[days.length - 1];
  const middle = days[Math.floor(days.length / 2) - 1];
  const perDay = (last.miningXp - middle.miningXp) / (days.length - Math.floor(days.length / 2));
  const daysTo99 = days.length + Math.max(0, XP_TABLE[99] - last.miningXp) / perDay;
  console.log(`\nMining XP per day over the second half: ${cr(perDay)}`);
  console.log(`Mining 99 would land on about day ${Math.round(daysTo99)} (week ${(daysTo99 / 7).toFixed(1)})`);

  // The same straight-line projection for the skills that follow
  // Mining in the agreed order (added 6 Nov for the precision parts
  // check): Refining about 2 weeks after Mining, Manufacturing about
  // 4, Trade about 6.
  //   e.g. 20M XP still to go at 1M XP a day -> 20 more days
  const halfDays = days.length - Math.floor(days.length / 2);
  for (const skillId of ["refining", "manufacturing", "trade"]) {
    const skillPerDay = (last.xp[skillId] - middle.xp[skillId]) / halfDays;
    const skillDays = days.length + Math.max(0, XP_TABLE[99] - last.xp[skillId]) / skillPerDay;
    const name = skillId[0].toUpperCase() + skillId.slice(1);
    console.log(`${name} 99 would land on about day ${Math.round(skillDays)} (week ${(skillDays / 7).toFixed(1)})`);
  }
}
