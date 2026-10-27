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

import { RULES, ITEMS, FIELDS } from "../data/content.js";
import { createNewGame, findShip } from "./state.js";
import { startMiningJob, cancelJob, getJobForShip, processJobs } from "./jobs.js";
import { sellAll } from "./trade.js";
import { saveGame, loadGame, deleteSave, applyOfflineProgress } from "./save.js";
import { setupUI, render, addLog, formatNumber, formatDuration } from "./ui.js";


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
// 2. Offline progress (only for a returning player).
// -------------------------------------------------------------
if (!isNewGame) {
  const report = applyOfflineProgress(state, Date.now());
  reportOfflineProgress(report);
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

  resetGame() {
    deleteSave();
    state = createNewGame();
    setupUI(state, actions);    // rebuild ship cards for the new fleet
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
    addLog(`${ship.name} returned with ${result.amount} ${itemName}.`);
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
  for (const result of report.results) {
    totalOre += result.amount;
  }

  if (totalOre > 0) {
    message += ` Your fleet brought back ${formatNumber(totalOre)} iron ore.`;
  }

  // The log doesn't exist on the page until the page has
  // loaded, which it has by the time modules run - so this
  // is safe.
  addLog(message);
}


// -------------------------------------------------------------
// 3, 4 and 5: set up the screen, start the loop, autosave.
// -------------------------------------------------------------
setupUI(state, actions);

if (isNewGame) {
  addLog("Contract signed. One barge, one belt, no prospects. Time to dig.");
}

// Run tick() every 250 milliseconds (4 times a second).
setInterval(tick, 250);
tick();   // and once right now, so the screen isn't blank

// Save every few seconds...
setInterval(() => saveGame(state), RULES.autosaveSeconds * 1000);

// ...and when the player switches tab or closes the page.
document.addEventListener("visibilitychange", () => saveGame(state));
window.addEventListener("pagehide", () => saveGame(state));
