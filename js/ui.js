// =============================================================
// js/ui.js
// -------------------------------------------------------------
// THE SCREEN: showing the state, and turning button clicks
// into game actions.
//
// This file never changes the state itself. When a button is
// clicked, it calls an "action" function that main.js gave it.
// Keeping drawing and game rules apart means we can redesign
// the screen without breaking the game, and vice versa.
//
// The pattern used throughout:
//   build...()  makes the HTML for something ONCE
//   render()    runs 4 times a second and only updates the
//               words and numbers inside what was built
// (Rebuilding everything 4 times a second would make buttons
// flicker and sometimes swallow clicks.)
// =============================================================

import { ITEMS, SHIP_TYPES, FIELDS, SKILLS, HULL_SIZES, COMMAND, HUB, HOME, HAUL_MODES, RECIPES, REFINERY, WORKSHOP_RECIPES, WORKSHOP, UPGRADES, SHIP_UPGRADES, SHIP_PARTS } from "../data/content.js";
import { isOwned, isShown, canBuyIndustryUpgrade } from "./upgrades.js";
import { gameNow, SPEEDS } from "./clock.js";
import { getShipStats, getHullParts, getPartGrade, getPartBonus, getNextUpgrade, canBuyShipUpgrade, getUpgradeName, getHullShortName, findUpgrade, getBonusUpTo, getShipGrades, getPendingRefits } from "./ship-upgrades.js";
import { getJobForShip, getJobPhase, getTripPlan, getHaulPlan, getOreInHold, getMiningXpShare } from "./jobs.js";
import { getLevel, getLevelProgress, isShipTypeUnlocked, isFieldUnlocked, getMiningDrillPerk, getTradeHubPerk, getLevelPerk } from "./skills.js";
import { canBuyShip, canSellShip, getSellValue, getShipPrice, MAX_NAME_LENGTH } from "./shipyard.js";
import { getShipPoints, getCommandCapacity, getCommandUsed, getNextUpgradeCost, canBuyUpgrade } from "./command.js";
import { getCargoValue, getTradeXp } from "./trade.js";
import { getBond, getSellable, getBondedInHold } from "./bonded.js";
import { getShipArt } from "./art.js";
import { getRoleGroups, describeGroup } from "./fleet-groups.js";
import { isRefineryOpen, getRefineJob, getSlotCount, getSlotUnlockLevel, isRecipeUnlocked, getBatchMs, getBatchOutput, hasInputs, describeInputs, getMaxSlots } from "./refinery.js";
import { isWorkshopOpen, getWorkshopSlotCount, getWorkshopSlotUnlockLevel, getQueueLimit, isWorkshopRecipeUnlocked, getWorkshopBatchMs, getWorkshopJob, hasWorkshopInputs, describeWorkshopInputs, getMaxOrderBatches, getRunningIndex, hasSmartQueue, hasControlCentre, getStandingOrders, standingNeedsWork } from "./workshop.js";

// The screens that exist, in nav order. The first is the default.
const SCREENS = ["command", "fleet", "shipyard", "industry", "skills"];

// Words shown for each phase of a trip.
const PHASE_LABELS = {
  outbound: "Outbound",
  mining: "Mining",
  trading: "Trading",
  returning: "Returning",
  waiting: "Waiting for cargo",
};


// -------------------------------------------------------------
// escapeHtml(text)
// Players can type ship names, and a name goes inside HTML we
// build as text. A name like "<b>Bold</b>" would be read as
// HTML and break the card (or worse, in a save someone shares).
// This swaps the special characters for their "safe" versions,
// so the name always shows exactly as typed.
// -------------------------------------------------------------
function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")    // must go first
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}


// Shortcut: find an element on the page by its id="..." name.
function byId(id) {
  return document.getElementById(id);
}

// Shortcut: find a labelled part inside a card.
// e.g. part(card, "status") finds <div data-part="status">
function part(card, name) {
  return card.querySelector(`[data-part="${name}"]`);
}


// =============================================================
// SET-UP (runs once)
// =============================================================

// -------------------------------------------------------------
// setupUI(state, actions)
// Connects all the buttons and builds the parts of the page
// that are made from game data.
//
// "actions" is an object of functions from main.js, e.g.
//   actions.sellCargo()   actions.dispatchShip(shipId)
// -------------------------------------------------------------
export function setupUI(state, actions) {
  setupNavigation();
  setupResetButton(actions);
  setupBackup(actions);

  byId("sell-all").addEventListener("click", () => actions.sellCargo());
  byId("command-upgrade").addEventListener("click", () => actions.buyCommandUpgrade());

  buildCargoTable(actions);
  buildFleetViews(state, actions);
  buildShipyard(actions);
  buildSkillCards();
  buildRefinery(actions);
  buildWorkshop(actions);
  buildUpgrades(actions);
  buildStationHold(actions);
  buildComponents(actions);
  buildDevPanel(actions);
  setupHardpointTips();
}


// -------------------------------------------------------------
// NAVIGATION
// The screen name goes in the address bar after a # (like
// index.html#ships), so refreshing keeps you on the same screen
// and the browser's Back button works.
// -------------------------------------------------------------
function setupNavigation() {
  // Clicking a nav button switches screen straight away, and
  // also updates the # part of the address so refresh and the
  // Back button know where you are.
  for (const button of document.querySelectorAll(".nav-btn")) {
    button.addEventListener("click", () => {
      const name = button.dataset.screen;   // dataset.screen = data-screen="..."
      showScreen(name);
      location.hash = name;
    });
  }

  // When the # changes some other way (the Back button, or
  // typing it in the address bar), show the matching screen.
  window.addEventListener("hashchange", showScreenFromAddress);

  // Show the right screen straight away on page load.
  showScreenFromAddress();
}

function showScreenFromAddress() {
  // location.hash is "#fleet"; .slice(1) drops the "#".
  let name = location.hash.slice(1);

  // Old bookmarks to the Ships screen go to Fleet now.
  if (name === "ships") {
    name = "fleet";
  }

  // Unknown or empty? Fall back to the first screen.
  if (!SCREENS.includes(name)) {
    name = SCREENS[0];
  }
  showScreen(name);
}

export function showScreen(name) {
  // Show the matching screen and hide the others.
  // ("hidden" is a built-in HTML switch for hiding things.)
  for (const screen of document.querySelectorAll(".screen")) {
    screen.hidden = screen.dataset.screen !== name;
  }

  // Highlight the matching nav button.
  for (const button of document.querySelectorAll(".nav-btn")) {
    const isCurrent = button.dataset.screen === name;
    button.classList.toggle("active", isCurrent);
    // aria-current tells screen readers which page is open
    if (isCurrent) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  }
}


// -------------------------------------------------------------
// TWO-CLICK BUTTONS
// For things that can't be undone (reset, selling a ship), the
// first click "arms" the button and changes its text; a second
// click within 4 seconds does it. We don't use the browser's
// confirm() pop-up because some places (like embedded previews)
// block it.
//
// armedText:  what the button says while armed
// onConfirm:  what to do on the second click
// normalText: (optional) what to change the text back to when
//             it disarms - for buttons render() doesn't rewrite
// Returns a function that puts the button back to normal.
// -------------------------------------------------------------
function makeTwoClick(button, armedText, onConfirm, normalText = null) {
  let armed = false;
  let timer = null;

  function disarm() {
    armed = false;
    clearTimeout(timer);
    button.classList.remove("armed");
    if (normalText) {
      button.textContent = normalText;
    }
  }

  button.addEventListener("click", () => {
    if (!armed) {
      armed = true;
      button.classList.add("armed");
      button.textContent = armedText;
      // If they don't click again in time, put the button back.
      // (render() rewrites the normal text on its next pass.)
      timer = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    onConfirm();
  });

  return disarm;
}

// Is this button waiting for its second click?
function isArmed(button) {
  return button.classList.contains("armed");
}

function setupResetButton(actions) {
  const resetButton = byId("reset-game");
  makeTwoClick(resetButton, "Click again to wipe your save", () => {
    resetButton.textContent = "Reset save";
    actions.resetGame();
  });
}


// -------------------------------------------------------------
// SAVE BACKUP: export, download, import, load from a file.
// -------------------------------------------------------------
function setupBackup(actions) {
  const textBox = byId("backup-text");
  const fileInput = byId("save-file");

  // A message under the buttons; isError turns it red.
  function say(message, isError = false) {
    const line = byId("backup-message");
    line.textContent = message;
    line.classList.toggle("error", isError);
  }

  // EXPORT: put the save text in the box, and try to copy it.
  byId("export-save").addEventListener("click", async () => {
    const text = actions.exportSave();
    textBox.value = text;
    textBox.select();   // highlight it, ready to copy by hand if needed

    // The clipboard can be blocked (some browsers, some pages),
    // so "try" it and fall back to asking the player to copy.
    // "await" waits for the copy to finish before carrying on.
    try {
      await navigator.clipboard.writeText(text);
      say("Save copied to your clipboard. Paste it somewhere safe.");
    } catch (error) {
      say("Save exported. Select the text above and copy it (Ctrl+C).");
    }
  });

  // DOWNLOAD: the same text, saved as a .txt file.
  byId("download-save").addEventListener("click", () => {
    const text = actions.exportSave();
    textBox.value = text;

    // A "Blob" is a file made in memory. We make a temporary
    // link to it and click it, which makes the browser download it.
    const file = new Blob([text], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    // e.g. damocles-save-2026-10-28.txt
    link.download = "damocles-save-" + new Date().toISOString().slice(0, 10) + ".txt";
    link.click();
    URL.revokeObjectURL(link.href);   // tidy up the temporary link
    say("Save downloaded as " + link.download + ".");
  });

  // LOAD FILE: open the file picker; the chosen file's text goes
  // into the box, ready to import.
  byId("choose-file").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    textBox.value = await file.text();
    fileInput.value = "";   // so picking the same file again still works
    say("File loaded. Click Import to replace your current game with it.");
  });

  // IMPORT: replaces the current game, so it needs two clicks.
  const importButton = byId("import-save");
  makeTwoClick(importButton, "Click again to replace your game", () => {
    const result = actions.importSave(textBox.value);
    if (result.ok) {
      textBox.value = "";
      say("Save imported. Welcome back, commander.");
    } else {
      say(result.reason, true);
    }
  }, "Import");
}


// -------------------------------------------------------------
// statsBox(typeId)
// An empty box for a ship type's stat block. render() fills it
// with statsList() and refills it whenever the stats change (an
// upgrade, or a level that raises a perk). Used for owned ships
// and the shipyard, so they always match and can be compared.
// -------------------------------------------------------------
function statsBox(typeId) {
  return `<div class="stats-box" data-stats="${typeId}"></div>`;
}

// -------------------------------------------------------------
// renderStatsBoxes(state)
// Refills every stat box whose numbers have changed. Each box
// remembers a "key" made from the ship's stats and the levels
// that feed them; if the key is the same as last time, nothing
// is redrawn (rebuilding HTML 4 times a second would be wasteful
// and would reset anything the player had scrolled).
// -------------------------------------------------------------
function renderStatsBoxes(state) {
  for (const box of document.querySelectorAll("[data-stats]")) {
    const typeId = box.dataset.stats;
    const key = JSON.stringify(getShipStats(state, typeId)) +
      getLevel(state, "trade") + "/" + getLevel(state, "mining");
    if (box.dataset.key !== key) {
      box.dataset.key = key;
      box.innerHTML = statsList(state, typeId);
    }
  }

  // Ship drawings (with hardpoint markers) and parts lists change
  // only when a component is fitted, so their key is the grades.
  for (const box of document.querySelectorAll("[data-art]")) {
    const typeId = box.dataset.art;
    const grades = getGrades(state, typeId);
    const key = JSON.stringify(grades);
    if (box.dataset.key !== key) {
      box.dataset.key = key;
      box.innerHTML = getShipArt(SHIP_TYPES[typeId].art, grades, getPartLabels(state, typeId));
    }
  }
  // One ship's drawing, parts list and stats: what IT has fitted
  // now, plus anything bought but waiting for it to dock.
  for (const ship of state.ships) {
    const fitted = getShipGrades(state, ship);
    const pending = getPendingRefits(state, ship);
    const key = JSON.stringify([fitted, pending]);
    const statsKey = key + JSON.stringify(getShipStats(state, ship.type, fitted)) +
      getLevel(state, "trade") + "/" + getLevel(state, "mining");

    for (const box of document.querySelectorAll(`[data-ship-art="${ship.id}"]`)) {
      if (box.dataset.key !== key) {
        box.dataset.key = key;
        box.innerHTML = getShipArt(SHIP_TYPES[ship.type].art, fitted,
          getPartLabels(state, ship.type, fitted, pending), pending);
      }
    }
    for (const box of document.querySelectorAll(`[data-ship-parts="${ship.id}"]`)) {
      if (box.dataset.key !== key) {
        box.dataset.key = key;
        box.innerHTML = partsList(state, ship.type, fitted, pending);
      }
    }
    for (const box of document.querySelectorAll(`[data-ship-stats="${ship.id}"]`)) {
      if (box.dataset.key !== statsKey) {
        box.dataset.key = statsKey;
        box.innerHTML = statsList(state, ship.type, fitted);
      }
    }
  }
}

// -------------------------------------------------------------
// getGrades(state, typeId)
// The grade fitted to each of a hull's components, e.g.
//   { drill: 1, hold: 0, drive: 2 }     (0 = stock)
// -------------------------------------------------------------
function getGrades(state, typeId) {
  const grades = {};
  for (const partId of getHullParts(typeId)) {
    grades[partId] = getPartGrade(state, typeId, partId);
  }
  return grades;
}

