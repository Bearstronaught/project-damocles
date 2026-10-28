// =============================================================
// js/main.js
// -------------------------------------------------------------
// THE STARTING POINT. index.html loads this file, and this file
// pulls in everything else.
//
// What happens, in order:
//   1. Load the save (or start a new game).
//   2. Set up the screen.
//   3. Catch up on any time the player was away.
//   4. Start the "game loop" - a timer that, several times a
//      second, finishes due jobs and redraws the screen.
//   5. Start autosaving.
// =============================================================

import { RULES, ITEMS, FIELDS, SHIP_TYPES, SKILLS } from "../data/content.js";
import { createNewGame, findShip } from "./state.js";
import { startMiningJob, cancelJob, getJobForShip, processJobs } from "./jobs.js";
import { sellAll, sellEverything } from "./trade.js";
import { buyShip, sellShip } from "./shipyard.js";
import { buyUpgrade, getCommandCapacity } from "./command.js";
import { getUnlocksAtLevel, getFieldUnlocksAtLevel, isFieldUnlocked } from "./skills.js";
import { saveGame, loadGame, deleteSave, applyOfflineProgress } from "./save.js";
import { setupUI, buildFleetViews, render, addLog, formatNumber, formatXp, formatDuration } from "./ui.js";


// -------------------------------------------------------------
// 1. Load the save, or start fresh.
// -------------------------------------------------------------
// "let" (not "const") because Reset replaces it with a new game.
let state = loadGame();
const isNewGame = state === null;

if (isNewGame) {
  state = createNewGame();
}


// -------------------------------------------------------------
// The actions: everything the player can DO.
// The screen (ui.js) calls these when buttons are clicked.
// -------------------------------------------------------------
const actions = {
  // ui.js asks for the current state through this, so it
  // always gets the latest one (even after a Reset).
  getState() {
    return state;
  },

  setDestination(shipId, fieldId) {
    const ship = findShip(state, shipId);
    // Only docked ships can change course, and only to fields
    // that are unlocked. (The buttons are disabled otherwise,
    // but checking here too means the rule can't be skipped.)
    if (!ship || getJobForShip(state, shipId) || !isFieldUnlocked(state, fieldId)) {
      return;
    }
    ship.destination = fieldId;
    refresh();
  },

  dispatchShip(shipId) {
    const ship = findShip(state, shipId);
    const job = startMiningJob(state, shipId, ship.destination, Date.now());
    if (job) {
      addLog(`${ship.name} departs for ${FIELDS[ship.destination].name}.`, "fleet");
    }
    refresh();
  },

  recallShip(shipId) {
    const job = getJobForShip(state, shipId);
    if (job) {
      cancelJob(state, job.id);
      addLog(`${findShip(state, shipId).name} recalled. Partial cargo dumped.`, "fleet");
    }
    refresh();
  },

  sellItem(itemId) {
    // sale = { credits, xp, newLevels } (see trade.js)
    const sale = sellAll(state, itemId);
    if (sale.credits > 0) {
      addLog(`Sold ${ITEMS[itemId].name.toLowerCase()} at the home dock for ${formatNumber(sale.credits)} cr (+${formatXp(sale.xp)} Trade XP).`, "trade");
      logLevelUps("trade", sale.newLevels);
    }
    refresh();
  },

  sellCargo() {
    const sale = sellEverything(state);
    if (sale.credits > 0) {
      addLog(`Sold the whole hold at the home dock for ${formatNumber(sale.credits)} cr (+${formatXp(sale.xp)} Trade XP).`, "trade");
      logLevelUps("trade", sale.newLevels);
    }
    refresh();
  },

  buyShip(shipTypeId) {
    const ship = buyShip(state, shipTypeId);
    if (ship) {
      // The fleet changed, so rebuild the ship cards.
      buildFleetViews(state, actions);
      addLog(`${ship.name} (${SHIP_TYPES[ship.type].name}) joins the fleet. Docked at home, awaiting orders.`, "fleet");
    }
    refresh();
  },

  sellShip(shipId) {
    const ship = findShip(state, shipId);
    const earned = sellShip(state, shipId);
    if (earned > 0) {
      buildFleetViews(state, actions);
      addLog(`${ship.name} sold for ${formatNumber(earned)} cr.`, "fleet");
    }
    refresh();
  },

  buyCommandUpgrade() {
    const gained = buyUpgrade(state);
    if (gained > 0) {
      addLog(`Fleet command expanded: +${gained} points (now ${getCommandCapacity(state)}).`, "fleet");
    }
    refresh();
  },

  resetGame() {
    deleteSave();
    state = createNewGame();
    buildFleetViews(state, actions);    // rebuild ship cards for the new fleet
    addLog("Save wiped. A new contract begins.", "system");
    refresh();
  },
};


