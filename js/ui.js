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
import { getJobForShip, getJobProgress } from "./jobs.js";
import { getLevel, getLevelProgress, isShipTypeUnlocked } from "./skills.js";
import { canBuyShip } from "./shipyard.js";

// The screens that exist, in nav order. The first is the default.
const SCREENS = ["command", "ships", "skills"];


// Shortcut: find an element on the page by its id="..." name.
function byId(id) {
  return document.getElementById(id);
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

  buildFleetCards(state, actions);
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
// buildFleetCards(state, actions)
// One "ship card" per ship. Called at start-up, and again
// whenever the fleet changes (a ship bought, a reset).
// -------------------------------------------------------------
export function buildFleetCards(state, actions) {
  const fleetList = byId("fleet-list");
  fleetList.innerHTML = "";   // clear the old cards

  for (const ship of state.ships) {
    const card = document.createElement("div");
    card.className = "ship-card";
    card.id = "ship-" + ship.id;

    // The card's layout. Parts we update later get a
    // "data-part" label so we can find them again.
    card.innerHTML = `
      <div class="card-header">
        <span class="card-name">${ship.name}</span>
        <span class="card-sub">${SHIP_TYPES[ship.type].name}</span>
      </div>
      <div class="ship-status" data-part="status">Idle</div>
      <div class="progress"><div class="progress-fill" data-part="bar"></div></div>
      <button class="btn" data-part="button">Dispatch</button>
    `;

    // When this ship's button is clicked, either send it out
    // or call it back, depending on whether it's busy.
    card.querySelector('[data-part="button"]').addEventListener("click", () => {
      if (getJobForShip(actions.getState(), ship.id)) {
        actions.recallShip(ship.id);
      } else {
        actions.dispatchShip(ship.id);
      }
    });

    fleetList.appendChild(card);
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

    const card = document.createElement("div");
    card.className = "yard-card";
    card.id = "yard-" + typeId;
    card.innerHTML = `
      <div class="card-header">
        <span class="card-name">${shipType.name}</span>
        <span class="card-tag" data-part="tag"></span>
      </div>
      <dl class="stats">
        <dt>Role</dt>       <dd>${skillName}</dd>
        <dt>Cargo</dt>      <dd>${shipType.cargoCapacity} units/trip</dd>
        <dt>Requires</dt>   <dd>${skillName} level ${shipType.unlockLevel}</dd>
        <dt>Owned</dt>      <dd data-part="owned">0</dd>
      </dl>
      <div class="yard-note" data-part="note"></div>
      <button class="btn" data-part="button"></button>
    `;

    card.querySelector('[data-part="button"]').addEventListener("click", () => {
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
        <span class="skill-level" data-part="level">Level 1</span>
      </div>
      <p class="skill-desc">${skill.description}</p>
      <div class="progress"><div class="progress-fill xp-fill" data-part="bar"></div></div>
      <div class="skill-xp" data-part="xp"></div>
      <h3 class="sub-title">SHIP UNLOCKS</h3>
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


// Each ship card on the Command screen
function renderFleet(state, now) {
  for (const ship of state.ships) {
    const card = byId("ship-" + ship.id);
    if (!card) continue;   // (card not built yet - skip this time)

    const statusText = card.querySelector('[data-part="status"]');
    const bar = card.querySelector('[data-part="bar"]');
    const button = card.querySelector('[data-part="button"]');

    const job = getJobForShip(state, ship.id);

    if (job) {
      // Busy: show where it is and how long is left.
      const progress = getJobProgress(job, now);
      const msLeft = job.durationMs * (1 - progress);
      const fieldName = FIELDS[job.fieldId].name;

      statusText.textContent = `Mining ${fieldName} — ${formatDuration(msLeft)} to return`;
      bar.style.width = (progress * 100) + "%";
      button.textContent = "Recall";
      card.classList.add("busy");
    } else {
      // Idle: sitting at home.
      statusText.textContent = "Docked at home — awaiting orders";
      bar.style.width = "0%";
      button.textContent = "Dispatch to " + FIELDS.inner_belt.name;
      card.classList.remove("busy");
    }
  }
}


// Each ship type on the Ships screen, plus the nav alert dot
function renderShipyard(state) {
  let anythingToBuy = false;

  for (const [typeId, shipType] of Object.entries(SHIP_TYPES)) {
    const card = byId("yard-" + typeId);
    const tag = card.querySelector('[data-part="tag"]');
    const note = card.querySelector('[data-part="note"]');
    const button = card.querySelector('[data-part="button"]');
    const owned = card.querySelector('[data-part="owned"]');

    // How many of this type the player has.
    const count = state.ships.filter((ship) => ship.type === typeId).length;
    owned.textContent = count;

    const unlocked = isShipTypeUnlocked(state, typeId);
    const check = canBuyShip(state, typeId);
    card.classList.toggle("locked", !unlocked);

    // Pick the tag, note and button text for each situation.
    if (shipType.cost === null) {
      tag.textContent = "STARTER";
      note.textContent = "Your first barge. Not sold at this yard.";
      button.hidden = true;
    } else if (!unlocked) {
      const skillName = SKILLS[shipType.skill].name;
      const level = getLevel(state, shipType.skill);
      tag.textContent = "LOCKED";
      note.textContent = `Reach ${skillName} level ${shipType.unlockLevel} to unlock (you're level ${level}).`;
      button.hidden = false;
      button.disabled = true;
      button.textContent = `Buy — ${formatNumber(shipType.cost)} cr`;
    } else {
      tag.textContent = "AVAILABLE";
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

    card.querySelector('[data-part="level"]').textContent = "Level " + progress.level;
    card.querySelector('[data-part="bar"]').style.width = (progress.fraction * 100) + "%";

    const xpText = card.querySelector('[data-part="xp"]');
    if (progress.isMax) {
      xpText.textContent = `${formatNumber(progress.xp)} XP — max level`;
    } else {
      xpText.textContent =
        `${formatNumber(progress.xpIntoLevel)} / ${formatNumber(progress.xpForNextLevel)} XP to level ${progress.level + 1}`;
    }

    // Mark each unlock as done or still to come.
    for (const line of card.querySelectorAll("[data-unlock]")) {
      const typeId = line.dataset.unlock;
      const unlocked = isShipTypeUnlocked(state, typeId);
      line.classList.toggle("unlocked", unlocked);
      line.querySelector('[data-part="state"]').textContent = unlocked ? "UNLOCKED" : "LOCKED";
    }
  }
}


// =============================================================
// THE LOG
// =============================================================

// -------------------------------------------------------------
// addLog(message)
// Adds a line to the ship's log panel (newest at the top).
// -------------------------------------------------------------
export function addLog(message) {
  const log = byId("log");
  const line = document.createElement("li");

  // Show the time (UK style, 24-hour: "15:54"), then the message.
  const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  line.textContent = `[${time}] ${message}`;

  log.prepend(line);   // prepend = add to the top

  // Keep the log short: drop the oldest lines beyond 30.
  while (log.children.length > 30) {
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