// -------------------------------------------------------------
// getPartLabels(state, typeId)
// What hovering each hardpoint says, as [title, detail], e.g.
//   drill: ["Drill", "Mk II fitted · +30% mining rate"]
//   hold:  ["Cargo hold", "Stock part · nothing fitted yet"]
// -------------------------------------------------------------
// "grades" (optional): one ship's fitted parts; "pending": parts
// bought but waiting for it to dock, e.g. { drill: 2 }, which add
//   "Mk II waiting: fitted when it docks"
function getPartLabels(state, typeId, grades = getGrades(state, typeId), pending = {}) {
  const labels = {};
  for (const partId of getHullParts(typeId)) {
    const grade = grades[partId] || 0;
    const name = SHIP_PARTS[partId].name;
    let detail;
    if (grade === 0) {
      detail = "Stock part";
    } else {
      const bonus = getBonusUpTo(typeId, partId, grade);
      const gradeName = findUpgrade(typeId, partId, grade).gradeName;
      detail = `${gradeName} fitted · +${formatPercent(bonus)} ${SHIP_PARTS[partId].says}`;
    }
    if (partId in pending) {
      detail += ` · ${findUpgrade(typeId, partId, pending[partId]).gradeName} waiting: fitted when it docks`;
    } else if (grade === 0) {
      detail += " · nothing fitted yet";
    }
    labels[partId] = [name, detail];
  }
  return labels;
}


// -------------------------------------------------------------
// setupHardpointTips()
// One tooltip box for every hardpoint on every drawing. It's
// "delegated": a single listener on the whole page checks
// whether the pointer is over a hardpoint, so drawings that are
// redrawn later (after fitting a component) work without
// setting anything up again.
//   Mouse: hover a marker to show the box, move off to hide it.
//   Touch: tap a marker to show it, tap anywhere else to hide it.
// -------------------------------------------------------------
function setupHardpointTips() {
  const tip = byId("hardpoint-tip");

  function show(marker) {
    tip.querySelector("b").textContent = marker.dataset.tipTitle;
    tip.querySelector("span").textContent = marker.dataset.tip;
    tip.hidden = false;
    // Place the box just above the marker, kept on screen.
    // getBoundingClientRect gives where the marker is drawn now.
    const spot = marker.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    const left = Math.min(Math.max(4, spot.left + spot.width / 2 - box.width / 2),
                          window.innerWidth - box.width - 4);
    const above = spot.top - box.height - 6;
    tip.style.left = left + "px";
    // No room above (top of the screen)? Put it below instead.
    tip.style.top = (above > 4 ? above : spot.bottom + 6) + "px";
  }
  function hide() {
    tip.hidden = true;
  }

  // .closest(".hardpoint") finds the marker the pointer is in,
  // even when it's over the ring or the numeral inside it.
  // Hover is for a real MOUSE only (pointerType "mouse"): a
  // touch screen also fires pretend mouse events around a tap,
  // and their "pointer left" would hide the box straight away.
  document.addEventListener("pointerover", (event) => {
    if (event.pointerType !== "mouse") return;
    const marker = event.target.closest && event.target.closest(".hardpoint");
    if (marker && marker.dataset.tipTitle) show(marker);
  });
  document.addEventListener("pointerout", (event) => {
    if (event.pointerType !== "mouse") return;
    const marker = event.target.closest && event.target.closest(".hardpoint");
    if (marker) hide();
  });

  // A tap (or click) on a marker shows it. It must NOT also open or
  // close the card the drawing sits in, so the click is stopped
  // here ("capture": true runs this before the card hears it).
  document.addEventListener("click", (event) => {
    const marker = event.target.closest && event.target.closest(".hardpoint");
    if (marker && marker.dataset.tipTitle) {
      event.preventDefault();
      event.stopPropagation();
      show(marker);
    } else {
      hide();
    }
  }, true);

  // Scrolling moves the drawing out from under the box.
  window.addEventListener("scroll", hide, true);
}


// -------------------------------------------------------------
// partsList(state, typeId)
// A ship's components as a short list, e.g.
//   Drill        Mk I    +15% mining rate
//   Cargo hold   Stock
// -------------------------------------------------------------
// "grades": one ship's fitted parts; "pending": bought but not
// fitted yet, shown as "Mk II waiting (fitted when it docks)".
function partsList(state, typeId, grades, pending = {}) {
  const rows = getHullParts(typeId).map((partId) => {
    const grade = grades[partId] || 0;
    const gradeName = grade === 0 ? "Stock" : findUpgrade(typeId, partId, grade).gradeName;
    const bonus = getBonusUpTo(typeId, partId, grade);
    const waiting = partId in pending
      ? `<span class="part-pending">${findUpgrade(typeId, partId, pending[partId]).gradeName} waiting (fitted when it docks)</span>`
      : "";
    return `
      <li class="${grade > 0 ? "fitted" : ""}">
        <span class="part-name">${SHIP_PARTS[partId].name}</span>
        <span class="part-grade">${gradeName}</span>
        <span class="part-bonus">${bonus > 0 ? "+" + formatPercent(bonus) + " " + SHIP_PARTS[partId].says : ""}</span>
        ${waiting}
      </li>`;
  }).join("");
  return `<ul class="parts-list">${rows}</ul>`;
}

// -------------------------------------------------------------
// bonusTag(bonus)
// A small "+15%" tag after a stat that's been boosted by
// upgrades or a level perk, or nothing when there's no bonus.
// -------------------------------------------------------------
function bonusTag(bonus) {
  if (bonus <= 0) return "";
  return ` <span class="stat-bonus">+${formatPercent(bonus)}</span>`;
}

// -------------------------------------------------------------
// statsList(state, typeId)
// The full stat block for a ship type, as HTML: its hull stats
// (with any bonus shown), then a small table of what a round
// trip to each field gives right now.
// -------------------------------------------------------------
// "grades" (optional): one ship's fitted parts; left out, the
// hull type's current parts (the Shipyard).
function statsList(state, typeId, grades) {
  const shipType = SHIP_TYPES[typeId];
  if (shipType.role === "freight") {
    return freighterStats(state, typeId, grades);
  }
  const sizeName = HULL_SIZES[shipType.size].name;
  const stats = getShipStats(state, typeId, grades);
  // Each part's bonus for these grades (stock = 0).
  const bonusOf = (partId) => grades
    ? getBonusUpTo(typeId, partId, grades[partId] || 0)
    : getPartBonus(state, typeId, partId);
  // The drill's bonus includes the Mining level perk.
  const drillBonus = bonusOf("drill") + getMiningDrillPerk(state);

  // One row per field: trip length, income and XP per hour.
  // data-field lets render() dim the fields that are locked.
  const fieldRows = Object.entries(FIELDS).map(([fieldId, field]) => {
    const plan = getTripPlan(state, typeId, fieldId, grades);
    const price = ITEMS[field.yields].sellPrice;
    const tripsPerHour = (60 * 60 * 1000) / plan.durationMs;

    return `
      <tr data-field="${fieldId}">
        <td>${field.name}</td>
        <td>${formatDuration(plan.durationMs)}</td>
        <td class="stat-hot">${formatNumber(plan.orePerTrip * price * tripsPerHour)}</td>
        <td>${formatNumber(plan.xpPerTrip * tripsPerHour)}</td>
      </tr>
    `;
  }).join("");

  // <dl> is a "description list": pairs of label (dt) and value (dd).
  return `
    <div class="stat-block">
      <dl class="stats">
        <dt>Hull</dt>         <dd>${sizeName} · ${getShipPoints(typeId)} cmd pt${getShipPoints(typeId) === 1 ? "" : "s"}</dd>
        <dt>Cargo hold</dt>   <dd>${formatTonnes(stats.cargoCapacity)}${bonusTag(bonusOf("hold"))}</dd>
        <dt>Mining rate</dt>  <dd>${formatTonnes(Math.round(stats.miningRate))}/min${bonusTag(drillBonus)}</dd>
        <dt>Drive speed</dt>  <dd>${stats.speed.toFixed(2)}×${bonusTag(bonusOf("drive"))}</dd>
        <dt>Unloading</dt>    <dd>${HULL_SIZES[shipType.size].loadingRate} t/s</dd>
      </dl>
      <table class="trip-table">
        <thead>
          <tr><th>Field</th><th>Trip</th><th>cr/h</th><th>XP/h</th></tr>
        </thead>
        <tbody>${fieldRows}</tbody>
      </table>
    </div>
  `;
}


// -------------------------------------------------------------
// freighterStats(state, typeId)
// A freighter's stat block: its hull, then what ONE full run to
// the hub earns for each kind of goods (Trade perk included),
// compared with selling the same load at home.
// -------------------------------------------------------------
function freighterStats(state, typeId, grades) {
  const shipType = SHIP_TYPES[typeId];
  const sizeName = HULL_SIZES[shipType.size].name;
  const stats = getShipStats(state, typeId, grades);
  const plan = getHaulPlan(state, typeId, undefined, grades);
  const bonusOf = (partId) => grades
    ? getBonusUpTo(typeId, partId, grades[partId] || 0)
    : getPartBonus(state, typeId, partId);
  const perk = getTradeHubPerk(state);

  const oreRows = Object.entries(ITEMS).map(([itemId, item]) => {
    const hubCredits = Math.round(plan.capacity * item.hubPrice * (1 + perk));
    const homeCredits = plan.capacity * item.sellPrice;
    return `
      <tr>
        <td>${item.name}</td>
        <td class="stat-hot">${formatNumber(hubCredits)}</td>
        <td>+${formatNumber(hubCredits - homeCredits)}</td>
        <td>${formatXp(getTradeXp(plan.capacity, HUB.travelSeconds))}</td>
      </tr>
    `;
  }).join("");

  return `
    <div class="stat-block">
      <dl class="stats">
        <dt>Hull</dt>         <dd>${sizeName} · ${getShipPoints(typeId)} cmd pt${getShipPoints(typeId) === 1 ? "" : "s"}</dd>
        <dt>Cargo hold</dt>   <dd>${formatTonnes(stats.cargoCapacity)}${bonusTag(bonusOf("hold"))}</dd>
        <dt>Drive speed</dt>  <dd>${stats.speed.toFixed(2)}×${bonusTag(bonusOf("drive"))}</dd>
        <dt>Loading</dt>      <dd>${HULL_SIZES[shipType.size].loadingRate} t/s</dd>
        <dt>Hub run</dt>      <dd>${formatDuration(plan.durationMs)} round trip</dd>
        <dt>Hub prices</dt>   <dd>${perk > 0 ? bonusTag(perk).trim() + " (Trade level)" : "Base"}</dd>
      </dl>
      <table class="trip-table">
        <thead>
          <tr><th>Full load of</th><th>cr</th><th>vs home</th><th>XP</th></tr>
        </thead>
        <tbody>${oreRows}</tbody>
      </table>
    </div>
  `;
}


// -------------------------------------------------------------
// routeTracker()
// The four-part bar showing a trip, in order:
//   barge:      out, mine, back, unload (at home)
//   freighter:  load (at home), out, sell at the hub, back
// Each segment's width and look are set later (setRoute below)
// to match how long that phase takes, so a long mining stop
// LOOKS long and the short loading stops look short.
// -------------------------------------------------------------
function routeTracker() {
  return `
    <div class="route" data-part="route">
      <div class="route-track">
        <div class="seg" data-part="seg-0"><div class="seg-fill"></div></div>
        <div class="seg" data-part="seg-1"><div class="seg-fill"></div></div>
        <div class="seg" data-part="seg-2"><div class="seg-fill"></div></div>
        <div class="seg" data-part="seg-3"><div class="seg-fill"></div></div>
      </div>
      <div class="route-labels">
        <span>Home</span>
        <span class="route-field" data-part="route-field"></span>
        <span>Home</span>
      </div>
    </div>
  `;
}


// -------------------------------------------------------------
// setRoute(card, segments)
// Sizes and styles the four route segments. "segments" lists
// [style, lengthMs] in order, e.g. for a barge:
//   [["out", 45000], ["mine", 60000], ["back", 45000], ["dock", 6000]]
// The style picks the colour (seg-out, seg-mine, seg-back,
// seg-dock in style.css).
// -------------------------------------------------------------
function setRoute(card, segments) {
  segments.forEach(([style, lengthMs], i) => {
    const segment = part(card, "seg-" + i);
    const className = "seg seg-" + style;
    if (segment.className !== className) segment.className = className;
    segment.style.flexGrow = lengthMs;
  });
}


// -------------------------------------------------------------
// destinationPicker()
// A dropdown menu (<select>) of fields, to choose where a ship
// goes. Locked fields are greyed out and show the level they
// need; render() keeps that up to date.
// -------------------------------------------------------------
function destinationPicker() {
  // One <option> per field. "value" is what the code reads;
  // the text between the tags is what the player sees.
  const options = Object.entries(FIELDS).map(([fieldId, field]) => `
    <option value="${fieldId}">${field.name}</option>
  `).join("");

  return `
    <label class="dest-select-row">
      <span class="dest-label">Destination</span>
      <select class="dest-select" data-part="dest">${options}</select>
    </label>
  `;
}


// -------------------------------------------------------------
// haulModePicker()
// Two buttons for a freighter: wait for full loads, or run
// constantly with whatever ore is in the hold.
// (Same look as the destination buttons.)
// -------------------------------------------------------------
function haulModePicker() {
  const buttons = Object.entries(HAUL_MODES).map(([modeId, mode]) => `
    <button class="dest-btn" data-mode="${modeId}">
      <span class="dest-name">${mode.name}</span>
    </button>
  `).join("");

  return `<div class="dest-picker" data-part="modes">${buttons}</div>`;
}


