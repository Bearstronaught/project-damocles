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

import { ITEMS, SHIP_TYPES, FIELDS, SKILLS, HULL_SIZES, COMMAND, HUB, HAUL_MODES } from "../data/content.js";
import { getJobForShip, getJobPhase, getTripPlan, getHaulPlan, getOreInHold } from "./jobs.js";
import { getLevel, getLevelProgress, isShipTypeUnlocked, isFieldUnlocked } from "./skills.js";
import { canBuyShip, canSellShip, getSellValue } from "./shipyard.js";
import { getShipPoints, getCommandCapacity, getCommandUsed, getNextUpgradeCost, canBuyUpgrade } from "./command.js";
import { getCargoValue, getTradeXp } from "./trade.js";
import { getSchematic } from "./art.js";

// The screens that exist, in nav order. The first is the default.
const SCREENS = ["command", "fleet", "shipyard", "skills"];

// Words shown for each phase of a trip.
const PHASE_LABELS = {
  outbound: "Outbound",
  mining: "Mining",
  trading: "Trading",
  returning: "Returning",
  waiting: "Waiting for cargo",
};


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
// statsList(typeId)
// The full stat block for a ship type, as HTML: its hull stats,
// then a small table of what a round trip to each field gives.
// Used for both owned ships and the shipyard, so they always
// match and can be compared.
// -------------------------------------------------------------
function statsList(typeId) {
  const shipType = SHIP_TYPES[typeId];
  if (shipType.role === "freight") {
    return freighterStats(typeId);
  }
  const sizeName = HULL_SIZES[shipType.size].name;

  // One row per field: trip length, income and XP per hour.
  // data-field lets render() dim the fields that are locked.
  const fieldRows = Object.entries(FIELDS).map(([fieldId, field]) => {
    const plan = getTripPlan(typeId, fieldId);
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
        <dt>Cargo hold</dt>   <dd>${formatTonnes(shipType.cargoCapacity)}</dd>
        <dt>Mining rate</dt>  <dd>${formatTonnes(shipType.miningRate)}/min</dd>
        <dt>Drive speed</dt>  <dd>${shipType.speed.toFixed(2)}×</dd>
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
// freighterStats(typeId)
// A freighter's stat block: its hull, then what ONE full run to
// the hub earns for each kind of ore, compared with selling the
// same load at home.
// -------------------------------------------------------------
function freighterStats(typeId) {
  const shipType = SHIP_TYPES[typeId];
  const sizeName = HULL_SIZES[shipType.size].name;
  const plan = getHaulPlan(typeId);

  const oreRows = Object.entries(ITEMS).map(([itemId, item]) => {
    const hubCredits = plan.capacity * item.hubPrice;
    const homeCredits = plan.capacity * item.sellPrice;
    return `
      <tr>
        <td>${item.name}</td>
        <td class="stat-hot">${formatNumber(hubCredits)}</td>
        <td>+${formatNumber(hubCredits - homeCredits)}</td>
        <td>${formatXp(getTradeXp(hubCredits, plan.capacity))}</td>
      </tr>
    `;
  }).join("");

  return `
    <div class="stat-block">
      <dl class="stats">
        <dt>Hull</dt>         <dd>${sizeName} · ${getShipPoints(typeId)} cmd pt${getShipPoints(typeId) === 1 ? "" : "s"}</dd>
        <dt>Cargo hold</dt>   <dd>${formatTonnes(shipType.cargoCapacity)}</dd>
        <dt>Drive speed</dt>  <dd>${shipType.speed.toFixed(2)}×</dd>
        <dt>Hub run</dt>      <dd>${formatDuration(plan.durationMs)} round trip</dd>
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
// The three-part bar showing a trip: out, mine (or trade), back.
// Each segment's width is set later to match how long that
// phase takes, so a long mining stop LOOKS long.
// -------------------------------------------------------------
function routeTracker() {
  return `
    <div class="route" data-part="route">
      <div class="route-track">
        <div class="seg seg-out"  data-part="seg-out"><div class="seg-fill"></div></div>
        <div class="seg seg-mine" data-part="seg-mine"><div class="seg-fill"></div></div>
        <div class="seg seg-back" data-part="seg-back"><div class="seg-fill"></div></div>
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
      <td data-part="amount">0</td>
      <td class="cargo-price">${item.sellPrice}</td>
      <td class="cargo-price cargo-hub">${item.hubPrice}</td>
      <td data-part="value">0 cr</td>
      <td><button class="btn btn-small" data-part="sell">Sell</button></td>
    `;
    part(row, "sell").addEventListener("click", () => actions.sellItem(itemId));
    body.appendChild(row);
  }

  // The note under the table explains the two prices.
  byId("hub-note").textContent =
    `Selling here is instant at the home price. The ${HUB.name.toLowerCase()} pays the hub price, ` +
    `but needs a freighter to haul the ore there (freighters unlock with Trade levels).`;
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

function buildFleetCards(state, actions) {
  const fleetList = byId("fleet-list");
  fleetList.innerHTML = "";   // clear the old cards

  for (const ship of state.ships) {
    const shipType = SHIP_TYPES[ship.type];

    const isFreighter = shipType.role === "freight";

    const card = document.createElement("div");
    card.className = "ship-card";
    card.id = "ship-" + ship.id;

    // Barges pick a field; freighters pick a haul mode.
    // (Freighters have no drill, so their specs skip it.)
    const picker = isFreighter ? haulModePicker() : destinationPicker();
    const drill = isFreighter ? "" : ` · Drill <b>${formatTonnes(shipType.miningRate)}/min</b>`;

    // The card's layout. Parts we update later get a
    // "data-part" label so we can find them again.
    card.innerHTML = `
      <div class="ship-art">${getSchematic(shipType.art)}</div>
      <div class="ship-body">
        <div class="card-header">
          <span class="card-name">${ship.name}</span>
          <span class="card-sub">${shipType.name}</span>
        </div>
        ${picker}
        ${routeTracker()}
        <div class="ship-status" data-part="status">Idle</div>
        <div class="ship-specs">
          Hold <b>${formatTonnes(shipType.cargoCapacity)}</b>${drill}
          · Drive <b>${shipType.speed.toFixed(2)}×</b>
        </div>
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
    // or call it back, depending on whether it's busy.
    part(card, "button").addEventListener("click", () => {
      if (getJobForShip(actions.getState(), ship.id)) {
        actions.recallShip(ship.id);
      } else {
        actions.dispatchShip(ship.id);
      }
    });

    fleetList.appendChild(card);
  }
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
        <div class="ship-art">${getSchematic(shipType.art)}</div>
        <div class="owned-main">
          <div class="card-header">
            <span class="card-name">${ship.name}</span>
            <span class="card-sub">${shipType.name}</span>
          </div>
          <div class="owned-status" data-part="status">Docked</div>
        </div>
        <span class="expand-hint" aria-hidden="true"></span>
      </summary>
      <div class="owned-detail">
        <div>
          <p class="ship-desc">${shipType.description}</p>
          <button class="btn btn-sell" data-part="sell"></button>
          <div class="sell-note" data-part="sell-note"></div>
        </div>
        ${statsList(ship.type)}
      </div>
    `;
    rememberOpenState(row);

    makeTwoClick(part(row, "sell"), "Click again to sell", () => {
      actions.sellShip(ship.id);
    });

    list.appendChild(row);
  }
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
    const price = shipType.cost === null ? "Not sold" : formatNumber(shipType.cost) + " cr";

    const card = document.createElement("div");
    card.className = "yard-card";
    card.id = "yard-" + typeId;
    card.innerHTML = `
      <div class="card-header">
        <span class="card-name">${shipType.name}</span>
        <span class="card-tag" data-part="tag"></span>
      </div>
      <div class="yard-art">${getSchematic(shipType.art)}</div>
      <p class="ship-desc">${shipType.description}</p>
      ${statsList(typeId)}
      <dl class="stats stats-yard">
        <dt>Requires</dt>  <dd>${skillName} level ${shipType.unlockLevel}</dd>
        <dt>Price</dt>     <dd>${price}</dd>
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
      </summary>
      <div class="skill-detail">
        <p class="skill-desc">${skill.description}</p>
        <p class="skill-total" data-part="total"></p>
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
  renderCargo(state);
  renderStatusStrip(state, now);
  renderFleet(state, now);
  renderOwnedList(state);
  renderCommand(state);
  renderShipyard(state);
  renderSkills(state);
}


// Credits and the cargo hold
function renderCargo(state) {
  byId("credits").textContent = formatNumber(state.credits) + " cr";

  for (const [itemId, item] of Object.entries(ITEMS)) {
    const row = byId("cargo-" + itemId);
    const amount = state.inventory[itemId] || 0;
    part(row, "amount").textContent = formatTonnes(amount);
    part(row, "value").textContent = formatNumber(amount * item.sellPrice) + " cr";
    part(row, "sell").disabled = amount === 0;
    // Dim rows for items you have none of
    row.classList.toggle("empty", amount === 0);
  }

  const total = getCargoValue(state);
  byId("cargo-total").textContent = formatNumber(total) + " cr";
  byId("sell-all").disabled = total === 0;
}


// The thin strip of readouts under the top bar
function renderStatusStrip(state, now) {
  byId("clock").textContent = new Date(now).toLocaleTimeString("en-GB");
  byId("mining-level").textContent = "Lv " + getLevel(state, "mining");
  byId("trade-level").textContent = "Lv " + getLevel(state, "trade");
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
    const timing = job || getTripPlan(ship.type, fieldId);
    part(card, "seg-out").style.flexGrow = timing.outboundMs;
    part(card, "seg-mine").style.flexGrow = timing.miningMs;
    part(card, "seg-back").style.flexGrow = timing.returnMs;

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

      status.textContent = text;
      button.textContent = "Recall";
      card.classList.add("busy", "phase-" + phase.phase);
    } else {
      fills.forEach((fill) => { fill.style.width = "0%"; });
      status.textContent = "Docked at home — awaiting orders";
      button.textContent = "Dispatch to " + fieldName;
    }
  }
}