// -------------------------------------------------------------
// tick() - one turn of the game loop.
// -------------------------------------------------------------
function tick() {
  const now = Date.now();

  // Finish any trips that are due and log what came back.
  const results = processJobs(state, now);
  for (const result of results) {
    if (!result.itemId) continue;   // skip anything that produced nothing
    const ship = findShip(state, result.shipId);
    const itemName = ITEMS[result.itemId].name.toLowerCase();
    addLog(`${ship.name} docked with ${result.amount} ${itemName} (+${result.xpGained} ${SKILLS[result.skillId].name} XP).`, "trip");
    logLevelUps(result.skillId, result.newLevels);
  }

  render(state, now);
}

// refresh() - redraw straight away after a button press, and
// save, so the action is never lost if the tab closes.
function refresh() {
  render(state, Date.now());
  saveGame(state);
}


// -------------------------------------------------------------
// logLevelUps(skillId, levels)
// Announces each new level, and anything it unlocked.
// -------------------------------------------------------------
function logLevelUps(skillId, levels) {
  for (const level of levels) {
    addLog(`${SKILLS[skillId].name} reached level ${level}.`, "level");

    for (const typeId of getUnlocksAtLevel(skillId, level)) {
      addLog(`New ship unlocked: ${SHIP_TYPES[typeId].name}. See the Ships screen.`, "level");
    }
    if (skillId === "mining") {
      for (const fieldId of getFieldUnlocksAtLevel(level)) {
        addLog(`New field unlocked: ${FIELDS[fieldId].name}. Pick it on a docked ship's card.`, "level");
      }
    }
  }
}


// -------------------------------------------------------------
// The "welcome back" message after time away.
// -------------------------------------------------------------
function reportOfflineProgress(report) {
  // Ignore tiny gaps, like a quick page refresh.
  if (report.secondsAway < 10) {
    return;
  }

  let message = `Welcome back, commander. You were away ${formatDuration(report.secondsAway * 1000)}.`;

  if (report.secondsCounted < report.secondsAway) {
    message += ` (Only ${RULES.offlineCapHours}h counted.)`;
  }

  // Add up everything gained while away, item by item.
  const gained = {};   // e.g. { iron_ore: 240, nickel_ore: 36 }
  let totalXp = 0;
  for (const result of report.results) {
    if (!result.itemId) continue;
    gained[result.itemId] = (gained[result.itemId] || 0) + result.amount;
    totalXp += result.xpGained;
  }

  // Turn it into words: "240 iron ore and 36 nickel ore"
  const parts = Object.entries(gained).map(
    ([itemId, amount]) => `${formatNumber(amount)} ${ITEMS[itemId].name.toLowerCase()}`
  );
  if (parts.length > 0) {
    message += ` Your fleet brought back ${parts.join(" and ")}, earning ${formatNumber(totalXp)} Mining XP.`;
  }
  addLog(message, "system");

  // Any level-ups while away get their own lines after it.
  for (const result of report.results) {
    logLevelUps(result.skillId, result.newLevels);
  }
}


// -------------------------------------------------------------
// 2. Set up the screen.
// -------------------------------------------------------------
setupUI(state, actions);

if (isNewGame) {
  addLog("Contract signed. One barge, one belt, no prospects. Time to dig.", "system");
}


// -------------------------------------------------------------
// 3. Offline progress (only for a returning player).
// This runs after set-up so its messages have a log to go in.
// -------------------------------------------------------------
if (!isNewGame) {
  const report = applyOfflineProgress(state, Date.now());
  reportOfflineProgress(report);
}


// -------------------------------------------------------------
// 4 and 5: start the loop, and autosave.
// -------------------------------------------------------------
// Run tick() every 250 milliseconds (4 times a second).
setInterval(tick, 250);
tick();   // and once right now, so the screen isn't blank

// Save every few seconds...
setInterval(() => saveGame(state), RULES.autosaveSeconds * 1000);

// ...and when the player switches tab or closes the page.
document.addEventListener("visibilitychange", () => saveGame(state));
window.addEventListener("pagehide", () => saveGame(state));