// -------------------------------------------------------------
// buildCargoTable(actions)
// One row per item, each with its own small Sell button.
// -------------------------------------------------------------
function buildCargoTable(actions) {
  const body = byId("cargo-body");
  body.innerHTML = "";

  for (const [itemId, item] of Object.entries(ITEMS)) {
    const row = document.createElement("tr");
    row.id = "cargo-" + itemId;
    row.innerHTML = `
      <td>${item.name}</td>
      <td>
        <!-- The stock, with the bonded amount on its own small line
             underneath (when there is one), so the column stays narrow -->
        <span data-part="stock">0 t</span>
        <span class="bonded-note" data-part="bonded" hidden></span>
      </td>
      <td class="cargo-price">${item.sellPrice}</td>
      <td class="cargo-price cargo-hub">${item.hubPrice}</td>
      <td data-part="value">0 cr</td>
      <td><button class="btn btn-small" data-part="sell">Sell</button></td>
    `;
    part(row, "sell").addEventListener("click", () => actions.sellItem(itemId));
    body.appendChild(row);
  }

  // The station's name, from content.js, on the panel and button.
  byId("home-name-tag").textContent = HOME.name;
  byId("sell-all").textContent = "Sell all at " + HOME.name;

  // The note under the table explains the two prices.
  byId("hub-note").textContent =
    `Selling here is instant at the home price. The ${HUB.name.toLowerCase()} pays the hub price, ` +
    `but needs a freighter to haul the ore there. Only freighters earn Trade XP.`;
}


// -------------------------------------------------------------
// rememberOpenState(details)
// The fleet list is rebuilt whenever a ship is bought or sold,
// which would snap every card shut. This remembers which cards
// were open (by their id) and opens them again after a rebuild.
// -------------------------------------------------------------
const openCards = new Set();   // a Set is a list with no repeats

function rememberOpenState(details) {
  details.open = openCards.has(details.id);
  // "toggle" fires whenever the box opens or closes.
  details.addEventListener("toggle", () => {
    if (details.open) {
      openCards.add(details.id);
    } else {
      openCards.delete(details.id);
    }
  });
}


// -------------------------------------------------------------
// buildFleetViews(state, actions)
// Builds everything that shows the player's own ships:
//   - the ship cards on the Command screen
//   - the "Your fleet" list on the Ships screen
// Called at start-up, and again whenever the fleet changes
// (a ship bought or sold, a reset).
// -------------------------------------------------------------
export function buildFleetViews(state, actions) {
  buildFleetCards(state, actions);
  buildOwnedList(state, actions);
}

// -------------------------------------------------------------
// ROLE GROUPS on the Command screen
// Ship cards sit inside one collapsible box per role (Mining,
// Freight...). Groups start open. If the player closes one, we
// remember that in the browser (localStorage) so it stays
// closed after a refresh. This is a screen preference, not game
// progress, so it lives outside the save.
// -------------------------------------------------------------
const CLOSED_GROUPS_KEY = "damocles-closed-groups";

// Which role groups the player has closed, e.g. ["mining"].
// "try" because some browsers block storage (private windows);
// then we simply start with every group open.
function loadClosedGroups() {
  try {
    return new Set(JSON.parse(localStorage.getItem(CLOSED_GROUPS_KEY)) || []);
  } catch (error) {
    return new Set();
  }
}

function saveClosedGroups(closed) {
  try {
    // A Set can't be saved directly, so turn it into a list first.
    localStorage.setItem(CLOSED_GROUPS_KEY, JSON.stringify([...closed]));
  } catch (error) {
    // Storage blocked: the group just won't stay closed after a refresh.
  }
}

const closedGroups = loadClosedGroups();

// -------------------------------------------------------------
// buildRoleGroup(group)
// Makes one group's box: a heading line (role name, summary,
// More/Less hint) and an empty space for its ship cards.
// Returns the box and the space, so the caller can fill it.
// -------------------------------------------------------------
function buildRoleGroup(group) {
  const box = document.createElement("details");
  box.className = "role-group expandable";
  box.id = "group-" + group.roleId;
  box.open = !closedGroups.has(group.roleId);

  // The summary text is filled in by render(), so it stays live.
  box.innerHTML = `
    <summary class="role-group-head">
      <span class="role-group-name">${group.name}</span>
      <span class="role-group-summary" data-part="summary"></span>
      <span class="expand-hint" aria-hidden="true"></span>
    </summary>
    <div class="role-group-ships" data-part="ships"></div>
  `;

  // Remember when the player opens or closes it.
  box.addEventListener("toggle", () => {
    if (box.open) {
      closedGroups.delete(group.roleId);
    } else {
      closedGroups.add(group.roleId);
    }
    saveClosedGroups(closedGroups);
  });

  return { box, shipsArea: part(box, "ships") };
}

function buildFleetCards(state, actions) {
  const fleetList = byId("fleet-list");
  fleetList.innerHTML = "";   // clear the old groups and cards

  // One group per role that has ships; each ship's card goes
  // inside its group.
  for (const group of getRoleGroups(state, gameNow(state))) {
    const { box, shipsArea } = buildRoleGroup(group);
    fleetList.appendChild(box);

    for (const ship of group.ships) {
      shipsArea.appendChild(buildShipCard(ship, actions));
    }
  }
}

// -------------------------------------------------------------
// buildShipCard(ship, actions)
// One ship's card on the Command screen. Returns the card;
// buildFleetCards puts it in the right group.
// -------------------------------------------------------------
function buildShipCard(ship, actions) {
  const shipType = SHIP_TYPES[ship.type];

  const isFreighter = shipType.role === "freight";

  const card = document.createElement("div");
  card.className = "ship-card";
  card.id = "ship-" + ship.id;

  // Barges pick a field; freighters pick a haul mode.
  // (Freighters have no drill, so their specs skip it.)
  const picker = isFreighter ? haulModePicker() : destinationPicker();

  // The card's layout. Parts we update later get a
  // "data-part" label so we can find them again.
  card.innerHTML = `
    <div class="ship-art" data-ship-art="${ship.id}"></div>
    <div class="ship-body">
      <div class="card-header">
        <span class="card-name">${escapeHtml(ship.name)}</span>
        <span class="card-sub">${shipType.name}</span>
      </div>
      ${picker}
      ${routeTracker()}
      <div class="ship-status" data-part="status">Idle</div>
      <!-- Hold, drill and drive, filled in by render (they change
           with upgrades and levels) -->
      <div class="ship-specs" data-part="specs"></div>
      <button class="btn" data-part="button">Dispatch</button>
    </div>
  `;

  if (isFreighter) {
    // Choosing a haul mode (allowed any time; it's used the
    // next time the freighter loads).
    for (const modeButton of part(card, "modes").querySelectorAll(".dest-btn")) {
      modeButton.addEventListener("click", () => {
        actions.setHaulMode(ship.id, modeButton.dataset.mode);
      });
    }
  } else {
    // Choosing a destination (only while docked: a ship can't
    // change course mid-trip). "change" fires when the player
    // picks a different option from the dropdown.
    const select = part(card, "dest");
    select.addEventListener("change", () => {
      actions.setDestination(ship.id, select.value);
    });
  }

  // When this ship's button is clicked, either send it out
  // call it back, or (if it's been recalled) send it back to work.
  part(card, "button").addEventListener("click", () => {
    const job = getJobForShip(actions.getState(), ship.id);
    if (job && job.recall) {
      actions.resumeShip(ship.id);
    } else if (job) {
      actions.recallShip(ship.id);
    } else {
      actions.dispatchShip(ship.id);
    }
  });

  return card;
}

function buildOwnedList(state, actions) {
  const list = byId("owned-list");
  list.innerHTML = "";

  for (const ship of state.ships) {
    const shipType = SHIP_TYPES[ship.type];

    // <details> is a box that opens and closes by itself when its
    // <summary> line is clicked. The summary is the short version;
    // everything after it only shows when it's open.
    const row = document.createElement("details");
    row.className = "owned-row expandable";
    row.id = "owned-" + ship.id;
    row.innerHTML = `
      <summary class="owned-summary">
        <div class="ship-art" data-ship-art="${ship.id}"></div>
        <div class="owned-main">
          <div class="card-header">
            <span class="card-name">${escapeHtml(ship.name)}</span>
            <span class="card-sub">${shipType.name}</span>
          </div>
          <div class="owned-status" data-part="status">Docked</div>
        </div>
        <span class="expand-hint" aria-hidden="true"></span>
      </summary>
      <div class="owned-detail">
        <div>
          <p class="ship-desc">${shipType.description}</p>
          <!-- Rename: type a new name, then press Rename or Enter -->
          <div class="rename-row">
            <input class="rename-input" data-part="rename-input" type="text"
                   maxlength="${MAX_NAME_LENGTH}" value="${escapeHtml(ship.name)}"
                   aria-label="Ship name" spellcheck="false">
            <button class="btn btn-small" data-part="rename">Rename</button>
          </div>
          <div class="rename-note" data-part="rename-note"></div>
          <button class="btn btn-sell" data-part="sell"></button>
          <div class="sell-note" data-part="sell-note"></div>
          <!-- The components fitted to this ship (filled in by render) -->
          <h3 class="sub-title">Components</h3>
          <div data-ship-parts="${ship.id}"></div>
        </div>
        <!-- This ship's stats, with the parts it has fitted now -->
        <div class="stats-box" data-ship-stats="${ship.id}"></div>
      </div>
    `;
    rememberOpenState(row);

    makeTwoClick(part(row, "sell"), "Click again to sell", () => {
      actions.sellShip(ship.id);
    });

    // Renaming. On success the fleet views are rebuilt with the
    // new name; if it's refused, say why under the box.
    const nameInput = part(row, "rename-input");
    const renameNote = part(row, "rename-note");
    const tryRename = () => {
      const result = actions.renameShip(ship.id, nameInput.value);
      if (!result.ok) {
        renameNote.textContent = result.reason;
      }
    };
    part(row, "rename").addEventListener("click", tryRename);
    // Pressing Enter in the box does the same as the button.
    nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") tryRename();
    });
    // Start typing again and the old error message goes away.
    nameInput.addEventListener("input", () => {
      renameNote.textContent = "";
    });

    list.appendChild(row);
  }
}


// -------------------------------------------------------------
// buildRefinery(actions)
// One box per refinery slot, including slots still locked (so
// the player can see what's coming). Each box has a recipe
// dropdown, a progress bar and a status line.
// Built once; renderRefinery() keeps the words and bar current.
// -------------------------------------------------------------
function buildRefinery(actions) {
  const area = byId("refinery-slots");
  area.innerHTML = "";

  // One <option> per recipe, plus "Off" at the top.
  const options = Object.entries(RECIPES).map(([recipeId, recipe]) => `
    <option value="${recipeId}">${recipe.name}</option>
  `).join("");

  // One box per slot that could ever exist: the level slots
  // ([1, 10, 25]) plus any an upgrade adds (slot 4).
  for (let slot = 0; slot < getMaxSlots(); slot++) {
    const box = document.createElement("div");
    box.className = "refine-slot";
    box.id = "refine-slot-" + slot;
    box.innerHTML = `
      <div class="card-header">
        <span class="card-name">Slot ${slot + 1}</span>
        <span class="card-sub" data-part="tag"></span>
      </div>
      <label class="dest-select-row">
        <span class="dest-label">Recipe</span>
        <select class="dest-select" data-part="recipe">
          <option value="">Off</option>
          ${options}
        </select>
      </label>
      <div class="progress"><div class="progress-fill refine-fill" data-part="bar"></div></div>
      <div class="ship-status" data-part="status"></div>
      <div class="ship-specs" data-part="specs"></div>
    `;

    // Picking a recipe (or "Off") tells the game. An empty value
    // means Off, which the game calls null.
    const select = part(box, "recipe");
    select.addEventListener("change", () => {
      actions.setRecipe(slot, select.value || null);
    });

    area.appendChild(box);
  }
}


// -------------------------------------------------------------
// buildWorkshop(actions)
// One box per workshop slot, including slots still locked.
// Each box has three parts:
//   1. the current order: what it's making, a progress bar and
//      how far through the order it is
//   2. the queue: every order waiting, each with a cancel (x)
//      button (redrawn only when the queue changes)
//   3. the "add an order" row: a recipe, a number of batches
//      and a Queue button, with a line that explains a refusal
// Built once; renderWorkshop() keeps everything current.
// -------------------------------------------------------------
function buildWorkshop(actions) {
  const area = byId("workshop-slots");
  area.innerHTML = "";

  const options = Object.entries(WORKSHOP_RECIPES).map(([recipeId, recipe]) => `
    <option value="${recipeId}">${recipe.name}</option>
  `).join("");

  WORKSHOP.slotLevels.forEach((unlockLevel, slot) => {
    const box = document.createElement("div");
    box.className = "refine-slot workshop-slot";
    box.id = "workshop-slot-" + slot;
    box.innerHTML = `
      <div class="card-header">
        <span class="card-name">Slot ${slot + 1}</span>
        <span class="card-sub" data-part="tag"></span>
      </div>
      <div class="progress"><div class="progress-fill refine-fill" data-part="bar"></div></div>
      <div class="ship-status" data-part="status"></div>
      <ol class="order-queue" data-part="queue"></ol>
      <div class="order-form" data-part="form">
        <label class="dest-select-row">
          <span class="dest-label">Make</span>
          <select class="dest-select" data-part="recipe">${options}</select>
        </label>
        <label class="dest-select-row">
          <span class="dest-label">Batches</span>
          <input class="batch-input" type="number" min="1" max="${WORKSHOP.maxOrderBatches}"
                 step="1" value="${WORKSHOP.maxOrderBatches}" data-part="batches">
        </label>
        <button class="btn btn-primary" data-part="queue-button">Queue order</button>
      </div>
      <div class="ship-specs" data-part="specs"></div>
      <div class="order-message" data-part="message" role="status"></div>
      <div class="standing" data-part="standing" hidden>
        <div class="standing-title">Standing orders</div>
        <ul class="order-queue standing-list" data-part="standing-list"></ul>
        <div class="order-form" data-part="standing-form">
          <label class="dest-select-row">
            <span class="dest-label">Keep</span>
            <select class="dest-select" data-part="standing-recipe">${options}</select>
          </label>
          <label class="dest-select-row">
            <span class="dest-label">In stock</span>
            <input class="batch-input" type="number" min="1" step="1" value="60" data-part="standing-target">
          </label>
          <button class="btn" data-part="standing-button">Add standing order</button>
        </div>
      </div>
    `;

    const select = part(box, "recipe");
    const batches = part(box, "batches");
    const message = part(box, "message");

    // Queue button: ask the game to add the order. If it says
    // no, show the reason under the form (e.g. "queue is full").
    part(box, "queue-button").addEventListener("click", () => {
      const result = actions.queueOrder(slot, select.value, Number(batches.value));
      message.textContent = result.ok ? "" : result.reason;
    });

    // Cancel buttons are redrawn with the queue, so one listener
    // on the whole list handles them all ("event delegation"):
    // it checks whether the click landed on a cancel button.
    part(box, "queue").addEventListener("click", (event) => {
      const button = event.target.closest("[data-cancel]");
      if (button) {
        actions.cancelOrder(slot, Number(button.dataset.cancel));
        message.textContent = "";
      }
    });

    // Standing orders: Add, and the remove (x) buttons in the list
    // (one listener for the whole list, like the queue's).
    part(box, "standing-button").addEventListener("click", () => {
      const result = actions.addStandingOrder(slot, part(box, "standing-recipe").value,
                                              Number(part(box, "standing-target").value));
      message.textContent = result.ok ? "" : result.reason;
    });
    part(box, "standing-list").addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove]");
      if (button) {
        actions.removeStandingOrder(slot, Number(button.dataset.remove));
        message.textContent = "";
      }
    });

    // Changing the recipe or batch count clears an old refusal.
    select.addEventListener("change", () => { message.textContent = ""; });
    batches.addEventListener("input", () => { message.textContent = ""; });

    area.appendChild(box);
  });
}


