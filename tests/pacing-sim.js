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
// The pretend player checks in once a minute and:
//   1. sells all ore at home (no freighters this early)
//   2. buys the cheapest useful thing it can afford: a ship
//      component, another Prospector or an Excavator, or a command
//      upgrade when there's no room for another Prospector
//   3. sends every docked ship to the field with the most Mining
//      XP per hour
// Once the refinery opens it also keeps the refinery smelting
// and sells the metal. No freighters or workshop yet.
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

import { FIELDS, SHIP_UPGRADES, REFINERY, RECIPES } from "../data/content.js";
import { createNewGame } from "../js/state.js";
import { advanceTo } from "../js/simulation.js";
import { startMiningJob, getJobForShip, getTripPlan } from "../js/jobs.js";
import { sellAll } from "../js/trade.js";
import { ITEMS } from "../data/content.js";
import { getLevel, isFieldUnlocked, XP_TABLE } from "../js/skills.js";
import { buyShip, getShipPrice, canBuyShip } from "../js/shipyard.js";
import { buyUpgrade, getNextUpgradeCost, canBuyUpgrade } from "../js/command.js";
import { canBuyShipUpgrade, buyShipUpgrade, getPartGrade } from "../js/ship-upgrades.js";
import { setBond } from "../js/bonded.js";
import { setRecipe, getRefineJob, getSlotCount, isRecipeUnlocked } from "../js/refinery.js";
import { getCommandFree } from "../js/command.js";
import { startScoutJob, chooseNextTarget, getTarget, getReadySurveys, launchSurvey } from "../js/exploration.js";
import { canHandIn, handInContract, canCharter, charterShip, getCharter, canLendSlot, lendSlot } from "../js/contracts.js";
const getCharterField = (state, shipId) => getCharter(state, shipId)?.fieldId;
import { CONTRACT_KINDS } from "../data/content.js";

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
export function simulate(hours, untilMiningLevel, hourly = null, explore = true, surveyDelay = 0) {
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
    const keep = {};                 // item -> tonnes to hold back
    for (const part of ["drill", "hold", "drive"]) {
      const next = SHIP_UPGRADES[`prospector_${part}_${getPartGrade(state, "prospector", part) + 1}`];
      if (!next || getLevel(state, "mining") < next.level - 1) continue;
      for (const [item, tonnes] of Object.entries(next.costs)) {
        keep[item] = (keep[item] || 0) + tonnes;
      }
    }
    for (const itemId of Object.keys(RECIPES)) {   // the metal bars
      setBond(state, itemId, keep[itemId] || 0);
    }
    for (const itemId of Object.keys(ITEMS)) {
      if (!wanted.has(itemId)) earnedThisHour += sellAll(state, itemId).credits;
    }

    // 1b. Keep every refinery slot smelting (once it's open).
    //     Normally slot 1 makes iron bars and slot 2 nickel. But
    //     while the next component needs nickel bars the player
    //     hasn't got (Prospector hold Mk II, since 1 Nov), slot 1
    //     switches to nickel until there's enough, then back.
    const needNickel = (keep.nickel_bar || 0) > (state.inventory.nickel_bar || 0) &&
      isRecipeUnlocked(state, "nickel_bar") && isFieldUnlocked(state, "outer_belt");
    for (let slot = 0; slot < getSlotCount(state); slot++) {
      const current = getRefineJob(state, slot);
      let recipe = isRecipeUnlocked(state, "nickel_bar") && isFieldUnlocked(state, "outer_belt") && slot % 2 === 1
        ? "nickel_bar" : "iron_bar";
      if (slot === 0 && needNickel) recipe = "nickel_bar";
      if (current && (current.recipeId === recipe || current.toll !== undefined)) continue;
      if (setRecipe(state, slot, recipe, now)) {
        events.push({ minute, text: `refinery slot ${slot + 1} set to ${RECIPES[recipe].name.toLowerCase()}` });
      }
    }

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
        credits: state.credits,
        blockedBy: check.ok ? "nothing" : check.reason,
      });
      earnedThisHour = 0;
    }

    // 2. Buy the cheapest useful thing, repeatedly, while affordable
    for (;;) {
      const options = [];
      for (const id of Object.keys(SHIP_UPGRADES)) {
        if (SHIP_UPGRADES[id].hull === "prospector" && canBuyShipUpgrade(state, id).ok) {
          options.push({ cost: SHIP_UPGRADES[id].credits, buy: () => buyShipUpgrade(state, id), text: "component " + id });
        }
      }
      // An Excavator (Mining 10) once it's affordable: twice the
      // command points of a Prospector, but more ore per point.
      if (canBuyShip(state, "excavator").ok) {
        options.push({ cost: getShipPrice(state, "excavator"), buy: () => buyShip(state, "excavator"), text: "Excavator" });
      }
      if (canBuyShip(state, "prospector").ok) {
        options.push({ cost: getShipPrice(state, "prospector"), buy: () => buyShip(state, "prospector"), text: "Prospector #" + (state.ships.filter((s) => s.type === "prospector").length + 1) });
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
      const hasScout = state.ships.some((ship) => ship.type === "pathfinder");
      if (explore && !hasScout && canBuyShip(state, "pathfinder").ok) {
        options.push({ cost: getShipPrice(state, "pathfinder"), buy: () => buyShip(state, "pathfinder"), text: "Pathfinder" });
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
    for (const ship of state.ships) {
      if (getJobForShip(state, ship.id)) continue;
      // A docked scout goes to the next target (it moves on by itself after that)
      if (ship.type === "pathfinder") {
        startScoutJob(state, ship.id, chooseNextTarget(state, ship.id), now);
        continue;
      }
      let best = null;
      for (const fieldId of Object.keys(FIELDS)) {
        if (!isFieldUnlocked(state, fieldId)) continue;
        const plan = getTripPlan(state, ship.type, fieldId);
        const xpPerHour = plan.xpPerTrip / plan.durationMs;
        if (!best || xpPerHour > best.xpPerHour) best = { fieldId, xpPerHour };
      }
      // (A chartered ship goes where its charter says: jobs.js picks the field.)
      startMiningJob(state, ship.id, ship.destination && getCharterField(state, ship.id) ? ship.destination : best.fieldId, now);
    }
  }
  return events;
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

  if (weeks) {
    printWeeks(weeks, explore, surveyDelay);
  } else if (hours) {
    // A level above 99 never comes, so the run doesn't stop early
    printTimeline(simulate(hours, Infinity, null, explore, surveyDelay));
  } else {
    printTimeline(simulate(4, REFINERY.openAtMiningLevel, null, explore, surveyDelay));
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
function printWeeks(weeks, explore, surveyDelay) {
  const days = [];    // the hourly report at the end of each day
  simulate(weeks * 7 * 24, Infinity, (report) => {
    if (report.hour % 24 === 0) days.push(report);
  }, explore, surveyDelay);

  // XP total -> level, by walking up the XP table
  const levelFor = (xp) => {
    let level = 1;
    while (XP_TABLE[level + 1] !== undefined && xp >= XP_TABLE[level + 1]) level++;
    return level;
  };
  const cr = (n) => Math.round(n).toLocaleString("en-GB");

  console.log("day | Mining | cr per hour | ships | command upgrades | credits banked | next Prospector");
  for (const d of days) {
    console.log(`${String(d.hour / 24).padStart(3)} | ${String(levelFor(d.miningXp)).padStart(6)} | ` +
      `${cr(d.earned).padStart(11)} | ${String(d.ships).padStart(5)} | ${String(d.commandUpgrades).padStart(16)} | ` +
      `${cr(d.credits).padStart(14)} | ${cr(d.nextShipPrice)}`);
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
}
