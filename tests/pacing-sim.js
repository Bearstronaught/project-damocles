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
// Run with "--no-explore" to see the game without it.
// It's simpler than a real player, so treat its times as a guide.
// =============================================================

import { FIELDS, SHIP_UPGRADES, REFINERY, RECIPES } from "../data/content.js";
import { createNewGame } from "../js/state.js";
import { advanceTo } from "../js/simulation.js";
import { startMiningJob, getJobForShip, getTripPlan } from "../js/jobs.js";
import { sellAll } from "../js/trade.js";
import { ITEMS } from "../data/content.js";
import { getLevel, isFieldUnlocked } from "../js/skills.js";
import { buyShip, getShipPrice, canBuyShip } from "../js/shipyard.js";
import { buyUpgrade, getNextUpgradeCost, canBuyUpgrade } from "../js/command.js";
import { canBuyShipUpgrade, buyShipUpgrade } from "../js/ship-upgrades.js";
import { setRecipe, getRefineJob, getSlotCount, isRecipeUnlocked } from "../js/refinery.js";
import { getCommandFree } from "../js/command.js";
import { startScoutJob, chooseNextTarget, getTarget } from "../js/exploration.js";
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
export function simulate(hours, untilMiningLevel, hourly = null, explore = true) {
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
    for (const itemId of Object.keys(ITEMS)) {
      if (!wanted.has(itemId)) earnedThisHour += sellAll(state, itemId).credits;
    }

    // 1b. Keep every refinery slot smelting (once it's open)
    for (let slot = 0; slot < getSlotCount(state); slot++) {
      if (getRefineJob(state, slot)) continue;
      const recipe = isRecipeUnlocked(state, "nickel_bar") && isFieldUnlocked(state, "outer_belt") && slot % 2 === 1
        ? "nickel_bar" : "iron_bar";
      setRecipe(state, slot, recipe, now);
      events.push({ minute, text: `refinery slot ${slot + 1} set to ${RECIPES[recipe].name.toLowerCase()}` });
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
if (import.meta.url === `file://${process.argv[1]}`) {
  const explore = !process.argv.includes("--no-explore");
  const events = simulate(4, REFINERY.openAtMiningLevel, null, explore);
  const time = (minute) => `${Math.floor(minute / 60)}h${String(minute % 60).padStart(2, "0")}`;
  for (const e of events) {
    console.log(`${time(e.minute)}  ${e.text}`);
  }

  // The longest wait for a next goal in each hour
  const goals = events.filter((e) => e.goal).map((e) => e.minute);
  const end = events[events.length - 1].minute;
  console.log("\nLongest wait between goals:");
  for (let hour = 0; hour * 60 < end; hour++) {
    let longest = 0;
    let previous = goals.filter((m) => m < hour * 60).pop() ?? 0;
    for (const m of goals.filter((m) => m >= hour * 60 && m < hour * 60 + 60)) {
      longest = Math.max(longest, m - previous);
      previous = m;
    }
    console.log(`  hour ${hour + 1}: ${longest} min`);
  }
}
