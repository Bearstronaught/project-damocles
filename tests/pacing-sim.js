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
//      component, another Prospector, or a command upgrade when
//      there's no room for another ship
//   3. sends every docked ship to the field with the most Mining
//      XP per hour
// It's simpler than a real player, so treat its times as a guide.
// =============================================================

import { FIELDS, SHIP_UPGRADES, REFINERY } from "../data/content.js";
import { createNewGame } from "../js/state.js";
import { advanceTo } from "../js/simulation.js";
import { startMiningJob, getJobForShip, getTripPlan } from "../js/jobs.js";
import { sellEverything } from "../js/trade.js";
import { getLevel, isFieldUnlocked } from "../js/skills.js";
import { buyShip, getShipPrice, canBuyShip } from "../js/shipyard.js";
import { buyUpgrade, getNextUpgradeCost, canBuyUpgrade } from "../js/command.js";
import { canBuyShipUpgrade, buyShipUpgrade } from "../js/ship-upgrades.js";

const MINUTE = 60 * 1000;
const START = 1_000_000_000_000;

// -------------------------------------------------------------
// simulate(hours, untilMiningLevel)
// Plays up to "hours", stopping early at a Mining level. Returns
// a list of events: { minute, text }.
// -------------------------------------------------------------
export function simulate(hours, untilMiningLevel) {
  const state = createNewGame();
  state.clock = { realAt: START, gameAt: START, speed: 1 };
  state.simulatedUpTo = START;
  const events = [];
  let lastLevel = 1;

  for (let minute = 0; minute <= hours * 60; minute++) {
    const now = START + minute * MINUTE;
    advanceTo(state, now);

    // Level-ups since last time
    const level = getLevel(state, "mining");
    for (let l = lastLevel + 1; l <= level; l++) {
      events.push({ minute, text: `Mining ${l}` + (l === REFINERY.openAtMiningLevel ? " - REFINERY OPENS" : "") });
    }
    lastLevel = level;
    if (level >= untilMiningLevel) break;

    // 1. Sell everything at home
    sellEverything(state);

    // 2. Buy the cheapest useful thing, repeatedly, while affordable
    for (;;) {
      const options = [];
      for (const id of Object.keys(SHIP_UPGRADES)) {
        if (SHIP_UPGRADES[id].hull === "prospector" && canBuyShipUpgrade(state, id).ok) {
          options.push({ cost: SHIP_UPGRADES[id].credits, buy: () => buyShipUpgrade(state, id), text: "component " + id });
        }
      }
      if (canBuyShip(state, "prospector").ok) {
        options.push({ cost: getShipPrice(state, "prospector"), buy: () => buyShip(state, "prospector"), text: "Prospector #" + (state.ships.length + 1) });
      } else if (canBuyShip(state, "prospector").reason === "Not enough command points" && canBuyUpgrade(state).ok) {
        options.push({ cost: getNextUpgradeCost(state), buy: () => buyUpgrade(state), text: "command upgrade" });
      }
      if (options.length === 0) break;
      options.sort((a, b) => a.cost - b.cost);
      options[0].buy();
      events.push({ minute, text: `bought ${options[0].text} (${options[0].cost.toLocaleString("en-GB")} cr)` });
    }

    // 3. Send docked ships to the best field for Mining XP per hour
    for (const ship of state.ships) {
      if (getJobForShip(state, ship.id)) continue;
      let best = null;
      for (const fieldId of Object.keys(FIELDS)) {
        if (!isFieldUnlocked(state, fieldId)) continue;
        const plan = getTripPlan(state, ship.type, fieldId);
        const xpPerHour = plan.xpPerTrip / plan.durationMs;
        if (!best || xpPerHour > best.xpPerHour) best = { fieldId, xpPerHour };
      }
      startMiningJob(state, ship.id, best.fieldId, now);
    }
  }
  return events;
}

// When this file is run directly (not imported), print a timeline.
if (import.meta.url === `file://${process.argv[1]}`) {
  const events = simulate(4, REFINERY.openAtMiningLevel);
  for (const e of events) {
    const h = Math.floor(e.minute / 60);
    const m = String(e.minute % 60).padStart(2, "0");
    console.log(`${h}h${m}  ${e.text}`);
  }
}
