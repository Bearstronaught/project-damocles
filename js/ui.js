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

import { ITEMS, SHIP_TYPES, FIELDS, SKILLS } from "../data/content.js";
import { getJobForShip, getJobPhase, getTripPlan } from "./jobs.js";
import { getLevel, getLevelProgress, isShipTypeUnlocked } from "./skills.js";
import { canBuyShip } from "./shipyard.js";
import { getSchematic } from "./art.js";

// The screens that exist, in nav order. The first is the default.
const SCREENS = ["command", "ships", "skills"];

// Only one field exists so far, so every trip goes here.
// (When there are more fields, each ship will pick its own.)
const DEFAULT_FIELD = "inner_belt";

// Words shown for each phase of a trip.
const PHASE_LABELS = {
  outbound: "Outbound",
  mining: "Mining",
  returning: "Returning",
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
//   actions.sellOre()   actions.dispatchShip(shipId)
// -------------------------------------------------------------
export function setupUI(state, actions) {
  setupNavigation();
  setupResetButton(actions);

  byId("sell-ore").addEventListener("click", () => actions.sellOre());
  byId("ore-price").textContent = ITEMS.iron_ore.sellPrice;

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
  // location.hash is "#ships"; .slice(1) drops the "#".
  let name = location.hash.slice(1);

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
// RESET BUTTON
// It can't be undone, so it needs two clicks: the first click
// "arms" it, the second (within 4 seconds) wipes the save.
// We don't use the browser's confirm() pop-up because some
// places (like embedded previews) block it.
// -------------------------------------------------------------
function setupResetButton(actions) {
  const resetButton = byId("reset-game");
  let resetArmed = false;

  resetButton.addEventListener("click", () => {
    if (!resetArmed) {
      resetArmed = true;
      resetButton.textContent = "Click again to wipe your save";
      // If they don't click again in time, put the button back.
      setTimeout(() => {
        resetArmed = false;
        resetButton.textContent = "Reset save";
      }, 4000);
      return;
    }
    resetArmed = false;
    resetButton.textContent = "Reset save";
    actions.resetGame();
  });
}


// -------------------------------------------------------------
// statsList(typeId)
// The full stat block for a ship type, as HTML. Used on the
// Ships screen for both owned ships and the shipyard, so the
// two always match and can be compared.
// -------------------------------------------------------------
function statsList(typeId) {
  const shipType = SHIP_TYPES[typeId];
  const plan = getTripPlan(typeId, DEFAULT_FIELD);
  const price = ITEMS[FIELDS[DEFAULT_FIELD].yields].sellPrice;

  // How many trips fit in an hour, then what that adds up to.
  const tripsPerHour = (60 * 60 * 1000) / plan.durationMs;
  const orePerHour = plan.orePerTrip * tripsPerHour;
  const creditsPerHour = orePerHour * price;
  const xpPerHour = plan.xpPerTrip * tripsPerHour;

  // <dl> is a "description list": pairs of label (dt) and value (dd).
  return `
    <dl class="stats">
      <dt>Cargo hold</dt>   <dd>${shipType.cargoCapacity} units</dd>
      <dt>Mining rate</dt>  <dd>${shipType.miningRate} units/min</dd>
      <dt>Drive speed</dt>  <dd>${shipType.speed.toFixed(2)}×</dd>
      <dt>Round trip</dt>   <dd>${formatDuration(plan.durationMs)}</dd>
      <dt>Ore per hour</dt> <dd>${formatNumber(orePerHour)}</dd>
      <dt>Income</dt>       <dd class="stat-hot">${formatNumber(creditsPerHour)} cr/h</dd>
      <dt>Mining XP</dt>    <dd>${formatNumber(xpPerHour)} XP/h</dd>
    </dl>
  `;
}


// -------------------------------------------------------------
// routeTracker(fieldName)
// The three-part bar showing a trip: out, mine, back.
// Each segment's width is set later to match how long that
// phase takes, so a long mining stop LOOKS long.
// -------------------------------------------------------------
function routeTracker(fieldName) {
  return `
    <div class="route" data-part="route">
      <div class="route-track">
        <div class="seg seg-out"  data-part="seg-out"><div class="seg-fill"></div></div>
        <div class="seg seg-mine" data-part="seg-mine"><div class="seg-fill"></div></div>
        <div class="seg seg-back" data-part="seg-back"><div class="seg-fill"></div></div>
      </div>
      <div class="route-labels">
        <span>Home</span>
        <span class="route-field">${fieldName}</span>
        <span>Home</span>
      </div>
    </div>
  `;
}


// -------------------------------------------------------------
// buildFleetViews(state, actions)
// Builds everything that shows the player's own ships:
//   - the ship cards on the Command screen
//   - the "Your fleet" list on the Ships screen
// Called at start-up, and again whenever the fleet changes
// (a ship bought, a reset).
// -------------------------------------------------------------
export function buildFleetViews(state, actions) {
  buildFleetCards(state, actions);
  buildOwnedList(state);
}

function buildFleetCards(state, actions) {
  const fleetList = byId("fleet-list");
  fleetList.innerHTML = "";   // clear the old cards

  for (const ship of state.ships) {
    const shipType = SHIP_TYPES[ship.type];

    const card = document.createElement("div");
    card.className = "ship-card";
    card.id = "ship-" + ship.id;

    // The card's layout. Parts we update later get a
    // "data-part" label so we can find them again.
    card.innerHTML = `
      <div class="ship-art">${getSchematic(shipType.art)}</div>
      <div class="ship-body">
        <div class="card-header">
          <span class="card-name">${ship.name}</span>
          <span class="card-sub">${shipType.name}</span>
        </div>
        ${routeTracker(FIELDS[DEFAULT_FIELD].name)}
        <div class="ship-status" data-part="status">Idle</div>
        <div class="ship-specs">
          Hold <b>${shipType.cargoCapacity}</b>
          · Drill <b>${shipType.miningRate}/min</b>
          · Drive <b>${shipType.speed.toFixed(2)}×</b>
        </div>
        <button class="btn" data-part="button">Dispatch</button>
      </div>
    `;

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

function buildOwnedList(state) {
  const list = byId("owned-list");
  list.innerHTML = "";

  for (const ship of state.ships) {
    const shipType = SHIP_TYPES[ship.type];

    const row = document.createElement("div");
    row.className = "owned-row";
    row.id = "owned-" + ship.id;
    row.innerHTML = `
      <div class="ship-art">${getSchematic(shipType.art)}</div>
      <div class="owned-main">
        <div class="card-header">
          <span class="card-name">${ship.name}</span>
          <span class="card-sub">${shipType.name}</span>
        </div>
        <div class="owned-status" data-part="status">Docked</div>
        <p class="ship-desc">${shipType.description}</p>
      </div>
      ${statsList(ship.type)}
    `;
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
        <dt>Role</dt>      <dd>${skillName}</dd>
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
// One card per skill, each with an XP bar and its unlock list.
// -------------------------------------------------------------
function buildSkillCards() {
  const list = byId("skills-list");
  list.innerHTML = "";

  for (const [skillId, skill] of Object.entries(SKILLS)) {
    // Find this skill's ship unlocks, lowest level first.
    const unlocks = Object.entries(SHIP_TYPES)
      .filter(([, shipType]) => shipType.skill === skillId)
      .sort((a, b) => a[1].unlockLevel - b[1].unlockLevel);

    // Turn each unlock into a line of the list.
    const unlockLines = unlocks.map(([typeId, shipType]) => `
      <li data-unlock="${typeId}">
        <span class="unlock-level">Lv ${shipType.unlockLevel}</span>
        <span class="unlock-name">${shipType.name}</span>
        <span class="unlock-state" data-part="state"></span>
      </li>
    `).join("");

    const card = document.createElement("div");
    card.className = "skill-card";
    card.id = "skill-" + skillId;
    card.innerHTML = `
      <div class="card-header">
        <span class="card-name">${skill.name}</span>
        <span class="skill-level"><span data-part="level">1</span><small>/99</small></span>
      </div>
      <p class="skill-desc">${skill.description}</p>
      <div class="progress"><div class="progress-fill xp-fill" data-part="bar"></div></div>
      <div class="skill-xp">
        <span data-part="xp"></span>
        <span class="skill-total" data-part="total"></span>
      </div>
      <h3 class="sub-title">Ship unlocks</h3>
      <ul class="unlock-list">${unlockLines}</ul>
    `;
    list.appendChild(card);
  }
}


// =============================================================
// RENDER (runs 4 times a second)
// =============================================================

export function render(state, now) {
  renderTreasury(state);
  renderStatusStrip(state, now);
  renderFleet(state, now);
  renderShipyard(state);
  renderSkills(state);
}


// Credits and cargo
function renderTreasury(state) {
  const ore = state.inventory.iron_ore || 0;
  const orePrice = ITEMS.iron_ore.sellPrice;

  byId("credits").textContent = formatNumber(state.credits) + " cr";
  byId("ore-amount").textContent = formatNumber(ore);
  byId("ore-value").textContent = formatNumber(ore * orePrice) + " cr";

  // The Sell button is greyed out when there's nothing to sell.
  byId("sell-ore").disabled = ore === 0;
}


// The thin strip of readouts under the top bar
function renderStatusStrip(state, now) {
  byId("clock").textContent = new Date(now).toLocaleTimeString("en-GB");
  byId("fleet-size").textContent = state.ships.length;
  byId("mining-level").textContent = "Lv " + getLevel(state, "mining");

  // "1 ship" / "2 ships" in the panel corners
  const count = state.ships.length + (state.ships.length === 1 ? " ship" : " ships");
  byId("fleet-tag").textContent = count;
  byId("your-fleet-tag").textContent = count;
}


// Each ship: its card on Command and its row on Ships
function renderFleet(state, now) {
  for (const ship of state.ships) {
    const card = byId("ship-" + ship.id);
    const row = byId("owned-" + ship.id);
    if (!card || !row) continue;   // (not built yet - skip this time)

    const job = getJobForShip(state, ship.id);
    const fieldName = FIELDS[DEFAULT_FIELD].name;

    // Segment widths: from the running job, or (when docked)
    // from the trip this ship WOULD make, as a preview.
    const timing = job || getTripPlan(ship.type, DEFAULT_FIELD);
    part(card, "seg-out").style.flexGrow = timing.outboundMs;
    part(card, "seg-mine").style.flexGrow = timing.miningMs;
    part(card, "seg-back").style.flexGrow = timing.returnMs;

    const fills = part(card, "route").querySelectorAll(".seg-fill");
    const status = part(card, "status");
    const button = part(card, "button");

    // Remove last frame's phase class before adding this one's.
    card.classList.remove("phase-outbound", "phase-mining", "phase-returning", "busy");

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
      part(row, "status").textContent = PHASE_LABELS[phase.phase] + " · " + timeLeft;
      button.textContent = "Recall";
      card.classList.add("busy", "phase-" + phase.phase);
      row.classList.add("busy");
    } else {
      fills.forEach((fill) => { fill.style.width = "0%"; });
      status.textContent = "Docked at home — awaiting orders";
      part(row, "status").textContent = "Docked at home";
      button.textContent = "Dispatch to " + fieldName;
      row.classList.remove("busy");
    }
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
    card.classList.toggle("locked", !unlocked);

    // Pick the tag, note and button text for each situation.
    if (shipType.cost === null) {
      tag.textContent = "Starter";
      note.textContent = "Your first barge. Not sold at this yard.";
      button.hidden = true;
    } else if (!unlocked) {
      const skillName = SKILLS[shipType.skill].name;
      const level = getLevel(state, shipType.skill);
      tag.textContent = "Locked";
      note.textContent = `Reach ${skillName} level ${shipType.unlockLevel} to unlock (you're level ${level}).`;
      button.hidden = false;
      button.disabled = true;
      button.textContent = `Buy — ${formatNumber(shipType.cost)} cr`;
    } else {
      tag.textContent = "Available";
      button.hidden = false;
      button.disabled = !check.ok;
      button.textContent = `Buy — ${formatNumber(shipType.cost)} cr`;

      if (check.ok) {
        note.textContent = "Ready to buy. New ships dock at home, awaiting orders.";
        anythingToBuy = true;
      } else {
        const shortBy = shipType.cost - state.credits;
        note.textContent = `Need ${formatNumber(shortBy)} more cr.`;
      }
    }
  }

  // Light up the Ships nav button when something can be bought,
  // so the player notices without having to check.
  const shipsNav = document.querySelector('.nav-btn[data-screen="ships"]');
  shipsNav.classList.toggle("has-alert", anythingToBuy);
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
      part(card, "xp").textContent = `${formatNumber(left)} XP to level ${progress.level + 1}`;
    }

    // Mark each unlock as done or still to come.
    for (const line of card.querySelectorAll("[data-unlock]")) {
      const unlocked = isShipTypeUnlocked(state, line.dataset.unlock);
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
//   "level"  a level-up or unlock    "fleet"  ship bought / recalled
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