// -------------------------------------------------------------
// buildUpgrades(actions)
// One row per upgrade, under a heading for the refinery and one
// for the workshop. Each row has the name, what it does, its
// cost, and a Buy button. render() hides rows that aren't owned
// or next in their line, and greys out what can't be bought yet.
// -------------------------------------------------------------
function buildUpgrades(actions) {
  const list = byId("upgrades-list");
  list.innerHTML = "";

  for (const building of ["refinery", "workshop"]) {
    const heading = document.createElement("h3");
    heading.className = "sub-title";
    heading.textContent = building === "refinery" ? "Refinery" : "Workshop";
    list.appendChild(heading);

    // Upgrades for this building, lowest level first
    const ids = Object.keys(UPGRADES)
      .filter((id) => UPGRADES[id].building === building)
      .sort((a, b) => UPGRADES[a].level - UPGRADES[b].level);

    for (const upgradeId of ids) {
      const upgrade = UPGRADES[upgradeId];
      // The cost, e.g. "20 t hull plating + 15,000 cr"
      const goods = Object.entries(upgrade.costs)
        .map(([itemId, tonnes]) => `${formatTonnes(tonnes)} ${ITEMS[itemId].name.toLowerCase()}`);
      const cost = [...goods, formatNumber(upgrade.credits) + " cr"].join(" + ");

      const row = document.createElement("div");
      row.className = "upgrade-row";
      row.id = "upgrade-" + upgradeId;
      row.innerHTML = `
        <div class="upgrade-text">
          <div class="upgrade-name">${upgrade.name}
            <span class="upgrade-level">${SKILLS[upgrade.skill].name} ${upgrade.level}</span></div>
          <div class="upgrade-desc">${upgrade.description}</div>
          <div class="upgrade-cost">${cost}</div>
          <div class="upgrade-reason" data-part="reason"></div>
        </div>
        <button class="btn btn-small" data-part="buy">Buy</button>
      `;
      part(row, "buy").addEventListener("click", () => {
        const result = actions.buyIndustryUpgrade(upgradeId);
        byId("upgrade-message").textContent = result.ok ? "" : `${upgrade.name}: ${result.reason}`;
      });
      list.appendChild(row);
    }
  }
}


// -------------------------------------------------------------
// renderUpgrades(state)
// Shows owned upgrades (marked Owned) and the next tier of each
// line; hides later tiers. The Buy button is only clickable when
// the upgrade can be bought; otherwise it says why on the row.
// -------------------------------------------------------------
function renderUpgrades(state) {
  // Nothing to upgrade until the refinery is open.
  const panel = byId("upgrades-panel");
  panel.hidden = !isRefineryOpen(state);

  let owned = 0;
  let ready = 0;   // shown, not owned, and can be bought right now
  for (const upgradeId of Object.keys(UPGRADES)) {
    const row = byId("upgrade-" + upgradeId);
    row.hidden = !isShown(state, upgradeId);
    const button = part(row, "buy");
    const reason = part(row, "reason");

    if (isOwned(state, upgradeId)) {
      owned++;
      row.classList.add("owned");
      if (button.textContent !== "Owned") button.textContent = "Owned";
      button.disabled = true;
      reason.textContent = "";
      continue;
    }
    row.classList.remove("owned");
    const check = canBuyIndustryUpgrade(state, upgradeId);
    if (button.textContent !== "Buy") button.textContent = "Buy";
    button.disabled = !check.ok;
    // A row that can't be bought yet says why under its cost,
    // e.g. "Need 12 t more hull plating."
    row.classList.toggle("blocked", !check.ok);
    // A row you can buy now is lit up, so it stands out in the list.
    row.classList.toggle("ready", check.ok && !row.hidden);
    if (check.ok && !row.hidden && !panel.hidden) ready++;
    if (reason.textContent !== (check.ok ? "" : check.reason)) {
      reason.textContent = check.ok ? "" : check.reason;
    }
  }
  // e.g. "3 of 15 owned · 2 ready to buy" - shows on the header even
  // when the Upgrades box is closed.
  setText(byId("upgrades-tag"),
    `${owned} of ${Object.keys(UPGRADES).length} owned` + (ready > 0 ? ` · ${ready} ready to buy` : ""));
  panel.classList.toggle("has-ready", ready > 0);
  return ready;
}


// -------------------------------------------------------------
// buildStationHold(actions)
// The Industry screen's list of what's in the hold, one row per
// item, with its BOND: a box for the tonnes to set aside, a
// Bond button to set it, and Release to clear it.
// Amounts are filled in by render().
// -------------------------------------------------------------
function buildStationHold(actions) {
  const body = byId("hold-body");
  body.innerHTML = "";
  for (const [itemId, item] of Object.entries(ITEMS)) {
    const row = document.createElement("tr");
    row.id = "hold-" + itemId;
    row.innerHTML = `
      <td>${item.name}</td>
      <td>
        <span data-part="stock">0 t</span>
        <span class="bonded-note" data-part="bonded" hidden></span>
      </td>
      <td class="bond-cell">
        <!-- A wrapping box: on a narrow screen the buttons drop
             below the number instead of spilling out of the panel -->
        <div class="bond-controls">
          <input class="batch-input bond-input" type="number" min="0" step="1"
                 aria-label="Tonnes of ${item.name.toLowerCase()} to bond" data-part="bond">
          <button class="btn btn-small" data-part="bond-button">Bond</button>
          <button class="btn btn-small" data-part="release">Release</button>
        </div>
      </td>
    `;
    const input = part(row, "bond");

    // Bond: set the bond to the number in the box. A refused
    // number (like -5) puts the box back to the current bond.
    part(row, "bond-button").addEventListener("click", () => {
      actions.setBond(itemId, Number(input.value));
      input.dataset.editing = "";
    });
    // Release: no bond at all.
    part(row, "release").addEventListener("click", () => {
      actions.setBond(itemId, 0);
      input.dataset.editing = "";
    });
    // While the player is typing, the 4-times-a-second redraw
    // mustn't overwrite the box. "editing" marks that.
    input.addEventListener("input", () => { input.dataset.editing = "yes"; });
    // Pressing Enter in the box works like the Bond button.
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") part(row, "bond-button").click();
    });
    body.appendChild(row);
  }
  byId("hold-name-tag").textContent = HOME.name;
}


// -------------------------------------------------------------
// buildShipyard(actions)
// One card per ship TYPE. Ship types come from content.js and
// don't change while playing, so this only runs once.
// -------------------------------------------------------------
function buildShipyard(actions) {
  const list = byId("shipyard-list");
  list.innerHTML = "";

  // Object.entries gives pairs: ["excavator", { name: ... }]
  for (const [typeId, shipType] of Object.entries(SHIP_TYPES)) {
    const skillName = SKILLS[shipType.skill].name;

    const card = document.createElement("div");
    card.className = "yard-card";
    card.id = "yard-" + typeId;
    card.innerHTML = `
      <div class="card-header">
        <span class="card-name">${shipType.name}</span>
        <span class="card-tag" data-part="tag"></span>
      </div>
      <div class="yard-art" data-art="${typeId}"></div>
      <p class="ship-desc">${shipType.description}</p>
      ${statsBox(typeId)}
      <dl class="stats stats-yard">
        <dt>Requires</dt>  <dd>${skillName} level ${shipType.unlockLevel}</dd>
        <dt>Next one</dt>  <dd data-part="price"></dd>
        <dt>Owned</dt>     <dd data-part="owned">0</dd>
      </dl>
      <div class="yard-note" data-part="note"></div>
      <button class="btn btn-primary" data-part="button"></button>
    `;

    part(card, "button").addEventListener("click", () => {
      actions.buyShip(typeId);
    });

    list.appendChild(card);
  }
}


// -------------------------------------------------------------
// buildSkillCards()
// One card per skill, each with an XP bar and its unlock list
// (ships AND fields, in level order).
// -------------------------------------------------------------
function buildSkillCards() {
  const list = byId("skills-list");
  list.innerHTML = "";

  for (const [skillId, skill] of Object.entries(SKILLS)) {
    // Collect everything this skill unlocks into one list:
    // { level, name, kind, key } - key says what to check later.
    const unlocks = [];
    for (const [typeId, shipType] of Object.entries(SHIP_TYPES)) {
      if (shipType.skill === skillId) {
        unlocks.push({ level: shipType.unlockLevel, name: shipType.name, kind: "Ship", key: "ship:" + typeId });
      }
    }
    if (skillId === "mining") {
      for (const [fieldId, field] of Object.entries(FIELDS)) {
        unlocks.push({ level: field.unlockLevel, name: field.name, kind: "Field", key: "field:" + fieldId });
      }
      unlocks.push({ level: REFINERY.openAtMiningLevel, name: "Refinery (Industry tab)", kind: "Station", key: "refinery:open" });
    }
    if (skillId === "refining") {
      for (const [recipeId, recipe] of Object.entries(RECIPES)) {
        unlocks.push({ level: recipe.unlockLevel, name: recipe.name, kind: "Recipe", key: "recipe:" + recipeId });
      }
      REFINERY.slotLevels.forEach((slotLevel, slot) => {
        unlocks.push({ level: slotLevel, name: `Refinery slot ${slot + 1}`, kind: "Slot", key: "slot:" + slot });
      });
      unlocks.push({ level: WORKSHOP.openAtRefiningLevel, name: "Workshop (Industry tab)", kind: "Station", key: "workshop:open" });
    }
    // Ship components this skill's levels make available to buy
    for (const [upgradeId, upgrade] of Object.entries(SHIP_UPGRADES)) {
      if (upgrade.skill === skillId) {
        unlocks.push({ level: upgrade.level, name: getUpgradeName(upgrade), kind: "Component", key: "component:" + upgradeId });
      }
    }
    // Upgrades this skill's levels make available to buy
    for (const [upgradeId, upgrade] of Object.entries(UPGRADES)) {
      if (upgrade.skill === skillId) {
        unlocks.push({ level: upgrade.level, name: upgrade.name, kind: "Upgrade", key: "upgrade:" + upgradeId });
      }
    }
    if (skillId === "manufacturing") {
      for (const [recipeId, recipe] of Object.entries(WORKSHOP_RECIPES)) {
        unlocks.push({ level: recipe.unlockLevel, name: recipe.name, kind: "Recipe", key: "wrecipe:" + recipeId });
      }
      WORKSHOP.slotLevels.forEach((slotLevel, slot) => {
        unlocks.push({ level: slotLevel, name: `Workshop slot ${slot + 1}`, kind: "Slot", key: "wslot:" + slot });
      });
      WORKSHOP.queueLevels.forEach((queueLevel, index) => {
        const size = WORKSHOP.baseQueue + index + 1;
        unlocks.push({ level: queueLevel, name: `Queue of ${size} orders per slot`, kind: "Queue", key: "queue:" + queueLevel });
      });
    }
    unlocks.sort((a, b) => a.level - b.level);   // lowest level first

    // Turn each unlock into a line of the list. A skill with
    // nothing to unlock yet gets one plain line saying so.
    const unlockLines = unlocks.length === 0
      ? `<li>Nothing to unlock yet.</li>`
      : unlocks.map((u) => `
      <li data-unlock="${u.key}">
        <span class="unlock-level">Lv ${u.level}</span>
        <span class="unlock-kind">${u.kind}</span>
        <span class="unlock-name">${u.name}</span>
        <span class="unlock-state" data-part="state"></span>
      </li>
    `).join("");

    // Summary: name, level and XP bar. Opened: the description,
    // total XP and the full unlock list.
    const card = document.createElement("details");
    card.className = "skill-card expandable";
    card.id = "skill-" + skillId;
    card.innerHTML = `
      <summary class="skill-summary">
        <div class="card-header">
          <span class="card-name">${skill.name}</span>
          <span class="skill-level"><span data-part="level">1</span><small>/99</small></span>
        </div>
        <div class="progress"><div class="progress-fill xp-fill" data-part="bar"></div></div>
        <div class="skill-xp">
          <span data-part="xp"></span>
          <span class="expand-hint" aria-hidden="true"></span>
        </div>
        <!-- What every level gives, e.g. "Every level: +0.5% drill
             speed · now +4.5%" (filled in by renderSkills) -->
        <p class="skill-perk" data-part="perk"></p>
      </summary>
      <div class="skill-detail">
        <p class="skill-desc">${skill.description}</p>
        <p class="skill-total" data-part="total"></p>
        ${skillId === "mining" ? `<p class="skill-total" data-part="share"></p>` : ""}
        <h3 class="sub-title">Unlocks</h3>
        <ul class="unlock-list">${unlockLines}</ul>
      </div>
    `;
    rememberOpenState(card);
    list.appendChild(card);
  }
}


