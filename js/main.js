// =============================================================
// js/main.js
// -------------------------------------------------------------
// THE STARTING POINT. index.html loads this file, and this file
// pulls in everything else.
//
// What happens, in order:
//   1. Load the save (or start a new game).
//   2. Catch up on any time the player was away.
//   3. Set up the screen.
//   4. Start the "game loop" - a timer that, several times a
//      second, finishes due jobs and redraws the screen.
//   5. Start autosaving.
// =============================================================

import { RULES, ITEMS, FIELDS, SHIP_TYPES, SKILLS } from "../data/content.js";
import { createNewGame, findShip } from "./state.js";
import { startMiningJob, cancelJob, getJobForShip, processJobs } from "./jobs.js";
import { sellAll } from "./trade.js";
import { buyShip } from "./shipyard.js";
import { getUnlocksAtLevel } from "./skills.js";
import { saveGame, loadGame, deleteSave, applyOfflineProgress } from "./save.js";
import { setupUI, buildFleetCards, render, addLog, formatNumber, formatDuration } from "./ui.js";


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

  dispatchShip(shipId) {
    startMiningJob(state, shipId, "inner_belt", Date.now());
    addLog(`${findShip(state, shipId).name} departs for ${FIELDS.inner_belt.name}.`);
    refresh();
  },

  recallShip(shipId) {
    const job = getJobForShip(state, shipId);
    if (job) {
      cancelJob(state, job.id);
      addLog(`${findShip(state, shipId).name} recalled. Partial cargo dumped.`);
    }
    refresh();
  },

  sellOre() {
    const earned = sellAll(state, "iron_ore");
    if (earned > 0) {
      addLog(`Sold iron ore for ${formatNumber(earned)} cr.`);
    }
    refresh();
  },

  buyShip(shipTypeId) {
    const ship = buyShip(state, shipTypeId);
    if (ship) {
      // The fleet changed, so rebuild the ship cards.
      buildFleetCards(state, actions);
      addLog(`${ship.name} (${SHIP_TYPES[ship.type].name}) joins the fleet. Docked at home, awaiting orders.`);
    }
    refresh();
  },

  resetGame() {
    deleteSave();
    state = createNewGame();
    buildFleetCards(state, actions);    // rebuild ship cards for the new fleet
    addLog("Save wiped. A new contract begins.");
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
    addLog(`${ship.name} returned with ${result.amount} ${itemName} (+${result.xpGained} ${SKILLS[result.skillId].name} XP).`);
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
// Announces each new level, and any ships it unlocked.
// -------------------------------------------------------------
function logLevelUps(skillId, levels) {
  for (const level of levels) {
    addLog(`${SKILLS[skillId].name} reached level ${level}.`);

    for (const typeId of getUnlocksAtLevel(skillId, level)) {
      addLog(`New ship unlocked: ${SHIP_TYPES[typeId].name}. See the Ships screen.`);
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

  // Add up everything gained while away.
  let totalOre = 0;
  let totalXp = 0;
  for (const result of report.results) {
    totalOre += result.amount;
    totalXp += result.xpGained;
  }

  if (totalOre > 0) {
    message += ` Your fleet brought back ${formatNumber(totalOre)} iron ore and earned ${formatNumber(totalXp)} Mining XP.`;
  }
  addLog(message);

  // Any level-ups while away get their own lines after it.
  for (const result of report.results) {
    logLevelUps(result.skillId, result.newLevels);
  }
}


// -------------------------------------------------------------
// 3. Set up the screen.
// -------------------------------------------------------------
setupUI(state, actions);

if (isNewGame) {
  addLog("Contract signed. One barge, one belt, no prospects. Time to dig.");
}


// -------------------------------------------------------------
// 2. Offline progress (only for a returning player).
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
