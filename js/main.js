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

import { RULES, ITEMS, FIELDS, SHIP_TYPES, SKILLS, HUB, HOME, HAUL_MODES, RECIPES, REFINERY, WORKSHOP_RECIPES, WORKSHOP, UPGRADES, SHIP_UPGRADES, SHIP_PARTS } from "../data/content.js";
import { createNewGame, findShip } from "./state.js";
import { startMiningJob, startHaulJob, recallJob, resumeJob, getJobForShip } from "./jobs.js";
import { advanceTo } from "./simulation.js";
import { gameNow, setSpeed } from "./clock.js";
// "* as playtest" brings in the whole file under one name, so the
// calls read playtest.devSetLevel(...) and can't be mixed up with
// the actions of the same name below.
import * as playtest from "./playtest.js";
import { isDevModeOn, setDevMode, watchForSecret } from "./dev-switch.js";
import { sellAll, sellEverything } from "./trade.js";
import { setBond } from "./bonded.js";
import { buyShip, sellShip, renameShip } from "./shipyard.js";
import { buyUpgrade, getCommandCapacity } from "./command.js";
import { getUnlocksAtLevel, getFieldUnlocksAtLevel, isFieldUnlocked } from "./skills.js";
import { setRecipe, getRefineJob, getRecipeUnlocksAtLevel, getSlotUnlocksAtLevel } from "./refinery.js";
import { addOrder, cancelOrder, getWorkshopJob, getWorkshopRecipeUnlocksAtLevel, getWorkshopSlotUnlocksAtLevel, isQueueUnlockLevel, getQueueLimit, addStandingOrder, removeStandingOrder, getStandingOrders } from "./workshop.js";
import { buyIndustryUpgrade, getUpgradeUnlocksAtLevel } from "./upgrades.js";
import { buyShipUpgrade, getShipUpgradeUnlocksAtLevel, getUpgradeName, getPendingRefits } from "./ship-upgrades.js";
import { getLevelPerk } from "./skills.js";
import { saveGame, loadGame, deleteSave, applyOfflineProgress, exportSave, importSave } from "./save.js";
import { showLevelBanner } from "./banner.js";
import { setupUI, buildFleetViews, render, addLog, formatNumber, formatXp, formatTonnes, formatDuration, formatPercent, showDevPanel } from "./ui.js";


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
      const job = startHaulJob(state, shipId, gameNow(state));
      if (job && job.status === "travelling") {
        addLog(`${ship.name} loads ${describeCargo(job.cargo)} and departs for the ${HUB.name.toLowerCase()}.`, "fleet");
      } else if (job) {
        addLog(`${ship.name} starts hub runs. Waiting at the dock for ore to load.`, "fleet");
      }
    } else {
      const job = startMiningJob(state, shipId, ship.destination, gameNow(state));
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
    const recall = recallJob(state, job.id, gameNow(state));
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
    if (job && resumeJob(state, job.id, gameNow(state))) {
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

  // Gives a refinery slot a recipe, or switches it off (null).
  setRecipe(slot, recipeId) {
    const before = getRefineJob(state, slot);
    // Ore in a half-finished batch comes back if it's stopped.
    const returning = before && before.status === "working" ? before.inputs : null;

    if (!setRecipe(state, slot, recipeId, gameNow(state))) {
      refresh();   // (redraws the dropdown back to what it was)
      return;
    }

    if (recipeId === null) {
      addLog(`Refinery slot ${slot + 1} switched off.`, "refine");
    } else {
      addLog(`Refinery slot ${slot + 1} now smelting ${RECIPES[recipeId].name.toLowerCase()}.`, "refine");
    }
    if (returning) {
      addLog(`The unfinished batch's ${describeCargo(returning)} went back into the hold.`, "refine");
    }
    refresh();
  },

  // Puts a work order at the back of a workshop slot's queue.
  // Returns { ok, reason } so the screen can say why it was refused.
  queueOrder(slot, recipeId, batches) {
    const result = addOrder(state, slot, recipeId, batches, gameNow(state));
    if (result.ok) {
      const name = WORKSHOP_RECIPES[recipeId].name.toLowerCase();
      addLog(`Workshop slot ${slot + 1}: order queued for ${batches} ${batches === 1 ? "batch" : "batches"} of ${name}.`, "make");
    }
    refresh();
    return result;
  },

  // Removes one order from a slot's queue (0 = the current one).
  cancelOrder(slot, index) {
    const job = getWorkshopJob(state, slot);
    if (!job || !job.orders[index]) return;
    const order = job.orders[index];
    // Metal comes back only if the current batch was underway.
    const returning = index === 0 && job.status === "working" ? job.inputs : null;

    if (cancelOrder(state, slot, index, gameNow(state))) {
      addLog(`Workshop slot ${slot + 1}: ${WORKSHOP_RECIPES[order.recipeId].name.toLowerCase()} order cancelled.`, "make");
      if (returning) {
        addLog(`The unfinished batch's ${describeCargo(returning)} went back into the hold.`, "make");
      }
    }
    refresh();
  },

  // "Keep [target] t of [product] in stock" on a workshop slot.
  addStandingOrder(slot, recipeId, target) {
    const result = addStandingOrder(state, slot, recipeId, target, gameNow(state));
    if (result.ok) {
      addLog(`Workshop slot ${slot + 1}: standing order to keep ${formatTonnes(target)} of ${WORKSHOP_RECIPES[recipeId].name.toLowerCase()} in stock.`, "make");
    }
    refresh();
    return result;
  },

  removeStandingOrder(slot, index) {
    const order = getStandingOrders(state, slot)[index];
    if (order && removeStandingOrder(state, slot, index, gameNow(state))) {
      addLog(`Workshop slot ${slot + 1}: standing order for ${WORKSHOP_RECIPES[order.recipeId].name.toLowerCase()} removed.`, "make");
    }
    refresh();
  },

  // Buys a refinery or workshop upgrade. Returns { ok, reason }
  // so the screen can say why it was refused.
  buyIndustryUpgrade(upgradeId) {
    const result = buyIndustryUpgrade(state, upgradeId);
    if (result.ok) {
      const upgrade = UPGRADES[upgradeId];
      addLog(`Upgrade installed: ${upgrade.name}. ${upgrade.description}`, upgrade.building === "refinery" ? "refine" : "make");
    }
    refresh();
    return result;
  },

  // Sets how much of an item is bonded (0 = release it).
  setBond(itemId, tonnes) {
    const before = state.bonded[itemId] || 0;
    const result = setBond(state, itemId, tonnes);
    const name = ITEMS[itemId].name.toLowerCase();
    if (!result.ok) {
      addLog(`Bond not set: ${result.reason}`, "trade");
    } else if (tonnes === 0 && before > 0) {
      addLog(`Released the bond on ${name}. It can be sold again.`, "trade");
    } else if (tonnes > 0 && tonnes !== before) {
      addLog(`Bonded ${formatTonnes(tonnes)} of ${name}. Freighters and the Sell buttons will leave it.`, "trade");
    }
    refresh();
    return result;
  },

  sellItem(itemId) {
    // sale = { credits, xp, newLevels } (see trade.js)
    const sale = sellAll(state, itemId);
    if (sale.credits > 0) {
      addLog(`Sold ${ITEMS[itemId].name.toLowerCase()} at ${HOME.name} for ${formatNumber(sale.credits)} cr.`, "trade");
    }
    refresh();
  },

  sellCargo() {
    const sale = sellEverything(state);
    if (sale.credits > 0) {
      addLog(`Sold the whole hold at ${HOME.name} for ${formatNumber(sale.credits)} cr.`, "trade");
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

  // A ship component (ship-upgrades.js): fits every ship of a type.
  // Returns { ok } or { ok: false, reason } for the screen.
  buyShipUpgrade(upgradeId) {
    const result = buyShipUpgrade(state, upgradeId);
    if (result.ok) {
      const upgrade = SHIP_UPGRADES[upgradeId];
      // Ships of this type that are out working get it when they dock.
      const out = state.ships.filter((ship) => ship.type === upgrade.hull &&
        Object.keys(getPendingRefits(state, ship)).length > 0).length;
      const when = out === 0
        ? "Fitted to every ship of the type."
        : `Fitted to docked ships now; ${out === 1 ? "1 ship out working gets it" : out + " ships out working get it"} when back at ${HOME.name}.`;
      addLog(`Component bought: ${getUpgradeName(upgrade)} (+${formatPercent(upgrade.bonus)} ${SHIP_PARTS[upgrade.part].says}). ${when}`, "fleet");
      refresh();
    }
    return result;
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
    const report = applyOfflineProgress(state, gameNow(state));
    reportOfflineProgress(report);

    refresh();   // redraw and save it as the current game
    return { ok: true };
  },

  // ===========================================================
  // PLAYTEST TOOLS (the dev panel - see playtest.js)
  // Each one is logged, so a playtest log never hides a cheat.
  // ===========================================================

  devSetSpeed(speed) {
    // The real time is passed in so the clock pins "now" to it.
    const result = playtest.devSetSpeed(state, speed, Date.now());
    if (result.ok) {
      addLog(`Playtest: game speed set to ${speed}×.`, "system");
      refresh();
    }
    return result;
  },

  devJumpHour() {
    playtest.devJumpHour(state);
    // Play the hour out straight away, and report it like a
    // return from time away.
    const report = advanceTo(state, gameNow(state));
    reportOfflineProgress(report, "Playtest: jumped ahead 1 hour.");
    refresh();
    return { ok: true };
  },

  devSetLevel(skillId, level) {
    const result = playtest.devSetLevel(state, skillId, level);
    if (result.ok) {
      addLog(`Playtest: ${SKILLS[skillId].name} set to level ${level}.`, "system");
      refresh();
    }
    return result;
  },

  devAddCredits(amount) {
    const result = playtest.devAddCredits(state, amount);
    if (result.ok) {
      addLog(`Playtest: added ${formatNumber(amount)} cr.`, "system");
      refresh();
    }
    return result;
  },

  devAddGoods(itemId, tonnes) {
    const result = playtest.devAddGoods(state, itemId, tonnes);
    if (result.ok) {
      addLog(`Playtest: added ${formatTonnes(tonnes)} of ${ITEMS[itemId].name.toLowerCase()} to the hold.`, "system");
      refresh();
    }
    return result;
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
// Every action catches up first.
// -------------------------------------------------------------
// Before any button does anything, the game is played up to this
// exact moment. Otherwise a click could land just after a ship
// was due to dock but before the loop had noticed (up to 250 ms
// later, or much longer if the computer had been asleep), and
// the action would see an out-of-date fleet.
//
// This loop wraps each action in a small function that runs
// tick() and THEN the original action. getState is left alone:
// it only reads.
for (const name of Object.keys(actions)) {
  if (name === "getState") continue;
  const originalAction = actions[name];
  // "...args" passes along whatever the button gave the action
  // (a ship ID, a recipe, and so on), however many there are.
  actions[name] = (...args) => {
    tick();
    return originalAction(...args);
  };
}


// A gap at least this long gets the "welcome back" summary.
const WELCOME_BACK_SECONDS = 60;

// The computer's time at the last tick. The welcome-back check
// uses REAL time: at 60x game speed, one slow tick of 1 second
// is a whole game minute, and that shouldn't count as "away".
let lastTickRealAt = Date.now();

// -------------------------------------------------------------
// tick() - one turn of the game loop.
// -------------------------------------------------------------
function tick() {
  // While the tab is hidden, do nothing at all: no catching up,
  // no drawing (design doc safeguard - drawing in a hidden tab
  // wastes phone battery). Nothing is lost: the game remembers
  // how far it got (state.simulatedUpTo), and the first tick
  // after you come back plays out the whole gap in one go.
  if (document.hidden) {
    return;
  }

  // The game's time (clock.js) - the same as real time at 1x.
  const now = gameNow(state);

  // How long since the last tick, in real seconds.
  const realNow = Date.now();
  const realSecondsGap = (realNow - lastTickRealAt) / 1000;
  lastTickRealAt = realNow;

  // Play the game forward to now (simulation.js). This is the
  // same call the game makes on load after time away.
  const report = advanceTo(state, now);

  // A big gap while the page was open - the computer was asleep,
  // or the browser paused a background tab - reads better as one
  // "welcome back" summary than as dozens of log lines.
  if (realSecondsGap >= WELCOME_BACK_SECONDS && report.secondsAway >= WELCOME_BACK_SECONDS) {
    reportOfflineProgress(report);
    render(state, now);
    return;
  }

  // Log what came back.
  for (const result of report.results) {
    // Refinery batches have no ship.
    if (result.kind === "refine") {
      const batches = result.trips === 1 ? "" : ` in ${result.trips} batches`;
      addLog(`Refinery slot ${result.slot + 1} made ${formatTonnes(result.amount)} of ${ITEMS[result.itemId].name.toLowerCase()}${batches} (+${formatXp(result.xpGained)} Refining XP).`, "refine");
      logLevelUps(result.skillId, result.newLevels);
      continue;   // on to the next result
    }

    // Workshop batches have no ship either.
    if (result.kind === "workshop") {
      logWorkshopResult(result);
      continue;
    }

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
  render(state, gameNow(state));
  saveGame(state);
}


// -------------------------------------------------------------
// logWorkshopResult(result)
// Log lines for workshop batches, e.g.
//   "Workshop slot 1 made 30 t of hull plating (+12 Manufacturing XP)."
//   "Workshop slot 1 finished its order."
//   "Workshop slot 1 is idle: its queue is empty."  (amber: needs you)
// -------------------------------------------------------------
function logWorkshopResult(result) {
  const name = ITEMS[result.itemId].name.toLowerCase();
  const batches = result.trips === 1 ? "" : ` in ${result.trips} batches`;
  addLog(`Workshop slot ${result.slot + 1} made ${formatTonnes(result.amount)} of ${name}${batches} (+${formatXp(result.xpGained)} Manufacturing XP).`, "make");
  if (result.slotIdle) {
    addLog(`Workshop slot ${result.slot + 1} is idle: its queue is empty. Queue more orders on the Industry tab.`, "make");
  } else if (result.ordersFinished > 0) {
    addLog(`Workshop slot ${result.slot + 1} finished ${result.ordersFinished === 1 ? "an order" : result.ordersFinished + " orders"}; starting the next.`, "make");
  }
  logLevelUps(result.skillId, result.newLevels);
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
// Used by the level-up banner. withPerk adds the level perk
// line at the end (left off when several levels are combined).
// -------------------------------------------------------------
function getUnlockLines(skillId, level, withPerk = true) {
  const lines = [];
  for (const typeId of getUnlocksAtLevel(skillId, level)) {
    lines.push("New ship: " + SHIP_TYPES[typeId].name);
  }
  if (skillId === "mining") {
    for (const fieldId of getFieldUnlocksAtLevel(level)) {
      lines.push("New field: " + FIELDS[fieldId].name);
    }
    if (level === REFINERY.openAtMiningLevel) {
      lines.push("New: the refinery (Industry tab)");
    }
  }
  if (skillId === "refining") {
    for (const recipeId of getRecipeUnlocksAtLevel(level)) {
      lines.push("New recipe: " + RECIPES[recipeId].name);
    }
    for (const slotNumber of getSlotUnlocksAtLevel(level)) {
      lines.push("New refinery slot: slot " + slotNumber);
    }
    if (level === WORKSHOP.openAtRefiningLevel) {
      lines.push("New: the workshop (Industry tab)");
    }
  }
  for (const upgradeId of getUpgradeUnlocksAtLevel(skillId, level)) {
    lines.push("New upgrade to buy: " + UPGRADES[upgradeId].name);
  }
  for (const upgradeId of getShipUpgradeUnlocksAtLevel(skillId, level)) {
    lines.push("New ship component (Shipyard): " + getUpgradeName(SHIP_UPGRADES[upgradeId]));
  }
  if (skillId === "manufacturing") {
    for (const recipeId of getWorkshopRecipeUnlocksAtLevel(level)) {
      lines.push("New recipe: " + WORKSHOP_RECIPES[recipeId].name);
    }
    for (const slotNumber of getWorkshopSlotUnlocksAtLevel(level)) {
      lines.push("New workshop slot: slot " + slotNumber);
    }
    if (isQueueUnlockLevel(level)) {
      lines.push("Longer queues: one more order per slot");
    }
  }
  // Last, what every level gives: "+0.5% drill speed (now +4.5%)".
  if (withPerk) {
    lines.push(perkLine(skillId, level));
  }
  return lines;
}


// -------------------------------------------------------------
// perkLine(skillId, level)
// The level perk as one line, e.g. "+0.5% drill speed (now +4.5%)".
// -------------------------------------------------------------
function perkLine(skillId, level) {
  const perk = getLevelPerk(state, skillId, level);
  return `+${formatPercent(perk.perLevel)} ${SKILLS[skillId].perk} (now +${formatPercent(perk.total)})`;
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
    addLog(`${SKILLS[skillId].name} reached level ${level}: ${perkLine(skillId, level)}.`, "level");

    for (const typeId of getUnlocksAtLevel(skillId, level)) {
      addLog(`New ship unlocked: ${SHIP_TYPES[typeId].name}. It's now in the Shipyard.`, "level");
    }
    if (skillId === "mining") {
      for (const fieldId of getFieldUnlocksAtLevel(level)) {
        addLog(`New field unlocked: ${FIELDS[fieldId].name}. Pick it on a docked ship's card.`, "level");
      }
      if (level === REFINERY.openAtMiningLevel) {
        addLog(`The ${HOME.name} refinery is open. Find it on the Industry tab.`, "level");
      }
    }
    if (skillId === "refining") {
      for (const recipeId of getRecipeUnlocksAtLevel(level)) {
        addLog(`New recipe unlocked: ${RECIPES[recipeId].name}. Pick it in a refinery slot.`, "level");
      }
      for (const slotNumber of getSlotUnlocksAtLevel(level)) {
        addLog(`Refinery slot ${slotNumber} unlocked.`, "level");
      }
      if (level === WORKSHOP.openAtRefiningLevel) {
        addLog(`The ${HOME.name} workshop is open. Queue work orders on the Industry tab.`, "level");
      }
    }
    for (const upgradeId of getUpgradeUnlocksAtLevel(skillId, level)) {
      addLog(`New upgrade available: ${UPGRADES[upgradeId].name}. Find it under Upgrades on the Industry tab.`, "level");
    }
    for (const upgradeId of getShipUpgradeUnlocksAtLevel(skillId, level)) {
      addLog(`New ship component available: ${getUpgradeName(SHIP_UPGRADES[upgradeId])}. Find it under Ship components on the Shipyard tab.`, "level");
    }
    if (skillId === "manufacturing") {
      for (const recipeId of getWorkshopRecipeUnlocksAtLevel(level)) {
        addLog(`New recipe unlocked: ${WORKSHOP_RECIPES[recipeId].name}. Pick it in a workshop order.`, "level");
      }
      for (const slotNumber of getWorkshopSlotUnlocksAtLevel(level)) {
        addLog(`Workshop slot ${slotNumber} unlocked.`, "level");
      }
      if (isQueueUnlockLevel(level)) {
        addLog(`Workshop queues now hold ${getQueueLimit(state)} orders per slot.`, "level");
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
// "opening" replaces the first sentence (the dev panel's jump
// says "Playtest: jumped ahead 1 hour." instead).
function reportOfflineProgress(report, opening = null) {
  // Ignore tiny gaps, like a quick page refresh.
  if (report.secondsAway < 10) {
    return;
  }

  let message = opening || `Welcome back, commander. You were away ${formatDuration(report.secondsAway * 1000)}.`;

  // Time away is GAME time, so at a playtest speed say so
  // (an hour away at 10x reads as 10 hours).
  if (!opening && state.clock.speed !== 1) {
    message += ` (Game time, at ${state.clock.speed}× speed.)`;
  }

  if (report.secondsCounted < report.secondsAway) {
    message += ` (Only ${RULES.offlineCapHours}h counted.)`;
  }

  // Add up everything gained while away.
  const mined = {};      // ore brought home, e.g. { iron_ore: 240 }
  let miningXp = 0;
  const hauled = {};     // ore sold at the hub
  let hubCredits = 0;
  let tradeXp = 0;
  const refined = {};    // metal made, e.g. { iron_bar: 600 }
  let refiningXp = 0;
  const made = {};       // products made, e.g. { hull_plating: 900 }
  let manufacturingXp = 0;
  const idleSlots = [];  // workshop slots whose queue ran out

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
    } else if (result.kind === "refine") {
      refined[result.itemId] = (refined[result.itemId] || 0) + result.amount;
      refiningXp += result.xpGained;
    } else if (result.kind === "workshop") {
      made[result.itemId] = (made[result.itemId] || 0) + result.amount;
      manufacturingXp += result.xpGained;
      if (result.slotIdle) idleSlots.push(result.slot + 1);
    }
  }

  if (Object.keys(mined).length > 0) {
    message += ` Your barges brought back ${describeCargo(mined)}, earning ${formatXp(miningXp)} Mining XP.`;
  }
  if (Object.keys(hauled).length > 0) {
    message += ` Your freighters sold ${describeCargo(hauled)} at the ${HUB.name.toLowerCase()} for ${formatNumber(hubCredits)} cr, earning ${formatXp(tradeXp)} Trade XP.`;
  }
  if (Object.keys(refined).length > 0) {
    message += ` The refinery made ${describeCargo(refined)}, earning ${formatXp(refiningXp)} Refining XP.`;
  }
  if (Object.keys(made).length > 0) {
    message += ` The workshop made ${describeCargo(made)}, earning ${formatXp(manufacturingXp)} Manufacturing XP.`;
  }
  if (idleSlots.length > 0) {
    message += ` Workshop ${idleSlots.length === 1 ? "slot " + idleSlots[0] + " ran out of orders and is" : "slots " + idleSlots.join(" and ") + " ran out of orders and are"} idle.`;
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
    // (Each level's perk line is left off, and the total perk at
    // the highest level is added once at the end.)
    const unlocks = levels.flatMap((level) => getUnlockLines(skillId, level, false));
    unlocks.push(perkLine(skillId, highest));
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
  const report = applyOfflineProgress(state, gameNow(state));
  reportOfflineProgress(report);
}

// A save left at a playtest speed, opened in a browser where dev
// mode is off (say, an imported save), goes back to 1x: without
// dev mode there'd be no way to see or change the speed. The
// time away above was already played at the saved speed.
if (!isDevModeOn() && state.clock.speed !== 1) {
  setSpeed(state, 1);
}


// -------------------------------------------------------------
// The hidden dev mode switch (dev-switch.js): type "damocles",
// or tap the title 7 times.
// -------------------------------------------------------------
showDevPanel(isDevModeOn());

watchForSecret(document.querySelector(".title"), () => {
  tick();   // catch up first, like every action
  const turningOn = !isDevModeOn();
  setDevMode(turningOn);

  if (turningOn) {
    addLog("Dev mode on: playtest tools are open under the status strip.", "system");
  } else {
    // Turning it off also puts the speed back to 1x, so the game
    // never keeps racing with no control on screen.
    if (state.clock.speed !== 1) {
      setSpeed(state, 1);
      addLog("Game speed back to 1×.", "system");
    }
    addLog("Dev mode off.", "system");
  }
  showDevPanel(turningOn);
  refresh();
});


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