// =============================================================
// RENDER (runs 4 times a second)
// =============================================================

export function render(state, now) {
  // Stat blocks first: the shipyard and fleet then dim the rows
  // inside them, so the rows must exist.
  renderStatsBoxes(state);
  renderCargo(state);
  renderStatusStrip(state, now);
  renderFleet(state, now);
  renderRoleGroups(state, now);
  renderOwnedList(state);
  renderCommand(state);
  renderShipyard(state);
  renderSkills(state);
  renderRefinery(state, now);
  renderWorkshop(state, now);
  const upgradesReady = renderUpgrades(state);
  const componentsReady = renderComponents(state);

  // Nav dots. Industry: whenever a station upgrade can be bought,
  // so it isn't forgotten. Shipyard: a ship or component you can
  // buy that you haven't seen yet (see shipyardAlert).
  navAlert("industry", upgradesReady > 0);
  shipyardAlert(lastAffordableShips, componentsReady);
}

// -------------------------------------------------------------
// shipyardAlert(ships, componentIds)
// The Shipyard dot, which you can dismiss by looking (Dan,
// 30 Oct: it nagged while saving up for a bigger ship).
// Visiting the Shipyard marks everything you can afford as seen,
// so the dot clears and stays clear. It comes back only for
// something NEW: another ship type, the same ship at a new price
// (after buying one), or a component you haven't seen ready.
//   ships         { prospector: 12800 }  affordable ships, by price
//   componentIds  ["prospector_drive_1"] components ready to buy
// -------------------------------------------------------------
function shipyardAlert(ships, componentIds) {
  // Everything the dot could be about, as "what: version" pairs.
  const ready = {};
  for (const [typeId, price] of Object.entries(ships)) ready["ship:" + typeId] = price;
  for (const id of componentIds) ready["component:" + id] = 1;

  const onShipyard = !document.querySelector('section[data-screen="shipyard"]').hidden;
  const seen = loadSeenShips();
  let somethingNew = false;
  for (const [key, version] of Object.entries(ready)) {
    if (onShipyard) {
      seen[key] = version;          // looking at it = seen
    } else if (seen[key] !== version) {
      somethingNew = true;
    }
  }
  if (onShipyard) saveSeenShips(seen);
  navAlert("shipyard", somethingNew);
}

// -------------------------------------------------------------
// loadSeenShips() and saveSeenShips(seen)
// The ships and components you've already seen you can afford,
// as { "ship:prospector": 12800, "component:prospector_drive_1": 1 }.
// Kept in the browser (not the save): it's only about
// what this screen has shown you. Storage can be blocked, so
// failures just mean the dot shows again.
// -------------------------------------------------------------
const SEEN_SHIPS_KEY = "project-damocles-seen-ships";
let seenShipsCache = null;   // read the browser once, then remember

function loadSeenShips() {
  if (seenShipsCache === null) {
    try {
      seenShipsCache = JSON.parse(localStorage.getItem(SEEN_SHIPS_KEY)) || {};
    } catch (error) {
      seenShipsCache = {};
    }
  }
  return seenShipsCache;
}

function saveSeenShips(seen) {
  const text = JSON.stringify(seen);
  try {
    // Only write when something changed (this runs 4 times a second).
    if (localStorage.getItem(SEEN_SHIPS_KEY) !== text) localStorage.setItem(SEEN_SHIPS_KEY, text);
  } catch (error) {
    // Blocked storage: nothing to do.
  }
}


// -------------------------------------------------------------
// navAlert(screen, on)
// Lights (or clears) the teal dot on a nav button.
// -------------------------------------------------------------
function navAlert(screen, on) {
  document.querySelector(`.nav-btn[data-screen="${screen}"]`).classList.toggle("has-alert", on);
}


// -------------------------------------------------------------
// showStock(row, amount, bonded)
// Fills a cargo row's Stock cell: the amount, plus a small
// "100 t bonded" line under it, hidden when nothing is bonded.
// Used by both the Command cargo hold and the Industry hold.
// -------------------------------------------------------------
function showStock(row, amount, bonded) {
  part(row, "stock").textContent = formatTonnes(amount);
  const note = part(row, "bonded");
  note.hidden = bonded === 0;
  note.textContent = formatTonnes(bonded) + " bonded";
}

// Credits and the cargo hold
function renderCargo(state) {
  byId("credits").textContent = formatNumber(state.credits) + " cr";

  for (const [itemId, item] of Object.entries(ITEMS)) {
    const row = byId("cargo-" + itemId);
    const amount = state.inventory[itemId] || 0;
    const sellable = getSellable(state, itemId);         // above the bond
    const bonded = getBondedInHold(state, itemId);       // held back by it

    // The stock, e.g. "120 t", and under it "100 t bonded" when
    // some of it is bonded. (Once these were on one line, which
    // made the column too wide and pushed the Value and Sell
    // columns out of the panel.)
    showStock(row, amount, bonded);
    // Only the part that can be sold is worth anything here.
    // Short form ("2.4M cr") so big values fit the narrow panel.
    part(row, "value").textContent = formatCreditsShort(sellable * item.sellPrice);
    part(row, "sell").disabled = sellable === 0;
    // Dim rows for items you have none of
    row.classList.toggle("empty", amount === 0);

    // The same on the Industry screen's station hold, with its bond
    const holdRow = byId("hold-" + itemId);
    showStock(holdRow, amount, bonded);
    holdRow.classList.toggle("empty", amount === 0 && getBond(state, itemId) === 0);
    const input = part(holdRow, "bond");
    if (!input.dataset.editing && document.activeElement !== input) {
      const bond = String(getBond(state, itemId));
      if (input.value !== bond) input.value = bond;
    }
    part(holdRow, "release").hidden = getBond(state, itemId) === 0;
  }

  // The note under the table, with the Trade perk once it's earned.
  const perk = getTradeHubPerk(state);
  const note = `Selling here is instant at the home price. The ${HUB.name.toLowerCase()} pays the hub price` +
    (perk > 0 ? ` (+${formatPercent(perk)} from your Trade level)` : "") +
    `, but needs a freighter to haul the goods there. Only freighters earn Trade XP.`;
  if (byId("hub-note").textContent !== note) byId("hub-note").textContent = note;

  const total = getCargoValue(state);
  byId("cargo-total").textContent = formatCreditsShort(total);
  byId("sell-all").disabled = total === 0;
}


// The thin strip of readouts under the top bar
function renderStatusStrip(state, now) {
  // The clock shows the REAL time of day: at a playtest speed the
  // game's clock runs ahead, and a made-up time would just confuse.
  byId("clock").textContent = new Date().toLocaleTimeString("en-GB");

  // Playtest readouts (playtest.js): the speed, only when it isn't
  // 1x, and the badge once the save has used a playtest tool.
  byId("speed-readout").hidden = state.clock.speed === 1;
  byId("speed-value").textContent = state.clock.speed + "×";
  byId("playtest-badge").hidden = !state.playtest;

  // Dev panel: game time played on this save (simulation.js keeps
  // this; time past the offline cap isn't played, so isn't counted).
  byId("dev-played").textContent = formatDuration(state.simulatedMs);

  // Light up the speed button that's running (if the panel's shown).
  for (const button of document.querySelectorAll(".dev-speed")) {
    button.classList.toggle("active", Number(button.dataset.speed) === state.clock.speed);
  }

  byId("mining-level").textContent = "Lv " + getLevel(state, "mining");
  byId("trade-level").textContent = "Lv " + getLevel(state, "trade");
  byId("refining-level").textContent = "Lv " + getLevel(state, "refining");
  byId("manufacturing-level").textContent = "Lv " + getLevel(state, "manufacturing");
  byId("command-readout").textContent = getCommandUsed(state) + "/" + getCommandCapacity(state);

  // "1 ship" / "2 ships" in the panel corners
  const count = state.ships.length + (state.ships.length === 1 ? " ship" : " ships");
  byId("fleet-tag").textContent = count;
  byId("your-fleet-tag").textContent = count;
}


// Each ship's card on the Command screen
function renderFleet(state, now) {
  for (const ship of state.ships) {
    const card = byId("ship-" + ship.id);
    if (!card) continue;   // (not built yet - skip this time)

    // Freighters have their own card logic (below).
    if (SHIP_TYPES[ship.type].role === "freight") {
      renderFreighterCard(state, ship, card, now);
      continue;
    }

    const job = getJobForShip(state, ship.id);

    // A busy ship shows where it's actually going; a docked one
    // shows where it WILL go.
    const fieldId = job ? job.fieldId : ship.destination;
    const fieldName = FIELDS[fieldId].name;
    part(card, "route-field").textContent = fieldName;

    // The destination dropdown: show the chosen field, grey out
    // locked fields (with the level they need), and freeze the
    // whole menu mid-trip.
    // Each line only changes things that are different, because
    // rewriting a dropdown 4 times a second would close it while
    // the player is choosing.
    const select = part(card, "dest");
    for (const option of select.options) {
      const field = FIELDS[option.value];
      const unlocked = isFieldUnlocked(state, option.value);
      const label = unlocked ? field.name : `${field.name} (Mining ${field.unlockLevel})`;
      if (option.textContent !== label) option.textContent = label;
      if (option.disabled === unlocked) option.disabled = !unlocked;
    }
    if (select.value !== fieldId) select.value = fieldId;
    if (select.disabled !== Boolean(job)) select.disabled = Boolean(job);

    // Segment widths: from the running job, or (when docked)
    // from the trip this ship WOULD make, as a preview.
    renderSpecs(state, ship, card);
    const timing = job || getTripPlan(state, ship.type, fieldId);
    setRoute(card, [
      ["out", timing.outboundMs],
      ["mine", timing.miningMs],
      ["back", timing.returnMs],
      ["dock", timing.unloadMs || 0],   // unloading at home
    ]);

    const fills = part(card, "route").querySelectorAll(".seg-fill");
    const status = part(card, "status");
    const button = part(card, "button");

    // Remove last frame's phase class before adding this one's.
    card.classList.remove(...ALL_PHASE_CLASSES);

    if (job) {
      const phase = getJobPhase(job, now);
      phase.fills.forEach((amount, i) => {
        fills[i].style.width = (amount * 100) + "%";
      });

      const timeLeft = formatDuration(phase.msLeftInPhase);
      let text;
      if (phase.phase === "outbound") text = `Outbound to ${fieldName} — arrives in ${timeLeft}`;
      if (phase.phase === "mining") text = `Mining ${fieldName} — hold full in ${timeLeft}`;
      if (phase.phase === "returning") text = `Returning home — docks in ${timeLeft}`;
      if (phase.phase === "unloading") {
        const load = job.amountOverride ?? job.orePerTrip;
        text = `Unloading ${formatTonnes(load)} at ${HOME.name} — done in ${timeLeft}`;
      }
      if (job.recall) text = recallStatus(state, job, now);

      status.textContent = text;
      button.textContent = job.recall ? "Resume" : "Recall";
      card.classList.add("busy", "phase-" + phase.phase);
    } else {
      fills.forEach((fill) => { fill.style.width = "0%"; });
      status.textContent = `Docked at ${HOME.name} — awaiting orders`;
      button.textContent = "Dispatch to " + fieldName;
    }
  }
}


// -------------------------------------------------------------
// renderRoleGroups(state, now)
// Keeps each group heading's summary up to date, e.g.
// "3 ships · 2 working, 1 docked". If any ship in the group is
// docked with no orders, the heading lights up amber, so even a
// collapsed group shows that something needs the player.
// -------------------------------------------------------------
function renderRoleGroups(state, now) {
  for (const group of getRoleGroups(state, now)) {
    const box = byId("group-" + group.roleId);
    if (!box) continue;   // (not built yet - skip this time)

    const summary = part(box, "summary");
    const text = describeGroup(group);
    // Only rewrite the text when it changes (it's checked 4 times a second).
    if (summary.textContent !== text) {
      summary.textContent = text;
    }
    box.classList.toggle("needs-orders", group.counts.docked > 0);
  }
}


// -------------------------------------------------------------
// recallStatus(state, job, now)
// The status line for a ship that's been recalled, e.g.
//   "Recalled — returning with 60 t, docks in 52s"
// -------------------------------------------------------------
function recallStatus(state, job, now) {
  const docksIn = formatDuration(Math.max(0, job.startedAt + job.durationMs - now));

  if (job.type === "haul") {
    return job.noSale
      ? `Recalled — bringing its cargo back, docks in ${docksIn}`
      : `Recalled — standing down after this run, docks in ${docksIn}`;
  }
  // A barge: a part-full hold if it left the field early,
  // otherwise a full one.
  const load = job.amountOverride ?? job.orePerTrip;
  return load === 0
    ? `Recalled — turning back empty, docks in ${docksIn}`
    : `Recalled — returning with ${formatTonnes(load)}, docks in ${docksIn}`;
}

// -------------------------------------------------------------
// renderSpecs(state, ship, card)
// The one-line specs on a ship card, e.g.
//   "Hold 138 t · Drill 144 t/min · Drive 1.10×"
// from the ship's stats right now (upgrades and levels counted).
// Only rewritten when it changes.
// -------------------------------------------------------------
function renderSpecs(state, ship, card) {
  // What THIS ship has fitted now (it may still be flying with
  // older parts until it docks).
  const stats = getShipStats(state, ship.type, getShipGrades(state, ship));
  // Freighters have no drill, so their specs skip it.
  const drill = stats.miningRate === undefined
    ? ""
    : ` · Drill <b>${formatTonnes(Math.round(stats.miningRate))}/min</b>`;
  let html = `Hold <b>${formatTonnes(stats.cargoCapacity)}</b>${drill} · Drive <b>${stats.speed.toFixed(2)}×</b>`;
  // Components bought but not fitted yet: say they're waiting.
  const pending = Object.entries(getPendingRefits(state, ship))
    .map(([partId, grade]) => `${SHIP_PARTS[partId].name.toLowerCase()} ${findUpgrade(ship.type, partId, grade).gradeName}`);
  if (pending.length > 0) {
    html += `<span class="refit-waiting">Refit waiting: ${pending.join(", ")}, fitted when it docks</span>`;
  }
  const specs = part(card, "specs");
  if (specs.innerHTML !== html) specs.innerHTML = html;
}


