// =============================================================
// js/main.js
// -------------------------------------------------------------
// THE STARTING POINT. index.html loads this file, and this file
// pulls in everything else.
//
// What happens, in order:
//   0. Check the page and the code are the same version.
//   1. Load the save (or start a new game).
//   2. Set up the screen.
//   3. Catch up on any time the player was away.
//   4. Start the "game loop" - a timer that, several times a
//      second, finishes due jobs and redraws the screen.
//   5. Start autosaving.
// =============================================================

import { RULES, ITEMS, FIELDS, SHIP_TYPES, SKILLS, HUB, HOME, HAUL_MODES, RECIPES, REFINERY, WORKSHOP_RECIPES, WORKSHOP, UPGRADES, SHIP_UPGRADES, SHIP_PARTS, CONTRACT_KINDS, CONTRACT_FACTIONS, CONTRACTS } from "../data/content.js";
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
import { orderShip, sellShip, renameShip } from "./shipyard.js";
import { cancelBuild, getTimeUntilReady, BERTHS } from "./slipway.js";
import { buyUpgrade, getCommandCapacity } from "./command.js";
import { getUnlocksAtLevel, getFieldUnlocksAtLevel, isFieldUnlocked, canHullWorkField } from "./skills.js";
import { setRecipe, getRefineJob, getRecipeUnlocksAtLevel, getSlotUnlocksAtLevel } from "./refinery.js";
import { addOrder, cancelOrder, getWorkshopJob, getWorkshopRecipeUnlocksAtLevel, getWorkshopSlotUnlocksAtLevel, isQueueUnlockLevel, getQueueLimit, addStandingOrder, removeStandingOrder, getStandingOrders } from "./workshop.js";
import { buyIndustryUpgrade, getUpgradeUnlocksAtLevel } from "./upgrades.js";
import { buyShipUpgrade, getShipUpgradeUnlocksAtLevel, getUpgradeName, getPendingRefits } from "./ship-upgrades.js";
import { getLevelPerk } from "./skills.js";
import { startScoutJob, canScoutGo, chooseNextTarget, getTarget, getTargetUnlocksAtLevel, isExplorationOpen, DEEP_SCAN_ID,
  getTargetStatus, launchSurvey, cancelLaunch, getReadySurveys } from "./exploration.js";
import { describeFind } from "./exploration-screen.js";
import { showSurveyReport } from "./report.js";
import { summariseTimeAway, hasActivity, largestFirst, WELCOME_BACK_SECONDS } from "./welcome-back.js";
import { showWelcomeBack } from "./welcome-popup.js";
import { getRoleGroups } from "./fleet-groups.js";
import { handInContract, discardContract, canHandIn, isReady, describeContract, charterShip, getCharter, lendSlot } from "./contracts.js";
import { saveGame, loadGame, deleteSave, applyOfflineProgress, exportSave, importSave } from "./save.js";
import { showLevelBanner } from "./banner.js";
import { setupUI, buildFleetViews, render, addLog, formatNumber, formatXp, formatTonnes, formatDuration, formatPercent, showDevPanel } from "./ui.js";
import { VERSION } from "./version.js";
import { setupSystemMap } from "./system-map.js";
import { setupIndustryView } from "./industry-view.js";
import { setupExplorationView } from "./exploration-view.js";
import { setupContractsView } from "./contracts-view.js";
import { setupSkillsView } from "./skills-view.js";
import { setupShipyardView } from "./shipyard-view.js";


// -------------------------------------------------------------
// 0. Same version? (see tools/release.js)
// -------------------------------------------------------------
// index.html carries the version it was released with, in a
// <meta name="game-version"> tag; js/version.js carries the code's.
// Straight after an update a browser can, rarely, end up with an
// old page and new code (or the reverse). Rather than run a mix
// against the player's save, the game doesn't start: it says
// there's a new version and offers a reload.
checkVersion();