// Every phase class a card can have, so each frame can clear
// last frame's before adding the current one.
const ALL_PHASE_CLASSES = ["phase-outbound", "phase-mining", "phase-trading",
  "phase-returning", "phase-waiting", "busy"];


// -------------------------------------------------------------
// renderFreighterCard(state, ship, card, now)
// A freighter's card: haul mode buttons, the Home -> Hub -> Home
// tracker, and what it's doing.
// -------------------------------------------------------------
function renderFreighterCard(state, ship, card, now) {
  const job = getJobForShip(state, ship.id);
  const capacity = SHIP_TYPES[ship.type].cargoCapacity;
  const mode = ship.haulMode || "full";

  // Highlight the chosen haul mode.
  for (const modeButton of part(card, "modes").querySelectorAll(".dest-btn")) {
    modeButton.classList.toggle("selected", modeButton.dataset.mode === mode);
  }

  // The tracker's middle stop is the hub; its segments are
  // sized from the job, or from a planned run while docked.
  part(card, "route-field").textContent = HUB.name;
  const timing = job || getHaulPlan(ship.type);
  part(card, "seg-out").style.flexGrow = timing.outboundMs;
  part(card, "seg-mine").style.flexGrow = timing.tradeMs;
  part(card, "seg-back").style.flexGrow = timing.returnMs;

  const fills = part(card, "route").querySelectorAll(".seg-fill");
  const status = part(card, "status");
  const button = part(card, "button");
  card.classList.remove(...ALL_PHASE_CLASSES);

  if (!job) {
    fills.forEach((fill) => { fill.style.width = "0%"; });
    status.textContent = "Docked at home — awaiting orders";
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
  if (phase.phase === "outbound") text = `Hauling ${formatTonnes(tonnes)} to the hub — arrives in ${timeLeft}`;
  if (phase.phase === "trading") text = `Selling at the hub — done in ${timeLeft}`;
  if (phase.phase === "returning") text = `Returning home — docks in ${timeLeft}`;

  status.textContent = text;
  button.textContent = "Recall";
  card.classList.add("busy", "phase-" + phase.phase);
}


// Each ship's row on the Ships screen
function renderOwnedList(state) {
  const now = Date.now();
  for (const ship of state.ships) {
    const row = byId("owned-" + ship.id);
    if (!row) continue;

    const job = getJobForShip(state, ship.id);
    if (job) {
      const phase = getJobPhase(job, now);
      if (job.type === "haul") {
        // e.g. "Trading · Merchant hub · 12s", or just "Waiting for cargo"
        part(row, "status").textContent = phase.phase === "waiting"
          ? PHASE_LABELS.waiting
          : PHASE_LABELS[phase.phase] + " · " + HUB.name + " · " + formatDuration(phase.msLeftInPhase);
      } else {
        part(row, "status").textContent =
          PHASE_LABELS[phase.phase] + " · " + FIELDS[job.fieldId].name + " · " + formatDuration(phase.msLeftInPhase);
      }
    } else {
      part(row, "status").textContent = "Docked at home";
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
      sellButton.textContent = "Sell — " + formatNumber(getSellValue(ship.type)) + " cr";
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


// Each ship type on the Ships screen, plus the nav alert dot
function renderShipyard(state) {
  let anythingToBuy = false;

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

    // Pick the tag, note and button text for each situation.
    if (shipType.cost === null) {
      tag.textContent = "Starter";
      note.textContent = "Your first barge. Not sold at this yard.";
      button.hidden = true;
      continue;
    }

    button.hidden = false;
    button.disabled = !check.ok;
    button.textContent = `Buy — ${formatNumber(shipType.cost)} cr`;

    // (Locked ships were skipped above, so they never get here.)
    if (check.reason === "Not enough command points") {
      tag.textContent = "Available";
      note.textContent = `Needs ${getShipPoints(typeId)} command points; you have ${getCommandCapacity(state) - getCommandUsed(state)} free. Expand command or sell a ship.`;
    } else if (check.reason === "Not enough credits") {
      tag.textContent = "Available";
      note.textContent = `Need ${formatNumber(shipType.cost - state.credits)} more cr.`;
    } else {
      tag.textContent = "Available";
      note.textContent = "Ready to buy. New ships dock at home, awaiting orders.";
      anythingToBuy = true;
    }
  }

  // Light up the Ships nav button when something can be bought
  // (a ship or a command upgrade), so the player notices.
  // Teal dots on the nav: a ship you can afford (Shipyard), or a
  // command upgrade you can afford (Fleet).
  document.querySelector('.nav-btn[data-screen="shipyard"]').classList.toggle("has-alert", anythingToBuy);
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
  for (const skillId of Object.keys(SKILLS)) {
    const card = byId("skill-" + skillId);
    const progress = getLevelProgress(state, skillId);

    part(card, "level").textContent = progress.level;
    part(card, "bar").style.width = (progress.fraction * 100) + "%";
    part(card, "total").textContent = formatNumber(progress.xp) + " XP total";

    if (progress.isMax) {
      part(card, "xp").textContent = "Max level";
    } else {
      const left = progress.xpForNextLevel - progress.xpIntoLevel;
      // Round UP: 0.4 XP still needed should read "1", never "0".
      part(card, "xp").textContent = `${formatNumber(Math.ceil(left))} XP to level ${progress.level + 1}`;
    }

    // Mark each unlock as done or still to come.
    for (const line of card.querySelectorAll("[data-unlock]")) {
      // The key is "ship:excavator" or "field:outer_belt";
      // .split(":") breaks it into its two halves.
      const [kind, id] = line.dataset.unlock.split(":");
      const unlocked = kind === "ship" ? isShipTypeUnlocked(state, id) : isFieldUnlocked(state, id);
      line.classList.toggle("unlocked", unlocked);
      part(line, "state").textContent = unlocked ? "Unlocked" : "Locked";
    }
  }
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
//   "system" anything else
// -------------------------------------------------------------
const LOG_TAGS = {
  trip: "TRIP",
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