// Every phase class a card can have, so each frame can clear
// last frame's before adding the current one.
const ALL_PHASE_CLASSES = ["phase-outbound", "phase-mining", "phase-trading",
  "phase-returning", "phase-waiting", "phase-loading", "phase-unloading", "busy"];


// -------------------------------------------------------------
// renderFreighterCard(state, ship, card, now)
// A freighter's card: haul mode buttons, the Home -> Hub -> Home
// tracker, and what it's doing.
// -------------------------------------------------------------
function renderFreighterCard(state, ship, card, now) {
  const job = getJobForShip(state, ship.id);
  const capacity = getShipStats(state, ship.type).cargoCapacity;
  const mode = ship.haulMode || "full";
  renderSpecs(state, ship, card);

  // Highlight the chosen haul mode.
  for (const modeButton of part(card, "modes").querySelectorAll(".dest-btn")) {
    modeButton.classList.toggle("selected", modeButton.dataset.mode === mode);
  }

  // The tracker's middle stop is the hub; its segments are
  // sized from the job, or from a planned run while docked.
  part(card, "route-field").textContent = HUB.name;
  const timing = job || getHaulPlan(state, ship.type);
  setRoute(card, [
    ["dock", timing.loadMs || 0],   // loading at home
    ["out", timing.outboundMs],
    ["mine", timing.tradeMs],       // unloading and selling at the hub
    ["back", timing.returnMs],
  ]);

  const fills = part(card, "route").querySelectorAll(".seg-fill");
  const status = part(card, "status");
  const button = part(card, "button");
  card.classList.remove(...ALL_PHASE_CLASSES);

  if (!job) {
    fills.forEach((fill) => { fill.style.width = "0%"; });
    status.textContent = `Docked at ${HOME.name} — awaiting orders`;
    button.textContent = "Start hub runs";
    return;
  }

  const phase = getJobPhase(job, now);
  phase.fills.forEach((amount, i) => {
    fills[i].style.width = (amount * 100) + "%";
  });

  const timeLeft = formatDuration(phase.msLeftInPhase);
  // Add up the tonnes on board: .reduce runs through the list
  // keeping a running total (a), adding each amount (b).
  const tonnes = job.cargo ? Object.values(job.cargo).reduce((a, b) => a + b, 0) : 0;
  let text;
  if (phase.phase === "waiting") {
    // Say what it's waiting for, so the player knows why it's idle.
    const ore = getOreInHold(state);
    text = mode === "full"
      ? `Waiting for a full hold — ${formatTonnes(Math.min(ore, capacity))} of ${formatTonnes(capacity)} ready`
      : `Waiting for ore to load`;
  }
  if (phase.phase === "loading") text = `Loading ${formatTonnes(tonnes)} at ${HOME.name} — leaves in ${timeLeft}`;
  if (phase.phase === "outbound") text = `Hauling ${formatTonnes(tonnes)} to the hub — arrives in ${timeLeft}`;
  if (phase.phase === "trading") text = `Unloading and selling at the hub — done in ${timeLeft}`;
  if (phase.phase === "returning") text = `Returning home — docks in ${timeLeft}`;
  if (job.recall) text = recallStatus(state, job, now);

  status.textContent = text;
  button.textContent = job.recall ? "Resume" : "Recall";
  card.classList.add("busy", "phase-" + phase.phase);
}


// Each ship's row on the Ships screen
function renderOwnedList(state) {
  const now = gameNow(state);   // the game's time (clock.js)
  for (const ship of state.ships) {
    const row = byId("owned-" + ship.id);
    if (!row) continue;

    const job = getJobForShip(state, ship.id);
    if (job) {
      const phase = getJobPhase(job, now);
      if (job.recall) {
        part(row, "status").textContent = "Recalled · docks in " +
          formatDuration(Math.max(0, job.startedAt + job.durationMs - now));
      } else if (job.type === "haul") {
        // e.g. "Trading · Merchant hub · 12s", or just "Waiting for cargo"
        part(row, "status").textContent = phase.phase === "waiting"
          ? PHASE_LABELS.waiting
          : PHASE_LABELS[phase.phase] + " · " + HUB.name + " · " + formatDuration(phase.msLeftInPhase);
      } else {
        part(row, "status").textContent =
          PHASE_LABELS[phase.phase] + " · " + FIELDS[job.fieldId].name + " · " + formatDuration(phase.msLeftInPhase);
      }
    } else {
      part(row, "status").textContent = "Docked at " + HOME.name;
    }
    row.classList.toggle("busy", Boolean(job));

    // Dim field rows the player can't use yet
    for (const fieldRow of row.querySelectorAll("tr[data-field]")) {
      fieldRow.classList.toggle("locked", !isFieldUnlocked(state, fieldRow.dataset.field));
    }

    // The Sell button and the note under it
    const sellButton = part(row, "sell");
    const note = part(row, "sell-note");
    const check = canSellShip(state, ship.id);
    sellButton.disabled = !check.ok;
    if (!isArmed(sellButton)) {
      sellButton.textContent = "Sell — " + formatNumber(getSellValue(state, ship.type)) + " cr";
    }
    if (check.reason === "Last ship") note.textContent = "Can't sell your last ship.";
    else if (check.reason === "Ship is busy") note.textContent = "Recall or wait for it to dock to sell.";
    else note.textContent = "Frees " + getShipPoints(ship.type) + " command point" + (getShipPoints(ship.type) === 1 ? "" : "s") + ".";
  }
}


// The Fleet command panel on the Ships screen
function renderCommand(state) {
  const used = getCommandUsed(state);
  const cap = getCommandCapacity(state);
  byId("command-used").textContent = used;
  byId("command-cap").textContent = cap;

  // One pip per point of capacity; filled ones are in use.
  // Only rebuild when the numbers change (not 4 times a second).
  const pips = byId("command-pips");
  const key = used + "/" + cap;
  if (pips.dataset.key !== key) {
    pips.dataset.key = key;
    pips.innerHTML = "";
    const shown = Math.max(used, cap);   // over the cap? show the extra too
    for (let i = 0; i < shown; i++) {
      const pip = document.createElement("span");
      pip.className = "pip";
      if (i < used) pip.classList.add("used");
      if (i >= cap) pip.classList.add("over");
      pips.appendChild(pip);
    }
  }

  const cost = getNextUpgradeCost(state);
  const button = byId("command-upgrade");
  const note = byId("command-note");
  if (cost === null) {
    button.disabled = true;
    button.textContent = "Fully expanded";
    note.textContent = "Command is at its maximum.";
  } else {
    button.disabled = !canBuyUpgrade(state).ok;
    button.textContent = `Expand command +${COMMAND.pointsPerUpgrade} — ${formatNumber(cost)} cr`;
    note.textContent = used > cap
      ? `Over capacity by ${used - cap}: you keep these ships, but can't buy more until you expand or sell.`
      : `${cap - used} point${cap - used === 1 ? "" : "s"} free. Upgrade ${state.commandUpgrades + 1} of ${COMMAND.maxUpgrades}.`;
  }
}


// What renderShipyard found you can afford, for shipyardAlert.
let lastAffordableShips = {};

// Each ship type on the Ships screen
function renderShipyard(state) {
  // Ships you could buy right now, as { prospector: 12800 } (the
  // price matters: buying one raises the next one's price, which
  // counts as something new to tell you about).
  const affordable = {};

  for (const [typeId, shipType] of Object.entries(SHIP_TYPES)) {
    const card = byId("yard-" + typeId);
    const tag = part(card, "tag");
    const note = part(card, "note");
    const button = part(card, "button");

    // How many of this type the player has.
    const count = state.ships.filter((ship) => ship.type === typeId).length;
    part(card, "owned").textContent = count;

    const unlocked = isShipTypeUnlocked(state, typeId);
    const check = canBuyShip(state, typeId);

    // Locked ships are hidden until the skill level is reached.
    // (Their unlock still shows on the Skills screen.)
    card.hidden = !unlocked;
    if (!unlocked) {
      continue;
    }

    // Dim field rows the player can't use yet
    for (const fieldRow of card.querySelectorAll("tr[data-field]")) {
      fieldRow.classList.toggle("locked", !isFieldUnlocked(state, fieldRow.dataset.field));
    }

    // The price of the NEXT one: it rises with each one you own.
    const price = getShipPrice(state, typeId);
    part(card, "price").textContent = price === null ? "Not sold" : formatNumber(price) + " cr";

    // Pick the tag, note and button text for each situation.
    if (shipType.cost === null) {
      tag.textContent = "Starter";
      note.textContent = "Your first barge. Not sold at this yard.";
      button.hidden = true;
      continue;
    }

    button.hidden = false;
    button.disabled = !check.ok;
    button.textContent = `Buy — ${formatNumber(price)} cr`;

    // (Locked ships were skipped above, so they never get here.)
    if (check.reason === "Not enough command points") {
      tag.textContent = "Available";
      note.textContent = `Needs ${getShipPoints(typeId)} command points; you have ${getCommandCapacity(state) - getCommandUsed(state)} free. Expand command or sell a ship.`;
    } else if (check.reason === "Not enough credits") {
      tag.textContent = "Available";
      note.textContent = `Need ${formatNumber(price - state.credits)} more cr.`;
    } else {
      tag.textContent = "Available";
      note.textContent = `Ready to buy. New ships dock at ${HOME.name}, awaiting orders.`;
      affordable[typeId] = price;
    }
  }

  // Light up the Ships nav button when something can be bought
  // (a ship or a command upgrade), so the player notices.
  // Teal dots on the nav: a ship you can afford (Shipyard), or a
  // command upgrade you can afford (Fleet).
  // (The Shipyard's nav dot is set in render(), together with
  // ship components: see shipyardAlert.)
  lastAffordableShips = affordable;
  document.querySelector('.nav-btn[data-screen="fleet"]').classList.toggle("has-alert", canBuyUpgrade(state).ok);

  // Tell the player how many ships are still locked, and where
  // to see what's coming.
  const lockedCount = Object.keys(SHIP_TYPES).filter((typeId) => !isShipTypeUnlocked(state, typeId)).length;
  byId("shipyard-note").textContent = lockedCount === 0
    ? "Every ship type is unlocked."
    : `${lockedCount} more ship type${lockedCount === 1 ? "" : "s"} unlock as your skills level up. See Skills for what's next.`;
}


// Each skill on the Skills screen
function renderSkills(state) {
  for (const [skillId, skill] of Object.entries(SKILLS)) {
    const card = byId("skill-" + skillId);
    const progress = getLevelProgress(state, skillId);

    part(card, "level").textContent = progress.level;

    // The level perk: what every level adds, and the total so far.
    const perk = getLevelPerk(state, skillId);
    const perkHtml = `Every level: +${formatPercent(perk.perLevel)} ${skill.perk} · now <b>+${formatPercent(perk.total)}</b>`;
    if (part(card, "perk").innerHTML !== perkHtml) part(card, "perk").innerHTML = perkHtml;
    part(card, "bar").style.width = (progress.fraction * 100) + "%";
    part(card, "total").textContent = formatNumber(progress.xp) + " XP total";

    // Mining only: how much XP each ship keeps with today's fleet.
    if (skillId === "mining") {
      const working = state.jobs.filter((job) => job.type === "mining").length;
      const share = Math.round(getMiningXpShare(state) * 100);
      part(card, "share").textContent = working <= 1
        ? "Fleet XP: a lone ship earns full XP. Each extra ship mining adds a little less than the last."
        : `Fleet XP: ${working} ships mining, each earning ${share}% of its XP.`;
    }

    if (progress.isMax) {
      part(card, "xp").textContent = "Max level";
    } else {
      const left = progress.xpForNextLevel - progress.xpIntoLevel;
      // Round UP: 0.4 XP still needed should read "1", never "0".
      part(card, "xp").textContent = `${formatNumber(Math.ceil(left))} XP to level ${progress.level + 1}`;
    }

    // Mark each unlock as done or still to come.
    for (const line of card.querySelectorAll("[data-unlock]")) {
      // The key is "ship:excavator", "field:outer_belt",
      // "recipe:steel" or "slot:1";
      // .split(":") breaks it into its two halves.
      const [kind, id] = line.dataset.unlock.split(":");
      let unlocked;
      if (kind === "ship") unlocked = isShipTypeUnlocked(state, id);
      else if (kind === "field") unlocked = isFieldUnlocked(state, id);
      else if (kind === "recipe") unlocked = isRecipeUnlocked(state, id);
      else if (kind === "refinery") unlocked = isRefineryOpen(state);
      else if (kind === "workshop") unlocked = isWorkshopOpen(state);
      else if (kind === "wrecipe") unlocked = isWorkshopRecipeUnlocked(state, id);
      else if (kind === "wslot") unlocked = Number(id) < getWorkshopSlotCount(state);
      else if (kind === "queue") unlocked = getLevel(state, "manufacturing") >= Number(id);
      else if (kind === "upgrade") unlocked = getLevel(state, UPGRADES[id].skill) >= UPGRADES[id].level;
      else if (kind === "component") unlocked = getLevel(state, SHIP_UPGRADES[id].skill) >= SHIP_UPGRADES[id].level;
      else unlocked = Number(id) < getSlotCount(state);   // "slot:1" = the second slot
      line.classList.toggle("unlocked", unlocked);
      part(line, "state").textContent = unlocked ? "Unlocked" : "Locked";
    }
  }
}


