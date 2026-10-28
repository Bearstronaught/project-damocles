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

import { RULES, ITEMS, FIELDS, SHIP_TYPES, SKILLS, HUB, HOME, HAUL_MODES } from "../data/content.js";
import { createNewGame, findShip } from "./state.js";
import { startMiningJob, startHaulJob, recallJob, resumeJob, getJobForShip, processJobs } from "./jobs.js";
import { sellAll, sellEverything } from "./trade.js";
import { buyShip, sellShip, renameShip } from "./shipyard.js";
import { buyUpgrade, getCommandCapacity } from "./command.js";
import { getUnlocksAtLevel, getFieldUnlocksAtLevel, isFieldUnlocked } from "./skills.js";
import { saveGame, loadGame, deleteSave, applyOfflineProgress, exportSave, importSave } from "./save.js";
import { showLevelBanner } from "./banner.js";
import { setupUI, buildFleetViews, render, addLog, formatNumber, formatXp, formatTonnes, formatDuration } from "./ui.js";


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

    // Freighters go on hub runs; everything else goes mining.
    if (SHIP_TYPES[ship.type].role === "freight") {
      const job = startHaulJob(state, shipId, Date.now());
      if (job && job.status === "travelling") {
        addLog(`${ship.name} loads ${describeCargo(job.cargo)} and departs for the ${HUB.name.toLowerCase()}.`, "fleet");
      } else if (job) {
        addLog(`${ship.name} starts hub runs. Waiting at the dock for ore to load.`, "fleet");
      }
    } else {
      const job = startMiningJob(state, shipId, ship.destination, Date.now());
      if (job) {
        addLog(`${ship.name} departs for ${FIELDS[ship.destination].name}.`, "fleet");
      }
    }
    refresh();
  },

  // Recall = "come home". The ship always flies back (no
  // shortcuts), then stays docked. See recallJob in jobs.js.
  recallShip(shipId) {
    const job = getJobForShip(state, shipId);
    if (!job) return;
    const ship = findShip(state, shipId);
    const recall = recallJob(state, job.id, Date.now());
    if (!recall) return;

    const docks = recall.docksInMs !== undefined ? formatDuration(recall.docksInMs) : "";
    if (recall.mode === "stoodDown") {
      addLog(`${ship.name} stands down at ${HOME.name}.`, "fleet");
    } else if (job.type === "haul") {
      addLog(job.noSale
        ? `${ship.name} recalled. Turning back with its cargo; docks in ${docks}.`
        : `${ship.name} recalled. Heading home after this run; docks in ${docks}.`, "fleet");
    } else if (recall.mode === "turnback") {
      addLog(`${ship.name} recalled. Turning back empty; docks in ${docks}.`, "fleet");
    } else if (recall.mode === "leftEarly") {
      addLog(`${ship.name} recalled. Leaving the field with ${formatTonnes(recall.amount)}; docks in ${docks}.`, "fleet");
    } else {
      addLog(`${ship.name} recalled. Bringing home ${formatTonnes(recall.amount)}; docks in ${docks}.`, "fleet");
    }
    refresh();
  },

  // Cancels a recall: the ship carries on working.
  resumeShip(shipId) {
    const job = getJobForShip(state, shipId);
    if (job && resumeJob(state, job.id, Date.now())) {
      addLog(`${findShip(state, shipId).name} resumes work.`, "fleet");
    }
    refresh();
  },

  // Full loads or constant runs - can be changed any time; the
  // freighter uses the new setting the next time it loads.
  setHaulMode(shipId, mode) {
    const ship = findShip(state, shipId);
    if (!ship || !HAUL_MODES[mode]) return;
    ship.haulMode = mode;
    refresh();
  },

  sellItem(itemId) {
    // sale = { credits, xp, newLevels } (see trade.js)
    const sale = sellAll(state, itemId);
    if (sale.credits > 0) {
      addLog(`Sold ${ITEMS[itemId].name.toLowerCase()} at ${HOME.name} for ${formatNumber(sale.credits)} cr (+${formatXp(sale.xp)} Trade XP).`, "trade");
      logLevelUps("trade", sale.newLevels);
    }
    refresh();
  },

  sellCargo() {
    const sale = sellEverything(state);
    if (sale.credits > 0) {
      addLog(`Sold the whole hold at ${HOME.name} for ${formatNumber(sale.credits)} cr (+${formatXp(sale.xp)} Trade XP).`, "trade");
      logLevelUps("trade", sale.newLevels);
    }
    refresh();
  },

  buyShip(shipTypeId) {
    const ship = buyShip(state, shipTypeId);
    if (ship) {
      // The fleet changed, so rebuild the ship cards.
      buildFleetViews(state, actions);
      addLog(`${ship.name} (${SHIP_TYPES[ship.type].name}) joins the fleet. Docked at ${HOME.name}, awaiting orders.`, "fleet");
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

  // Returns { ok, reason } so the screen can show why a name
  // was refused.
  renameShip(shipId, newName) {
    const result = renameShip(state, shipId, newName);
    if (result.ok && result.name !== result.oldName) {
      buildFleetViews(state, actions);   // the name shows on several screens
      addLog(`${result.oldName} renamed to ${result.name}.`, "fleet");
      refresh();
    }
    return result;
  },

  buyCommandUpgrade() {
    const gained = buyUpgrade(state);
    if (gained > 0) {
      addLog(`Fleet command expanded: +${gained} points (now ${getCommandCapacity(state)}).`, "fleet");
    }
    refresh();
  },

  // Returns the save as one line of text (see save.js).
  exportSave() {
    return exportSave(state);
  },

  // Replaces the current game with a pasted save.
  // Returns { ok: true } or { ok: false, reason } for the screen.
  importSave(text) {
    const result = importSave(text);
    if (!result.ok) {
      return result;
    }

    state = result.state;
    buildFleetViews(state, actions);    // the fleet is different now
    addLog("Save imported.", "system");

    // Catch up on the time since that save was exported, exactly
    // like coming back to the game.
    const report = applyOfflineProgress(state, Date.now());
    reportOfflineProgress(report);

    refresh();   // redraw and save it as the current game
    return { ok: true };
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
    const ship = findShip(state, result.shipId);
    if (result.kind === "mining") {
      const itemName = ITEMS[result.itemId].name.toLowerCase();
      addLog(`${ship.name} docked with ${formatTonnes(result.amount)} of ${itemName} (+${formatXp(result.xpGained)} Mining XP).`, "trip");
    } else if (result.kind === "haul") {
      addLog(`${ship.name} sold ${describeCargo(result.cargo)} at the ${HUB.name.toLowerCase()} for ${formatNumber(result.credits)} cr (+${formatXp(result.xpGained)} Trade XP).`, "trade");
    } else if (result.kind === "docked") {
      addLog(result.returnedCargo
        ? `${ship.name} docked at ${HOME.name}; ${describeCargo(result.returnedCargo)} back in the hold. Standing by.`
        : `${ship.name} docked at ${HOME.name}. Standing by.`, "trip");
    }
    if (result.kind !== "docked") {   // docking earns no XP
      logLevelUps(result.skillId, result.newLevels);
    }
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
// describeCargo(cargo)
// { nickel_ore: 200, iron_ore: 400 } -> "200 t nickel ore and 400 t iron ore"
// -------------------------------------------------------------
function describeCargo(cargo) {
  const parts = Object.entries(cargo).map(
    ([itemId, amount]) => `${formatTonnes(amount)} ${ITEMS[itemId].name.toLowerCase()}`
  );
  return parts.join(" and ");
}


// -------------------------------------------------------------
// getUnlockLines(skillId, level)
// Short lines for everything one level unlocks, e.g.
//   ["New ship: Excavator-class barge"]   or   [] for nothing.
// Used by the level-up banner.
// -------------------------------------------------------------
function getUnlockLines(skillId, level) {
  const lines = [];
  for (const typeId of getUnlocksAtLevel(skillId, level)) {
    lines.push("New ship: " + SHIP_TYPES[typeId].name);
  }
  if (skillId === "mining") {
    for (const fieldId of getFieldUnlocksAtLevel(level)) {
      lines.push("New field: " + FIELDS[fieldId].name);
    }
  }
  return lines;
}


// -------------------------------------------------------------
// logLevelUps(skillId, levels, showBanners)
// Announces each new level, and anything it unlocked, in the
// log. Each level also gets a banner across the top of the
// screen, unless showBanners is false (the welcome-back report
// shows one combined banner per skill instead - see below).
// -------------------------------------------------------------
function logLevelUps(skillId, levels, showBanners = true) {
  for (const level of levels) {
    addLog(`${SKILLS[skillId].name} reached level ${level}.`, "level");

    for (const typeId of getUnlocksAtLevel(skillId, level)) {
      addLog(`New ship unlocked: ${SHIP_TYPES[typeId].name}. It's now in the Shipyard.`, "level");
    }
    if (skillId === "mining") {
      for (const fieldId of getFieldUnlocksAtLevel(level)) {
        addLog(`New field unlocked: ${FIELDS[fieldId].name}. Pick it on a docked ship's card.`, "level");
      }
    }

    if (showBanners) {
      showLevelBanner(`${SKILLS[skillId].name} level ${level}`, getUnlockLines(skillId, level));
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
  const mined = {};      // ore brought home, e.g. { iron_ore: 240 }
  let miningXp = 0;
  const hauled = {};     // ore sold at the hub
  let hubCredits = 0;
  let tradeXp = 0;

  for (const result of report.results) {
    if (result.kind === "mining") {
      mined[result.itemId] = (mined[result.itemId] || 0) + result.amount;
      miningXp += result.xpGained;
    } else if (result.kind === "haul") {
      for (const [itemId, amount] of Object.entries(result.cargo)) {
        hauled[itemId] = (hauled[itemId] || 0) + amount;
      }
      hubCredits += result.credits;
      tradeXp += result.xpGained;
    }
  }

  if (Object.keys(mined).length > 0) {
    message += ` Your barges brought back ${describeCargo(mined)}, earning ${formatXp(miningXp)} Mining XP.`;
  }
  if (Object.keys(hauled).length > 0) {
    message += ` Your freighters sold ${describeCargo(hauled)} at the ${HUB.name.toLowerCase()} for ${formatNumber(hubCredits)} cr, earning ${formatXp(tradeXp)} Trade XP.`;
  }
  addLog(message, "system");

  // Any level-ups while away get their own log lines after it.
  // levelsGained collects them per skill, e.g. { mining: [4, 5, 6] }.
  const levelsGained = {};
  for (const result of report.results) {
    logLevelUps(result.skillId, result.newLevels, false);
    if (result.newLevels.length > 0) {
      levelsGained[result.skillId] = (levelsGained[result.skillId] || []).concat(result.newLevels);
    }
  }

  // Coming back to five level-ups would mean 15 seconds of
  // banners in a row, so show ONE per skill instead: the level
  // reached, with everything unlocked along the way.
  for (const [skillId, levels] of Object.entries(levelsGained)) {
    const highest = Math.max(...levels);
    // .flatMap joins each level's unlock list into one list
    const unlocks = levels.flatMap((level) => getUnlockLines(skillId, level));
    showLevelBanner(`${SKILLS[skillId].name} level ${highest}`, unlocks);
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