function checkVersion() {
  // "?." means: if there's no such tag, give undefined instead of failing
  const pageVersion = document.querySelector('meta[name="game-version"]')?.content;
  if (pageVersion === VERSION) {
    return;   // all good: carry on loading the game
  }

  // Cover the page with a message and a Reload button.
  const notice = document.createElement("div");
  notice.className = "update-notice";
  notice.innerHTML = `
    <div class="panel update-box">
      <h2 class="panel-title">New version</h2>
      <p>Project Damocles has been updated (v${VERSION}). Reload to play it.
         Your save is safe: nothing has run.</p>
      <p class="price-note">If this keeps appearing, wait a few minutes and reload again:
         the new version can take a little while to reach every browser.</p>
      <button class="btn btn-primary">Reload</button>
    </div>
  `;
  notice.querySelector("button").addEventListener("click", () => location.reload());
  document.body.appendChild(notice);

  // Stop here: "throw" ends this file, so the save is never loaded
  // and the game loop never starts. (It shows as an error in the
  // browser's console, which is what it is.)
  throw new Error(`Page is v${pageVersion}, code is v${VERSION}: not starting`);
}


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
    // A scout's "destination" is a survey target (or the deep scan).
    if (ship && SHIP_TYPES[ship.type].role === "scout") {
      if (!getJobForShip(state, shipId) && canScoutGo(state, shipId, fieldId)) {
        ship.destination = fieldId;
      }
      refresh();
      return;
    }
    // Only docked ships can change course, and only to fields
    // that are unlocked. (The buttons are disabled otherwise,
    // but checking here too means the rule can't be skipped.)
    if (!ship || getJobForShip(state, shipId) || !isFieldUnlocked(state, fieldId)) {
      return;
    }
    // ...and only to a field this hull can work (the Ice moon is
    // small hulls only, the deep core large and up).
    if (!canHullWorkField(ship.type, fieldId)) {
      return;
    }
    // A chartered ship goes where the charter says (contracts.js).
    if (getCharter(state, shipId)) {
      return;
    }
    ship.destination = fieldId;
    refresh();
  },

  dispatchShip(shipId) {
    const ship = findShip(state, shipId);

    // Scouts survey; freighters go on hub runs; barges go mining.
    if (SHIP_TYPES[ship.type].role === "scout") {
      // A survey picked on its card goes first (still open and not
      // taken by another scout). Otherwise it's the player's next
      // launched survey, or deep scans when none is launched.
      const picked = ship.destination !== DEEP_SCAN_ID && canScoutGo(state, shipId, ship.destination);
      const targetId = picked ? ship.destination : chooseNextTarget(state, shipId);
      const job = startScoutJob(state, shipId, targetId, gameNow(state));
      if (job) {
        addLog(targetId === DEEP_SCAN_ID
          ? `${ship.name} departs to run deep scans.`
          : `${ship.name} departs to survey ${getTarget(targetId).name}.`, "explore");
      }
    } else if (SHIP_TYPES[ship.type].role === "freight") {
      const job = startHaulJob(state, shipId, gameNow(state));
      if (job && job.status === "travelling") {
        addLog(`${ship.name} loads ${describeCargo(job.cargo)} and departs for ${HUB.name}.`, "fleet");
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

  // -----------------------------------------------------------
  // launchSurvey(targetId) - the Launch survey button on the
  // Exploration tab (Dan, 31 Oct: surveys are the player's call).
  // A docked scout sets off straight away. Otherwise the next
  // scout to finish its current deep scan goes, so pressing the
  // button never throws away a scan already under way.
  // -----------------------------------------------------------
  launchSurvey(targetId) {
    const result = launchSurvey(state, targetId);
    if (!result.ok) return;
    const target = getTarget(targetId);

    // Is a scout sitting at the dock with nothing to do?
    const idleScout = state.ships.find((ship) =>
      SHIP_TYPES[ship.type].role === "scout" && !getJobForShip(state, ship.id) && canScoutGo(state, ship.id, targetId));
    if (idleScout) {
      startScoutJob(state, idleScout.id, targetId, gameNow(state));
      addLog(`Survey launched: ${idleScout.name} departs to survey ${target.name}.`, "explore");
    } else {
      addLog(`Survey launched: ${target.name}. A scout will head there as soon as its current scan ends.`, "explore");
    }
    refresh();
  },

  // Takes a launched survey back, as long as no scout has left for it.
  cancelSurvey(targetId) {
    if (cancelLaunch(state, targetId)) {
      addLog(`Survey of ${getTarget(targetId).name} cancelled. Your scouts will keep deep scanning.`, "explore");
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
      addLog(`Upgrade installed: ${upgrade.name}. ${upgrade.description}`, { refinery: "refine", workshop: "make", shipyard: "fleet" }[upgrade.building]);
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

  // Hands a finished contract in (contracts.js): every kind is
  // handed in by hand (Dan, 30 Oct); a delivery's goods leave the
  // hold. Returns { ok } or { ok: false, reason } for the card.
  handInContract(slot) {
    const check = canHandIn(state, slot);
    if (!check.ok) return check;
    const result = handInContract(state, slot, gameNow(state));
    logContract(result);
    logLevelUps(result.skillId, result.newLevels);   // Diplomacy
    refresh();
    return { ok: true };
  },

  // Lends a refinery slot to a toll smelting contract (contracts.js).
  // Returns { ok } or { ok: false, reason } for the card.
  lendSlot(slot, refinerySlot) {
    const result = lendSlot(state, slot, refinerySlot, gameNow(state));
    if (result.ok) {
      const contract = state.contracts.slots[slot].contract;
      addLog(`Refinery slot ${refinerySlot + 1} is smelting ${ITEMS[contract.itemId].name.toLowerCase()} for ${contract.client.toLowerCase()}, from their ore. It goes back to its own recipe when they have ${formatTonnes(contract.amount)}.`, "contract");
    }
    refresh();
    return result;
  },

  // Lends a mining ship to a charter (contracts.js). Returns
  // { ok } or { ok: false, reason } for the card.
  charterShip(slot, shipId) {
    const result = charterShip(state, slot, shipId);
    if (result.ok) {
      const ship = findShip(state, shipId);
      const contract = state.contracts.slots[slot].contract;
      const field = FIELDS[contract.fieldId].name;
      if (getJobForShip(state, shipId)) {
        // Out working: the charter starts from its next departure.
        addLog(`${ship.name} is chartered to ${contract.client.toLowerCase()}. It heads for the ${field} after this trip.`, "contract");
      } else {
        // Docked: off it goes now (dispatchShip logs the departure).
        addLog(`${ship.name} is chartered to ${contract.client.toLowerCase()}.`, "contract");
        actions.dispatchShip(shipId);
      }
    }
    refresh();
    return result;
  },

  // Throws a contract away; a new one comes after the usual wait.
  discardContract(slot) {
    const contract = state.contracts.slots[slot]?.contract;
    if (contract && discardContract(state, slot, gameNow(state))) {
      addLog(`Contract discarded: ${CONTRACT_KINDS[contract.kindId].title.toLowerCase()} for ${contract.client.toLowerCase()}. A new one will be posted in ${CONTRACTS.refillMinutes} minutes.`, "contract");
    }
    refresh();
  },

  sellItem(itemId) {
    const wasOpen = isExplorationOpen(state);
    // sale = { credits, xp, newLevels } (see trade.js)
    const sale = sellAll(state, itemId);
    if (sale.credits > 0) {
      addLog(`Sold ${ITEMS[itemId].name.toLowerCase()} at ${HOME.name} for ${formatNumber(sale.credits)} cr.`, "trade");
    }
    announceFirstSale(wasOpen);
    refresh();
  },

  sellCargo() {
    const wasOpen = isExplorationOpen(state);
    const sale = sellEverything(state);
    if (sale.credits > 0) {
      addLog(`Sold the whole hold at ${HOME.name} for ${formatNumber(sale.credits)} cr.`, "trade");
    }
    announceFirstSale(wasOpen);
    refresh();
  },

  // Pays for a ship and puts it on the slipway (shipyard.js). It
  // joins the fleet when the build finishes (see logBuilt below).
  buyShip(shipTypeId) {
    const now = gameNow(state);
    const order = orderShip(state, shipTypeId, now);
    if (order) {
      const berth = BERTHS[order.berth].name.toLowerCase();
      const ready = formatDuration(getTimeUntilReady(state, order.id, now));
      const queued = order.startedAt === null ? ", queued behind the build already there" : "";
      addLog(`${SHIP_TYPES[order.type].name} ordered on the ${berth}${queued}. Ready in ${ready}.`, "fleet");
    }
    refresh();
  },

  // Takes an order off the slipway with a full refund (slipway.js).
  cancelBuild(orderId) {
    const order = cancelBuild(state, orderId, gameNow(state));
    if (order) {
      addLog(`${SHIP_TYPES[order.type].name} order cancelled; ${formatNumber(order.paid.credits)} cr refunded.`, "fleet");
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


// A gap at least WELCOME_BACK_SECONDS long (10 minutes, in
// welcome-back.js) gets the welcome-back pop-up. Shorter gaps
// with the page open just log what happened, as if played.

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
      // Toll smelting: say how much was the client's.
      const forClient = result.tolled > 0 ? `, ${formatTonnes(result.tolled)} of it for a client` : "";
      addLog(`Refinery slot ${result.slot + 1} made ${formatTonnes(result.amount)} of ${ITEMS[result.itemId].name.toLowerCase()}${batches}${forClient} (+${formatXp(result.xpGained)} Refining XP).`, "refine");
      logLevelUps(result.skillId, result.newLevels);
      continue;   // on to the next result
    }

    // Workshop batches have no ship either.
    if (result.kind === "workshop") {
      logWorkshopResult(result);
      continue;
    }

    // Scouts have their own lines (finds and lore).
    if (result.kind === "scout") {
      logScoutResult(result);
      continue;
    }

    // A hull finished on a slipway: it joins the fleet.
    if (result.kind === "built") {
      logBuilt(result);
      continue;
    }

    // The contracts board: finished and newly posted contracts.
    if (result.kind === "contract") {
      logContract(result);
      logLevelUps(result.skillId, result.newLevels);   // Diplomacy
      continue;
    }
    if (result.kind === "posted") {
      logPosted(result);
      continue;
    }

    const ship = findShip(state, result.shipId);
    if (result.kind === "mining") {
      const itemName = ITEMS[result.itemId].name.toLowerCase();
      // On a charter, say how much went to the client.
      const toClient = result.chartered > 0 ? `, ${formatTonnes(result.chartered)} of it for its charter` : "";
      addLog(`${ship.name} docked with ${formatTonnes(result.amount)} of ${itemName}${toClient} (+${formatXp(result.xpGained)} Mining XP).`, "trip");
    } else if (result.kind === "haul") {
      addLog(`${ship.name} sold ${describeCargo(result.cargo)} at ${HUB.name} for ${formatNumber(result.credits)} cr (+${formatXp(result.xpGained)} Trade XP).`, "trade");
    } else if (result.kind === "docked" && result.skillId === "exploration") {
      addLog(`${ship.name} docked at ${HOME.name}, its scan unfinished. Standing by.`, "explore");
    } else if (result.kind === "docked") {
      addLog(result.returnedCargo
        ? `${ship.name} docked at ${HOME.name}; ${describeCargo(result.returnedCargo)} back in the hold. Standing by.`
        : `${ship.name} docked at ${HOME.name}. Standing by.`, "trip");
    }
    if (result.kind !== "docked") {   // docking earns no XP
      logLevelUps(result.skillId, result.newLevels);
    }
  }

  announceReadyContracts();
  announceReadySurveys();
  render(state, now);
}

// -------------------------------------------------------------
// logBuilt(result)
// A ship finished on a slipway joins the fleet: rebuild the ship
// cards (the fleet changed) and say so in the log.
// -------------------------------------------------------------
function logBuilt(result) {
  const ship = findShip(state, result.shipId);
  buildFleetViews(state, actions);
  if (ship) {
    addLog(`${ship.name} (${SHIP_TYPES[ship.type].name}) launched from the slipway. Docked at ${HOME.name}, awaiting orders.`, "fleet");
  }
}

// -------------------------------------------------------------
// announceReadyContracts()
// A banner drops down when a contract is ready to hand in (Dan,
// 30 Oct), once per contract: "contract.announced" remembers it
// (in the save, so a refresh doesn't announce it again). Several
// at once share one banner.
// -------------------------------------------------------------
function announceReadyContracts(showBanner = true) {
  const ready = [];
  state.contracts.slots.forEach((slot, index) => {
    const contract = slot.contract;
    if (contract && !contract.announced && isReady(state, index)) {
      contract.announced = true;
      ready.push(contract);
    }
  });
  if (ready.length === 0) return;

  const titles = ready.map((contract) => `${CONTRACT_KINDS[contract.kindId].title} for ${contract.client.toLowerCase()}`);
  for (const title of titles) {
    addLog(`Contract ready to hand in: ${title}. Find it on the Contracts tab.`, "contract");
  }
  if (!showBanner) return;   // (the welcome-back pop-up lists them instead)
  showLevelBanner(ready.length === 1 ? "Contract ready" : `${ready.length} contracts ready`,
    [...titles, "Hand in on the Contracts tab"], "Contracts");
}

// -------------------------------------------------------------
// announceReadySurveys()
// A banner drops down when a survey is ready to launch (Dan,
// 31 Oct), once per target: "announced" remembers it (in the save,
// so a refresh doesn't say it again). A survey usually opens with
// an Exploration level, and the level-up banner already lists it
// (logLevelUps marks those as announced), so this one catches the
// rest: a wreck stage that opens when the stage before it is done.
// Several at once share one banner.
// -------------------------------------------------------------
function announceReadySurveys(showBanner = true) {
  const announced = state.exploration.announced;
  const fresh = getReadySurveys(state).filter((targetId) => !announced[targetId]);
  if (fresh.length === 0) return;

  const names = fresh.map((targetId) => getTarget(targetId).name);
  for (const targetId of fresh) {
    announced[targetId] = true;
  }
  for (const name of names) {
    addLog(`Survey ready to launch: ${name}. Launch it from the Exploration tab when you're ready to read what's there.`, "explore");
  }
  if (!showBanner) return;   // (the welcome-back pop-up lists them instead)
  showLevelBanner(fresh.length === 1 ? "Survey ready" : `${fresh.length} surveys ready`,
    [...names, "Launch on the Exploration tab"], "Exploration");
}

// -------------------------------------------------------------
// surveyUnlockLine(targetId)
// What a level-up says about a survey target that opens at that
// level: ready to launch now, or still waiting for the target
// before it (a wreck stage whose earlier stage isn't done).
// Ready ones are marked as announced, so the "Survey ready"
// banner doesn't say it a second time.
// -------------------------------------------------------------
function surveyUnlockLine(targetId) {
  const target = getTarget(targetId);
  if (getTargetStatus(state, targetId) === "available") {
    state.exploration.announced[targetId] = true;
    return `Survey ready to launch: ${target.name} (Exploration tab)`;
  }
  return `New survey target: ${target.name} (after ${getTarget(target.requires).name})`;
}

// -------------------------------------------------------------
// announceFirstSale(wasOpen)
// The very first sale unlocks the Pathfinder and the Exploration
// tab (design doc, Early exploration). Said once, with a banner,
// so the new goal can't be missed.
// -------------------------------------------------------------
function announceFirstSale(wasOpen) {
  if (wasOpen || !isExplorationOpen(state)) return;
  addLog(`First sale made. A ${SHIP_TYPES.pathfinder.name} is now for sale in the Shipyard, and the Exploration tab is open: there's more out there than rock.`, "explore");
  showLevelBanner("Exploration", [
    `New ship: ${SHIP_TYPES.pathfinder.name} (Shipyard)`,
    "New: the Exploration tab",
  ], "Unlocked");
}

// -------------------------------------------------------------
// logScoutResult(result)
// Log lines for a scout's trips, e.g.
//   "Wayfarer surveyed the Inner Belt survey: found an abandoned
//    prospector's cache, 400 cr (+85 Exploration XP)."
//   then the find's line of lore, and a line per deep scan find.
// -------------------------------------------------------------
function logScoutResult(result) {
  const ship = findShip(state, result.shipId);
  const lines = [];   // the trip lines, before the lore
  for (const targetId of result.surveys) {
    const target = getTarget(targetId);
    lines.push(`${ship.name} surveyed ${target.name}: found ${target.find}, ${describeFind(target)}`);
  }
  if (result.deepScans > 0) {
    const scans = result.deepScans === 1 ? "a deep scan" : result.deepScans + " deep scans";
    const deepFinds = result.finds.filter((find) => find.targetId === DEEP_SCAN_ID);
    const found = deepFinds.length === 0 ? "nothing new" : "found " + deepFinds.map(describeFind).join(" and ");
    lines.push(`${ship.name} finished ${scans}: ${found}`);
  }
  // The XP goes on the end of the last line, e.g. "(+85 Exploration XP)."
  lines[lines.length - 1] += ` (+${formatXp(result.xpGained)} Exploration XP)`;
  for (const line of lines) {
    addLog(line + ".", "explore");
  }
  // Then each survey's line of lore, and the report pop-up
  for (const targetId of result.surveys) {
    addLog(getTarget(targetId).lore, "lore");
  }
  // A survey that opens a mining field (the Ice moon) says so,
  // with a banner, because it's a new place to send the barges.
  for (const targetId of result.surveys) {
    for (const field of Object.values(FIELDS)) {
      if (field.survey !== targetId) continue;
      const ore = ITEMS[field.yields];
      addLog(`The ${field.name} is open for mining: ${ore.name.toLowerCase()}, ${ore.sellPrice} cr/t at home. Pick it as a barge's destination.`, "level");
      showLevelBanner(`${field.name} open for mining`, [`${ore.name}: ${ore.sellPrice} cr/t (Command tab)`], "Unlocked");
    }
  }
  showSurveyReport(surveyEntries(result.surveys));
  logLevelUps(result.skillId, result.newLevels);
}

// -------------------------------------------------------------
// logContract(result) and logPosted(result)
// Log lines for the contracts board, e.g.
//   "Contract complete: ore requisition for a belt co-op. +1,130 cr,
//    +10 reputation with the belt independents."
//   "New contract: Mining quota. The Kessler hauling crew wants ..."
// Reaching a new reputation tier also gets a banner.
// -------------------------------------------------------------
function logContract(result) {
  const contract = result.contract;
  const title = CONTRACT_KINDS[contract.kindId].title.toLowerCase();
  const faction = CONTRACT_FACTIONS[contract.faction];   // who posted it
  addLog(`Contract complete: ${title} for ${contract.client.toLowerCase()}. +${formatNumber(result.credits)} cr, ` +
    `+${result.reputation} reputation with the ${faction.name.toLowerCase()} (+${formatXp(result.xpGained)} Diplomacy XP).`, "contract");
  if (result.tierAfter !== result.tierBefore) {
    addLog(`The ${faction.name.toLowerCase()} now count you as ${result.tierAfter}. Their contracts get bigger, and pay more.`, "level");
    showLevelBanner(`${faction.name}: ${result.tierAfter}`, ["Bigger contracts, better pay (Contracts tab)"], "Reputation");
  }
}

function logPosted(result) {
  const kind = CONTRACT_KINDS[result.contract.kindId];
  addLog(`New contract: ${kind.title}. ${describeContract(result.contract, formatTonnes)}`, "contract");
}

// -------------------------------------------------------------
// surveyEntries(targetIds)
// What the survey report pop-up (report.js) shows for each survey:
//   { title: "Ice moon",
//     find: "Found an old fuel depot's unclaimed balance: 800 cr",
//     lore: "Thick ice under a thin crust. ..." }
// -------------------------------------------------------------
function surveyEntries(targetIds) {
  return targetIds.map((targetId) => {
    const target = getTarget(targetId);
    // "Found an abandoned ...": capital F, then the find's own words
    return { title: target.name, find: `Found ${target.find}: ${describeFind(target)}`, lore: target.lore };
  });
}

// refresh() - redraw straight away after a button press, and
// save, so the action is never lost if the tab closes.
function refresh() {
  announceReadyContracts();
  announceReadySurveys();
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
// preview: for the Skills screen's "Coming up" list, which looks
// at levels not reached yet. Survey lines then just name the
// target: surveyUnlockLine marks a survey as announced, which
// must only happen when the level really arrives.
// -------------------------------------------------------------
function getUnlockLines(skillId, level, withPerk = true, preview = false) {
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
    if (level === CONTRACTS.openAtMiningLevel) {
      lines.push("New: contracts from the belt independents (Contracts tab)");
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
  if (skillId === "exploration") {
    for (const targetId of getTargetUnlocksAtLevel(level)) {
      lines.push(preview ? "New survey target: " + getTarget(targetId).name : surveyUnlockLine(targetId));
    }
  }
  if (skillId === "diplomacy" && CONTRACTS.slotLevels.includes(level)) {
    lines.push("A new slot on the contracts board");
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
  // Diplomacy has no every-level perk: say how big the board is.
  if (!SKILLS[skillId].perk) {
    const slots = CONTRACTS.slots + CONTRACTS.slotLevels.filter((needed) => level >= needed).length;
    return `the contracts board holds ${slots} contracts`;
  }
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
      if (level === CONTRACTS.openAtMiningLevel) {
        const first = Object.values(CONTRACT_FACTIONS)[0];   // the faction that posts first
        addLog(`Word of your outfit has reached the ${first.name.toLowerCase()}: they're posting contracts. Find them on the Contracts tab.`, "level");
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
    if (skillId === "exploration") {
      for (const targetId of getTargetUnlocksAtLevel(level)) {
        const target = getTarget(targetId);
        addLog(getTargetStatus(state, targetId) === "available"
          ? `New survey target: ${target.name}. Launch it from the Exploration tab when you're ready; until then your scouts keep deep scanning.`
          : `New survey target: ${target.name}. It opens once ${getTarget(target.requires).name} is surveyed.`, "level");
      }
    }
    if (skillId === "diplomacy" && CONTRACTS.slotLevels.includes(level)) {
      addLog("The contracts board has room for one more contract. A new one will be posted straight away.", "level");
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
// reportOfflineProgress(report, opening)
// What the player sees after time away (agreed 5 Nov).
//
//   - Under 10 minutes: one line in the log, and level-ups
//     announced as usual (log lines and banners).
//   - 10 minutes or more: the welcome-back pop-up
//     (welcome-popup.js), with Needs attention first, one line
//     per role, and the level-ups with every unlock on the right.
//     The log keeps one line as a record.
//
// "opening" is for the dev panel's jump ("Playtest: jumped ahead
// 1 hour."): it always gets the pop-up, whatever the length.
// -------------------------------------------------------------
function reportOfflineProgress(report, opening = null) {
  // Ignore tiny gaps, like a quick page refresh.
  if (report.secondsAway < 10) {
    return;
  }

  // Add everything up by role (welcome-back.js).
  const summary = summariseTimeAway(report.results);

  // --- The heading: time away and the Treasury change ---
  const away = formatDuration(report.secondsAway * 1000);
  const treasury = `Treasury ${formatSignedCredits(report.creditsAfter - report.creditsBefore)}`;

  // Small notes in brackets after the time away
  const notes = [];
  if (!opening && state.clock.speed !== 1) {
    // Time away is GAME time, so at a playtest speed say so.
    notes.push(`game time, at ${state.clock.speed}× speed`);
  }
  if (report.secondsCounted < report.secondsAway) {
    notes.push(`only ${RULES.offlineCapHours}h counted`);
  }
  const noteText = notes.length > 0 ? ` (${notes.join("; ")})` : "";

  // --- Things that happen whichever way it's shown ---

  // Ships launched from a slipway while away: the ship cards
  // need rebuilding, because the fleet is different now.
  if (summary.shipyard.built.length > 0) {
    buildFleetViews(state, actions);
  }

  // Each survey finished while away keeps its line of lore in
  // the log (its report pop-up comes after, see below).
  for (const targetId of summary.exploration.surveys) {
    addLog(getTarget(targetId).lore, "lore");
  }

  // A new reputation tier reached while away: a log line (the
  // pop-up's Contracts line says it too, so no banner).
  for (const { faction, tier } of summary.contracts.tiers) {
    addLog(`The ${CONTRACT_FACTIONS[faction].name.toLowerCase()} now count you as ${tier}. Their contracts get bigger, and pay more.`, "level");
  }

  // The one-line record in the log, e.g.
  // "Back after 9h 42m: Treasury +184,300 cr. Reached Mining 23, Refining 15."
  const reached = Object.entries(summary.levels).map(([skillId, entry]) => `${SKILLS[skillId].name} ${entry.to}`);
  const reachedText = reached.length > 0 ? `. Reached ${reached.join(", ")}` : "";
  addLog(`${opening ? opening.replace(/\.$/, "") : "Back after " + away}${noteText}: ${treasury}${reachedText}.`, "system");

  // The survey reports, one per survey (report.js)
  const showSurveyReports = () => showSurveyReport(surveyEntries(summary.exploration.surveys));

  // --- A short gap: no pop-up ---
  if (!opening && report.secondsAway < WELCOME_BACK_SECONDS) {
    for (const result of report.results) {
      logLevelUps(result.skillId, result.newLevels);   // log lines + banners, as when playing
    }
    showSurveyReports();
    announceReadyContracts();
    announceReadySurveys();
    return;
  }

  // --- A long gap: the pop-up ---
  // The level-ups are worked out first: getUnlockLines marks any
  // survey that opened with a level as announced.
  const levels = describeLevelUps(summary.levels);
  const attention = getAttentionLines(summary);

  // Ready contracts and surveys are in Needs attention, so they
  // only get their log lines, not a banner hidden behind the pop-up.
  announceReadyContracts(false);
  announceReadySurveys(false);

  showWelcomeBack({
    title: opening ? "Playtest jump" : "Welcome back, commander",
    subtitle: `Away ${away}${noteText} · ${treasury}`,
    attention: attention,
    roles: describeRoles(summary),
    levels: levels,
    onClose: showSurveyReports,   // survey reports wait their turn
  });
}


// -------------------------------------------------------------
// getAttentionLines(summary)
// The "Needs attention" box: anything waiting on the player
// right now. Each line says where to go, e.g.
//   "Workshop slot 2 ran out of orders (Industry tab)"
// -------------------------------------------------------------
function getAttentionLines(summary) {
  const lines = [];

  // Ships sitting at the station with no orders (recalled ones,
  // and new ships fresh off the slipway). Same count as the amber
  // group headings on Command.
  const docked = getRoleGroups(state, gameNow(state))
    .reduce((total, group) => total + group.counts.docked, 0);
  if (docked > 0) {
    lines.push(`${docked === 1 ? "1 ship is" : docked + " ships are"} docked, awaiting orders (Command tab)`);
  }

  // Workshop slots whose queue ran out while away
  for (const slotNumber of summary.industry.idleSlots) {
    lines.push(`Workshop slot ${slotNumber} ran out of orders (Industry tab)`);
  }

  // Contracts done and waiting to be handed in
  const ready = state.contracts.slots.filter((slot, index) => slot.contract && isReady(state, index)).length;
  if (ready > 0) {
    lines.push(`${ready === 1 ? "1 contract" : ready + " contracts"} ready to hand in (Contracts tab)`);
  }

  // Surveys waiting to be launched (scouts don't launch them by
  // themselves - Dan, 31 Oct)
  const surveys = getReadySurveys(state).map((targetId) => getTarget(targetId).name);
  if (surveys.length > 0) {
    lines.push(`${surveys.length === 1 ? "Survey" : "Surveys"} ready to launch: ${surveys.join(", ")} (Exploration tab)`);
  }

  return lines;
}


// -------------------------------------------------------------
// describeRoles(summary)
// One short line per role that did something, e.g.
//   { name: "Mining", detail: "41 trips · 3.8 kt iron ore, 1.1 kt nickel ore" }
// Roles that did nothing are left out.
// -------------------------------------------------------------
function describeRoles(summary) {
  const roles = [];

  if (hasActivity("mining", summary)) {
    const m = summary.mining;
    roles.push({ name: "Mining", detail: `${plural(m.trips, "trip")} · ${describeGoods(m.ore)}` });
  }

  if (hasActivity("freight", summary)) {
    const f = summary.freight;
    roles.push({ name: "Freight", detail: `${plural(f.runs, "run")} to ${HUB.name} · ${describeGoods(f.sold)} sold for ${formatNumber(f.credits)} cr` });
  }

  if (hasActivity("industry", summary)) {
    const parts = [];
    if (Object.keys(summary.industry.refined).length > 0) parts.push("Refinery: " + describeGoods(summary.industry.refined));
    if (Object.keys(summary.industry.made).length > 0) parts.push("Workshop: " + describeGoods(summary.industry.made));
    roles.push({ name: "Station industry", detail: parts.join(" · ") });
  }

  if (hasActivity("exploration", summary)) {
    const e = summary.exploration;
    const parts = [];
    if (e.deepScans > 0) parts.push(plural(e.deepScans, "deep scan"));
    if (e.surveys.length > 0) parts.push("surveyed " + e.surveys.map((targetId) => getTarget(targetId).name).join(", "));
    if (e.finds.length > 0) parts.push("found " + listWithMore(e.finds.map(describeFind)));
    roles.push({ name: "Exploration", detail: parts.join(" · ") });
  }

  if (hasActivity("contracts", summary)) {
    const c = summary.contracts;
    const parts = [];
    if (c.done > 0) parts.push(`${c.done} finished for ${formatNumber(c.paid)} cr`);
    if (c.posted > 0) parts.push(`${c.posted} new on the board`);
    for (const { faction, tier } of c.tiers) {
      parts.push(`now ${tier} with the ${CONTRACT_FACTIONS[faction].name.toLowerCase()}`);
    }
    roles.push({ name: "Contracts", detail: parts.join(" · ") });
  }

  if (hasActivity("shipyard", summary)) {
    // Count each hull type: ["courier", "courier", "excavator"] -> "2 × Courier, Excavator"
    const counts = {};
    for (const typeId of summary.shipyard.built) {
      counts[typeId] = (counts[typeId] || 0) + 1;
    }
    const names = Object.entries(counts).map(([typeId, count]) =>
      (count > 1 ? `${count} × ` : "") + SHIP_TYPES[typeId].name);
    roles.push({ name: "Shipyard", detail: "Launched: " + names.join(", ") });
  }

  return roles;
}


// -------------------------------------------------------------
// describeLevelUps(levels)
// The right-hand side of the pop-up: per skill, the levels
// gained, each level's unlocks, and the perk it's at now, e.g.
//   { heading: "Mining 21 → 23",
//     lines: ["22: New ship component (Shipyard): Excavator drill Mk II"],
//     perk: "Perk now: +11.5% drill speed" }
// Skills come in the same order as the Skills tab.
// -------------------------------------------------------------
function describeLevelUps(levels) {
  return Object.keys(SKILLS)
    .filter((skillId) => levels[skillId])
    .map((skillId) => {
      const entry = levels[skillId];

      // Every unlock on the way, one line each, with its level
      // (levels with no unlock just give their perk, so they
      // add no line).
      const lines = entry.levels.flatMap((level) =>
        getUnlockLines(skillId, level, false).map((line) => `${level}: ${line}`));

      // The perk at the level reached. Diplomacy has no perk,
      // so it says how big the contracts board is instead.
      const perk = SKILLS[skillId].perk
        ? `Perk now: +${formatPercent(getLevelPerk(state, skillId, entry.to).total)} ${SKILLS[skillId].perk}`
        : `Now: ${perkLine(skillId, entry.to)}`;

      return { heading: `${SKILLS[skillId].name} ${entry.from} → ${entry.to}`, lines, perk };
    });
}


// -------------------------------------------------------------
// Small wording helpers for the report
// -------------------------------------------------------------

// { iron_ore: 3800, nickel_ore: 1100 } -> "3.8 kt iron ore, 1.1 kt nickel ore"
// (the biggest three, largest first, then "and 2 more")
function describeGoods(amounts) {
  const { shown, more } = largestFirst(amounts);
  const text = shown.map(([itemId, amount]) => `${formatTonnes(amount)} ${ITEMS[itemId].name.toLowerCase()}`).join(", ");
  return more > 0 ? `${text} and ${more} more` : text;
}

// ["a", "b", "c", "d", "e"] -> "a, b, c and 2 more"
function listWithMore(items) {
  const shown = items.slice(0, 3).join(", ");
  return items.length > 3 ? `${shown} and ${items.length - 3} more` : shown;
}

// plural(1, "trip") -> "1 trip";  plural(41, "trip") -> "41 trips"
function plural(count, word) {
  return `${formatNumber(count)} ${word}${count === 1 ? "" : "s"}`;
}

// 184300 -> "+184,300 cr";  -2500 -> "−2,500 cr";  0 -> "unchanged"
// (a real minus sign, which lines up better than a hyphen)
function formatSignedCredits(change) {
  if (change === 0) return "unchanged";   // reads better than "+0 cr"
  return change < 0 ? `−${formatNumber(-change)} cr` : `+${formatNumber(change)} cr`;
}


// -------------------------------------------------------------
// 2. Set up the screen.
// -------------------------------------------------------------
setupUI(state, actions);

// The live system map on the Command screen (system-map.js).
// It's given a function rather than the game itself, because an
// import or reset swaps in a new game and the map must follow.
// Tapping a ship on the map scrolls to that ship's card, and
// opens its role group if the player had closed it.
setupSystemMap(() => state, (shipId) => {
  const card = document.getElementById("ship-" + shipId);
  if (!card) return;
  const group = card.closest("details");
  if (group) group.open = true;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  // A brief highlight, so the eye finds it
  card.classList.add("flash");
  setTimeout(() => card.classList.remove("flash"), 1200);
});

// The viewscreens on Industry and Exploration (3 Nov). The
// Exploration one's Launch survey button uses the same action
// as the buttons in the target list.
setupIndustryView(() => state);
setupExplorationView(() => state, actions);
setupContractsView(() => state, actions);
setupSkillsView(() => state, (skillId, level) => getUnlockLines(skillId, level, false, true));
setupShipyardView(() => state, actions);

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