// -------------------------------------------------------------
// renderRefinery(state, now)
// Each slot's dropdown, progress bar and status line, e.g.
//   "Smelting iron bars — 42s left"
//   "Waiting for 60 t iron ore"
// -------------------------------------------------------------
function renderRefinery(state, now) {
  const open = isRefineryOpen(state);
  const unlockedSlots = getSlotCount(state);   // 0 while closed

  byId("refinery-tag").textContent = open
    ? `${unlockedSlots} of ${getMaxSlots()} slots`
    : "Closed";
  byId("refinery-note").textContent = open
    ? ""
    : `The refinery opens at Mining ${REFINERY.openAtMiningLevel}. Until then, sell your ore on the Command screen.`;
  byId("refinery-note").hidden = open;

  for (let slot = 0; slot < getMaxSlots(); slot++) {
    const box = byId("refine-slot-" + slot);
    const select = part(box, "recipe");
    const status = part(box, "status");
    const specs = part(box, "specs");
    const bar = part(box, "bar");
    const tag = part(box, "tag");

    // --- A slot the player hasn't unlocked yet ---
    const locked = slot >= unlockedSlots;
    box.classList.toggle("locked", locked);
    if (select.disabled !== locked) select.disabled = locked;
    if (locked) {
      tag.textContent = "Locked";
      if (slot >= REFINERY.slotLevels.length) {
        // A slot that comes from an upgrade, not a level
        status.textContent = "Needs the Refinery slot 4 upgrade (Upgrades, below)";
      } else {
        status.textContent = open
          ? `Unlocks at Refining ${getSlotUnlockLevel(slot)}`
          : (slot === 0 ? `Opens with the refinery at Mining ${REFINERY.openAtMiningLevel}` : `Unlocks at Refining ${getSlotUnlockLevel(slot)}`);
      }
      specs.textContent = "";
      bar.style.width = "0%";
      continue;   // on to the next slot
    }

    // --- The recipe dropdown ---
    // Locked recipes are greyed out with the level they need.
    // Only change what's different, so an open dropdown isn't
    // closed by the 4-times-a-second redraw.
    for (const option of select.options) {
      if (!option.value) continue;   // the "Off" line
      const recipe = RECIPES[option.value];
      const unlocked = isRecipeUnlocked(state, option.value);
      const label = unlocked ? recipe.name : `${recipe.name} (Refining ${recipe.unlockLevel})`;
      if (option.textContent !== label) option.textContent = label;
      if (option.disabled === unlocked) option.disabled = !unlocked;
    }

    const job = getRefineJob(state, slot);
    const chosen = job ? job.recipeId : "";
    if (select.value !== chosen) select.value = chosen;

    // --- Off: nothing to show but a hint ---
    if (!job) {
      tag.textContent = "Off";
      status.textContent = "Pick a recipe to start smelting";
      specs.textContent = "";
      bar.style.width = "0%";
      box.classList.remove("busy", "waiting");
      continue;
    }

    // --- What one batch takes and makes, e.g.
    //     "60 t iron ore → 30 t iron bars · 1m 0s · 8 XP" ---
    const recipe = RECIPES[job.recipeId];
    // (Improved yield can make part-tonnes, e.g. 49.5 t of steel)
    const output = Math.round(getBatchOutput(state, job.recipeId) * 10) / 10;
    specs.textContent =
      `${describeInputs(job.recipeId, formatTonnes)} → ${output} t ` +
      `${ITEMS[recipe.output].name.toLowerCase()} · ${formatDuration(getBatchMs(state, job.recipeId))} · ${formatXp(recipe.xp)} XP`;

    if (job.status === "working") {
      const elapsed = Math.min(Math.max(now - job.startedAt, 0), job.durationMs);
      bar.style.width = (elapsed / job.durationMs * 100) + "%";
      tag.textContent = "Working";
      status.textContent = `Smelting ${recipe.name.toLowerCase()} — ${formatDuration(job.durationMs - elapsed)} left`;
      box.classList.add("busy");
      box.classList.remove("waiting");
    } else {
      bar.style.width = "0%";
      tag.textContent = "Waiting";
      status.textContent = hasInputs(state, job.recipeId)
        ? "Starting the next batch"
        : `Waiting for ${describeInputs(job.recipeId, formatTonnes)}`;
      box.classList.add("waiting");
      box.classList.remove("busy");
    }
  }
}


// -------------------------------------------------------------
// renderWorkshop(state, now)
// Each slot's current order, queue and order form, e.g.
//   "Hull plating: batch 4 of 20 — 1m 10s left"
//   "Waiting for 30 t iron bars"
//   "Idle. Queue an order to start."
// -------------------------------------------------------------
function renderWorkshop(state, now) {
  const open = isWorkshopOpen(state);
  const unlockedSlots = getWorkshopSlotCount(state);   // 0 while closed
  const queueLimit = getQueueLimit(state);

  byId("workshop-tag").textContent = open
    ? `${unlockedSlots} of ${WORKSHOP.slotLevels.length} slots · ${queueLimit} orders each`
    : "Closed";
  byId("workshop-note").textContent = open
    ? ""
    : `The workshop opens at Refining ${WORKSHOP.openAtRefiningLevel}. Keep the refinery busy to get there.`;
  byId("workshop-note").hidden = open;

  WORKSHOP.slotLevels.forEach((unlockLevel, slot) => {
    const box = byId("workshop-slot-" + slot);
    const tag = part(box, "tag");
    const bar = part(box, "bar");
    const status = part(box, "status");
    const queue = part(box, "queue");
    const form = part(box, "form");
    const specs = part(box, "specs");
    const select = part(box, "recipe");

    // --- A slot the player hasn't unlocked yet ---
    const locked = slot >= unlockedSlots;
    box.classList.toggle("locked", locked);
    form.hidden = locked;
    part(box, "standing").hidden = locked || !hasControlCentre(state);
    if (locked) {
      tag.textContent = "Locked";
      status.textContent = (!open && slot === 0)
        ? `Opens with the workshop at Refining ${WORKSHOP.openAtRefiningLevel}`
        : `Unlocks at Manufacturing ${getWorkshopSlotUnlockLevel(slot)}`;
      bar.style.width = "0%";
      specs.textContent = "";
      setQueueList(queue, null, "");
      box.classList.remove("busy", "waiting");
      return;
    }

    // --- The recipe dropdown: locked recipes greyed out ---
    // (Only change what's different, so an open dropdown isn't
    // closed by the 4-times-a-second redraw.)
    for (const option of select.options) {
      const recipe = WORKSHOP_RECIPES[option.value];
      const unlocked = isWorkshopRecipeUnlocked(state, option.value);
      const label = unlocked ? recipe.name : `${recipe.name} (Manufacturing ${recipe.unlockLevel})`;
      if (option.textContent !== label) option.textContent = label;
      if (option.disabled === unlocked) option.disabled = !unlocked;
    }

    // --- What one batch of the chosen recipe takes and makes ---
    // e.g. "30 t iron bars → 30 t hull plating · 1m 30s · 12 XP per batch"
    const chosen = WORKSHOP_RECIPES[select.value];
    if (chosen) {
      specs.textContent =
        `${describeWorkshopInputs(select.value, formatTonnes)} → ${formatTonnes(chosen.outputAmount)} ` +
        `${ITEMS[chosen.output].name.toLowerCase()} · ${formatDuration(getWorkshopBatchMs(state, select.value))} · ` +
        `${formatXp(chosen.xp)} XP per batch`;
    }

    const job = getWorkshopJob(state, slot);
    setQueueList(queue, job);
    renderStanding(state, box, slot, job);

    // The standing-order recipe menu greys out locked recipes too.
    for (const option of part(box, "standing-recipe").options) {
      const unlocked = isWorkshopRecipeUnlocked(state, option.value);
      if (option.disabled === unlocked) option.disabled = !unlocked;
    }

    // --- Idle: no orders at all ---
    if (!job) {
      tag.textContent = `Idle · 0/${queueLimit}`;
      status.textContent = "Idle. Queue an order to start.";
      bar.style.width = "0%";
      box.classList.remove("busy", "waiting");
      box.classList.add("idle");
      return;
    }
    box.classList.remove("idle");

    // A STANDING order's batch is running
    const standingIndex = job.status === "working" ? job.standingIndex ?? null : null;
    if (standingIndex !== null) {
      const standing = getStandingOrders(state, slot)[standingIndex];
      const standingRecipe = WORKSHOP_RECIPES[standing.recipeId];
      const stock = state.inventory[standingRecipe.output] || 0;
      const elapsed = Math.min(Math.max(now - job.startedAt, 0), job.durationMs);
      bar.style.width = (elapsed / job.durationMs * 100) + "%";
      tag.textContent = `Working · ${job.orders.length}/${queueLimit}`;
      status.textContent = `Standing order: ${standingRecipe.name.toLowerCase()} (${formatTonnes(stock)} of ${formatTonnes(standing.target)}) — ${formatDuration(job.durationMs - elapsed)} left`;
      box.classList.add("busy");
      box.classList.remove("waiting");
      return;   // (inside forEach, "return" moves on to the next slot)
    }

    // No work orders, only standing orders, and none running
    if (job.orders.length === 0) {
      bar.style.width = "0%";
      tag.textContent = `Standing by · 0/${queueLimit}`;
      const needy = getStandingOrders(state, slot).find((order) => standingNeedsWork(state, order));
      status.textContent = needy
        ? `Waiting for ${describeWorkshopInputs(needy.recipeId, formatTonnes)} (standing order)`
        : "Standing orders all stocked. Queue an order, or wait for stock to drop.";
      box.classList.toggle("waiting", Boolean(needy));
      box.classList.remove("busy");
      return;   // (inside forEach, "return" moves on to the next slot)
    }

    // The order being worked on. Usually the first; with the smart
    // queue it can be a later one while the first waits for metal.
    const order = job.status === "working" ? job.orders[getRunningIndex(job)] : job.orders[0];
    const recipe = WORKSHOP_RECIPES[order.recipeId];
    const batchNumber = order.done + 1;

    // The batch box can't go above the current largest order.
    const batchBox = part(box, "batches");
    const maxBatches = String(getMaxOrderBatches(state));
    if (batchBox.max !== maxBatches) batchBox.max = maxBatches;

    if (job.status === "working") {
      const elapsed = Math.min(Math.max(now - job.startedAt, 0), job.durationMs);
      bar.style.width = (elapsed / job.durationMs * 100) + "%";
      tag.textContent = `Working · ${job.orders.length}/${queueLimit}`;
      status.textContent = `${recipe.name}: batch ${batchNumber} of ${order.batches} — ${formatDuration(job.durationMs - elapsed)} left`;
      box.classList.add("busy");
      box.classList.remove("waiting");
    } else {
      bar.style.width = "0%";
      tag.textContent = `Waiting · ${job.orders.length}/${queueLimit}`;
      status.textContent = hasWorkshopInputs(state, order.recipeId)
        ? "Starting the next batch"
        : `Waiting for ${describeWorkshopInputs(order.recipeId, formatTonnes)}` +
          (hasSmartQueue(state) && job.orders.length > 1 ? " (later orders also short of metal)" : "");
      box.classList.add("waiting");
      box.classList.remove("busy");
    }
  });
}

// -------------------------------------------------------------
// renderStanding(state, box, slot, job)
// A slot's standing orders, one line each:
//   Keep 60 t hull plating · 32 t now          [x]
// The list is only rebuilt when the orders change (so the remove
// buttons don't swallow clicks); the "now" amounts are updated
// every redraw.
// -------------------------------------------------------------
function renderStanding(state, box, slot, job) {
  const list = part(box, "standing-list");
  const standing = getStandingOrders(state, slot);
  const running = job && job.status === "working" ? job.standingIndex ?? null : null;

  const signature = JSON.stringify(standing) + running;
  if (list.dataset.signature !== signature) {
    list.dataset.signature = signature;
    list.innerHTML = standing.map((order, index) => {
      const recipe = WORKSHOP_RECIPES[order.recipeId];
      return `
        <li class="order-line${index === running ? " running" : ""}">
          <span class="order-name">Keep ${formatTonnes(order.target)} ${recipe.name.toLowerCase()}
            <span class="order-done" data-stock="${recipe.output}"></span></span>
          <button class="btn btn-small order-cancel" data-remove="${index}"
                  title="Remove this standing order" aria-label="Remove ${recipe.name} standing order">✕</button>
        </li>
      `;
    }).join("");
  }
  // The stock right now, beside each line: "· 32 t now"
  for (const span of list.querySelectorAll("[data-stock]")) {
    const text = `· ${formatTonnes(state.inventory[span.dataset.stock] || 0)} now`;
    if (span.textContent !== text) span.textContent = text;
  }
  // Hide the Add form once the slot holds as many as it can.
  part(box, "standing-form").hidden = standing.length >= WORKSHOP.standingPerSlot;
}


// -------------------------------------------------------------
// setQueueList(list, job)
// Draws a slot's queue as a numbered list, one line per order:
//   1. Hull plating × 20 (3 done)        [x]
//   2. Wiring coils × 5                  [x]
// Redrawing it 4 times a second would swallow clicks on the
// cancel buttons, so it only redraws when the queue CHANGES.
// The list remembers what it last drew in a "signature".
// -------------------------------------------------------------
function setQueueList(list, job) {
  const orders = job ? job.orders : [];
  // Which line is running (-1 = none), so it can be highlighted.
  const running = job && job.status === "working" ? getRunningIndex(job) : -1;
  const signature = JSON.stringify(orders) + running;
  if (list.dataset.signature === signature) {
    return;   // nothing changed since last time
  }
  list.dataset.signature = signature;

  list.innerHTML = orders.map((order, index) => {
    const recipe = WORKSHOP_RECIPES[order.recipeId];
    const done = order.done > 0 ? ` <span class="order-done">(${order.done} done)</span>` : "";
    return `
      <li class="order-line${index === running ? " running" : ""}">
        <span class="order-name">${recipe.name} × ${order.batches}${done}</span>
        <button class="btn btn-small order-cancel" data-cancel="${index}"
                title="Cancel this order" aria-label="Cancel ${recipe.name} order">✕</button>
      </li>
    `;
  }).join("");
}


// =============================================================
// THE LOG
// =============================================================

// -------------------------------------------------------------
// addLog(message, kind)
// Adds a line to the ship's log panel (newest at the top).
// "kind" picks a coloured tag at the start of the line, so
// different events are easy to tell apart:
//   "trip"   a ship came home        "trade"  something sold
//   "level"  a level-up or unlock    "fleet"  ships and command
//   "refine" the refinery            "make"   the workshop
//   "system" anything else
// -------------------------------------------------------------
const LOG_TAGS = {
  trip: "TRIP",
  refine: "REFINE",
  make: "MAKE",
  trade: "TRADE",
  level: "LEVEL",
  fleet: "FLEET",
  system: "SYS",
};

export function addLog(message, kind = "system") {
  const log = byId("log");
  const line = document.createElement("li");
  line.className = "log-" + kind;

  // Show the time (UK style, 24-hour: "15:54"), a tag, then the message.
  const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  // Build the line from separate pieces (rather than one HTML
  // string) so a message can never accidentally contain HTML.
  const timeSpan = document.createElement("span");
  timeSpan.className = "log-time";
  timeSpan.textContent = time;

  const tagSpan = document.createElement("span");
  tagSpan.className = "log-tag";
  tagSpan.textContent = LOG_TAGS[kind] || LOG_TAGS.system;

  const textSpan = document.createElement("span");
  textSpan.className = "log-text";
  textSpan.textContent = message;

  line.append(timeSpan, tagSpan, textSpan);
  log.prepend(line);   // prepend = add to the top

  // Keep the log short: drop the oldest lines beyond 40.
  while (log.children.length > 40) {
    log.lastElementChild.remove();
  }
}


// =============================================================
// HELPERS for nice-looking numbers
// =============================================================

// 12345 -> "12,345"
export function formatNumber(number) {
  return Math.floor(number).toLocaleString("en-GB");
}

// Credits in a short form for tight spaces like the cargo table,
// in the same style as tonnes. Below 100,000 they're shown in
// full; above, with k (thousands), M (millions) or B (billions):
//   9,500 -> "9,500 cr"     250,000 -> "250k cr"
//   2,404,336 -> "2.4M cr"  1,250,000,000 -> "1.25B cr"
// (The Treasury at the top always shows the full number.)
export function formatCreditsShort(credits) {
  if (credits < 100_000) {
    return formatNumber(credits) + " cr";
  }
  if (credits < 1_000_000) {
    return threeFigures(credits / 1000) + "k cr";
  }
  if (credits < 1_000_000_000) {
    return threeFigures(credits / 1_000_000) + "M cr";
  }
  return threeFigures(credits / 1_000_000_000) + "B cr";
}

// Cargo in tonnes, switching to bigger units as it grows, with
// about three significant figures so it stays easy to read:
//   120 -> "120 t"      4800 -> "4.8 kt"     12500 -> "12.5 kt"
//   250000 -> "250 kt"  1250000 -> "1.25 Mt"
export function formatTonnes(tonnes) {
  if (tonnes < 1000) {
    return formatNumber(tonnes) + " t";
  }
  if (tonnes < 1_000_000) {
    return threeFigures(tonnes / 1000) + " kt";   // kilotonnes: thousands
  }
  return threeFigures(tonnes / 1_000_000) + " Mt"; // megatonnes: millions
}

// Shows a number with about 3 significant figures:
// 4.8 -> "4.8",  12.53 -> "12.5",  250.4 -> "250"
function threeFigures(number) {
  let decimals = 0;
  if (number < 10) decimals = 2;
  else if (number < 100) decimals = 1;
  return number.toLocaleString("en-GB", { maximumFractionDigits: decimals });
}

// A fraction as a percentage, to one decimal place at most:
//   0.005 -> "0.5%"    0.045 -> "4.5%"    0.15 -> "15%"
export function formatPercent(fraction) {
  return (Math.round(fraction * 1000) / 10).toLocaleString("en-GB") + "%";
}

// XP can be a fraction (14.4 XP for a 1,440 cr sale), so show
// one decimal place when needed:  6 -> "6",  14.4 -> "14.4"
export function formatXp(xp) {
  // Round to 1 decimal place first, so 14.400000001 shows as 14.4
  const rounded = Math.round(xp * 10) / 10;
  return rounded.toLocaleString("en-GB", { maximumFractionDigits: 1 });
}

// 75000 ms -> "1m 15s";  9000 ms -> "9s"
export function formatDuration(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);   // % = remainder
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}


// =============================================================
// SHIP COMPONENTS (on the Shipyard tab)
// -------------------------------------------------------------
// The upgrades in ship-upgrades.js, shown to players as "ship
// components". One collapsible section per hull type you own,
// headed by its drawing (with hardpoints) and a summary. Inside,
// one block per component type (drill, cargo hold, drive), each
// listing every grade, Mk I to Mk III:
//   Mk I    Mining 2    +15% mining rate               Fitted
//   Mk II   Mining 12   40 t wiring coils + 12,000 cr  [Buy]
//   Mk III  Mining 25   ...                            Locked
// Only the next grade can be bought.
// =============================================================

// -------------------------------------------------------------
// buildComponents(actions)
// Makes every section, block and row once; renderComponents
// fills in the parts that change.
// -------------------------------------------------------------
function buildComponents(actions) {
  const list = byId("components-list");
  list.innerHTML = "";

  for (const hullId of Object.keys(SHIP_TYPES)) {
    const parts = getHullParts(hullId);
    if (parts.length === 0) continue;   // a hull with no components yet

    // <details> opens and closes when its summary is clicked;
    // rememberOpenState keeps it that way across redraws.
    const section = document.createElement("details");
    section.className = "component-group expandable";
    section.id = "components-" + hullId;
    section.innerHTML = `
      <summary class="component-summary">
        <div class="ship-art" data-art="${hullId}"></div>
        <div class="component-head">
          <span class="card-name">${SHIP_TYPES[hullId].name}</span>
          <span class="component-tally" data-part="tally"></span>
        </div>
        <span class="expand-hint" aria-hidden="true"></span>
      </summary>
      <div class="component-body"></div>
    `;
    const body = section.querySelector(".component-body");

    for (const partId of parts) {
      const block = document.createElement("div");
      block.className = "component-block";
      block.innerHTML = `
        <h3 class="sub-title">${SHIP_PARTS[partId].name}
          <span class="component-total" data-part="total-${partId}"></span></h3>
      `;

      // One row per grade: Mk I, Mk II, Mk III...
      for (let grade = 1; findUpgrade(hullId, partId, grade); grade++) {
        const upgrade = findUpgrade(hullId, partId, grade);
        // The cost, e.g. "40 t wiring coils + 12,000 cr"
        const goods = Object.entries(upgrade.costs)
          .map(([itemId, tonnes]) => `${formatTonnes(tonnes)} ${ITEMS[itemId].name.toLowerCase()}`);
        const cost = [...goods, formatNumber(upgrade.credits) + " cr"].join(" + ");

        const row = document.createElement("div");
        row.className = "upgrade-row";
        row.id = "component-" + upgrade.id;
        row.innerHTML = `
          <div class="upgrade-text">
            <div class="upgrade-name">${upgrade.gradeName}
              <span class="upgrade-level">${SKILLS[upgrade.skill].name} ${upgrade.level}</span></div>
            <div class="upgrade-desc">+${formatPercent(upgrade.bonus)} ${SHIP_PARTS[partId].says}</div>
            <div class="upgrade-cost">${cost}</div>
            <div class="upgrade-reason" data-part="reason"></div>
          </div>
          <button class="btn btn-small" data-part="buy">Buy</button>
        `;
        part(row, "buy").addEventListener("click", () => {
          const result = actions.buyShipUpgrade(upgrade.id);
          byId("component-message").textContent = result.ok ? "" : `${getUpgradeName(upgrade)}: ${result.reason}`;
        });
        block.appendChild(row);
      }
      body.appendChild(block);
    }
    rememberOpenState(section);
    list.appendChild(section);
  }
}

// -------------------------------------------------------------
// renderComponents(state)
// Shows the sections for hull types you own, and sets every
// row: Fitted, ready to buy, or why not yet. Returns the IDs of
// the components that could be bought right now (for the nav dot).
// -------------------------------------------------------------
function renderComponents(state) {
  let fittedAll = 0;
  let totalAll = 0;
  let readyAll = 0;
  let anyShown = false;
  const readyIds = [];   // components you can buy now, for the nav dot

  for (const hullId of Object.keys(SHIP_TYPES)) {
    const section = byId("components-" + hullId);
    if (!section) continue;
    const owned = state.ships.some((ship) => ship.type === hullId);
    section.hidden = !owned;
    if (owned) anyShown = true;

    let fitted = 0;
    let total = 0;
    let ready = 0;

    for (const partId of getHullParts(hullId)) {
      const gradeNow = getPartGrade(state, hullId, partId);
      const bonus = getPartBonus(state, hullId, partId);
      // The component's total so far, beside its heading
      setText(part(section, "total-" + partId),
        bonus > 0 ? `+${formatPercent(bonus)} ${SHIP_PARTS[partId].says}` : "Stock");

      for (let grade = 1; findUpgrade(hullId, partId, grade); grade++) {
        const upgrade = findUpgrade(hullId, partId, grade);
        const row = byId("component-" + upgrade.id);
        const button = part(row, "buy");
        const reason = part(row, "reason");
        total++;

        if (grade <= gradeNow) {
          // Already fitted
          fitted++;
          row.classList.add("owned");
          row.classList.remove("blocked", "ready");
          setText(button, "Fitted");
          button.disabled = true;
          setText(reason, "");
          continue;
        }

        row.classList.remove("owned");
        const check = canBuyShipUpgrade(state, upgrade.id);
        // Only the next grade can be bought; later ones say what
        // comes first.
        setText(button, grade === gradeNow + 1 ? "Buy" : "Locked");
        button.disabled = !check.ok;
        row.classList.toggle("blocked", !check.ok);
        row.classList.toggle("ready", check.ok);
        setText(reason, check.ok ? "" : check.reason);
        if (check.ok && owned) {
          ready++;
          readyIds.push(upgrade.id);
        }
      }
    }

    // e.g. "3 of 9 fitted · 1 ready to buy"
    setText(part(section, "tally"),
      `${fitted} of ${total} fitted` + (ready > 0 ? ` · ${ready} ready to buy` : ""));
    section.classList.toggle("has-ready", ready > 0);
    fittedAll += fitted;
    totalAll += total;
    readyAll += ready;
  }

  byId("components-empty").hidden = anyShown;
  setText(byId("components-tag"),
    `${fittedAll} of ${totalAll} fitted` + (readyAll > 0 ? ` · ${readyAll} ready to buy` : ""));
  return readyIds;
}

// -------------------------------------------------------------
// setText(element, text)
// Changes an element's text only if it's different, so the
// screen isn't rewritten 4 times a second for nothing.
// -------------------------------------------------------------
function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}


// =============================================================
// THE DEV PANEL (playtest tools)
// -------------------------------------------------------------
// Built once at start-up, like the other screens. It stays
// hidden until dev mode is switched on (dev-switch.js, main.js).
// =============================================================

// -------------------------------------------------------------
// showDevPanel(on)
// Shows or hides the whole panel.
// -------------------------------------------------------------
export function showDevPanel(on) {
  byId("dev-wrap").hidden = !on;
}

// -------------------------------------------------------------
// buildDevPanel(actions)
// Fills in the speed buttons and dropdowns, and connects every
// button to its action in main.js.
// -------------------------------------------------------------
function buildDevPanel(actions) {
  const message = byId("dev-message");

  // Each action returns { ok } or { ok: false, reason }. Show the
  // reason if it was refused; clear the message if it worked.
  function report(result) {
    message.textContent = result.ok ? "" : result.reason;
  }

  // Number boxes give back text, e.g. "25". Number() turns it into
  // 25 (or NaN for nonsense, which the action then refuses).
  function numberIn(id) {
    return Number(byId(id).value);
  }

  // --- Speed buttons: 1x 2x 5x 10x 60x ---
  const speeds = byId("dev-speeds");
  for (const speed of SPEEDS) {
    const button = document.createElement("button");
    button.className = "btn btn-small dev-speed";
    button.dataset.speed = speed;           // read back when lighting it up
    button.textContent = speed + "×";
    button.addEventListener("click", () => report(actions.devSetSpeed(speed)));
    speeds.appendChild(button);
  }

  // --- Jump an hour ---
  byId("dev-jump").addEventListener("click", () => report(actions.devJumpHour()));

  // --- Skill dropdown: one option per skill ---
  const skillMenu = byId("dev-skill");
  for (const [skillId, skill] of Object.entries(SKILLS)) {
    skillMenu.add(new Option(skill.name, skillId));   // new Option(text, value)
  }
  byId("dev-set-level").addEventListener("click", () => {
    report(actions.devSetLevel(skillMenu.value, numberIn("dev-level")));
  });

  // --- Credits ---
  byId("dev-add-credits").addEventListener("click", () => {
    report(actions.devAddCredits(numberIn("dev-credits")));
  });

  // --- Goods dropdown: every item, ores to ship parts ---
  const itemMenu = byId("dev-item");
  for (const [itemId, item] of Object.entries(ITEMS)) {
    itemMenu.add(new Option(item.name, itemId));
  }
  byId("dev-add-goods").addEventListener("click", () => {
    report(actions.devAddGoods(itemMenu.value, numberIn("dev-tonnes")));
  });
}
