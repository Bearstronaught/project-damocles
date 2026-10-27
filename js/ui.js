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
// =============================================================

import { ITEMS, SHIP_TYPES, FIELDS } from "../data/content.js";
import { getJobForShip, getJobProgress } from "./jobs.js";


// Shortcut: find an element on the page by its id="..." name.
function byId(id) {
  return document.getElementById(id);
}


// -------------------------------------------------------------
// setupUI(actions)
// Runs once at start-up. Builds the parts of the page that
// don't change, and connects the buttons.
//
// "actions" is an object of functions from main.js, e.g.
//   actions.sellOre()   actions.dispatchShip(shipId)
// -------------------------------------------------------------
export function setupUI(state, actions) {
  // The Sell button
  byId("sell-ore").addEventListener("click", () => actions.sellOre());

  // The Reset button (asks first - it can't be undone!)
  byId("reset-game").addEventListener("click", () => {
    const sure = confirm("Wipe your save and start again? This can't be undone.");
    if (sure) {
      actions.resetGame();
    }
  });

  // Build one "ship card" per ship in the fleet.
  const fleetList = byId("fleet-list");
  fleetList.innerHTML = "";   // clear anything already there

  for (const ship of state.ships) {
    const card = document.createElement("div");
    card.className = "ship-card";
    card.id = "ship-" + ship.id;

    // The card's layout. Parts we'll update later get a
    // "data-part" label so we can find them again.
    card.innerHTML = `
      <div class="ship-header">
        <span class="ship-name">${ship.name}</span>
        <span class="ship-class">${SHIP_TYPES[ship.type].name}</span>
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
// render(state, now)
// Runs several times a second. Copies the latest numbers from
// the state onto the page.
// -------------------------------------------------------------
export function render(state, now) {
  // --- Treasury and cargo ---
  const ore = state.inventory.iron_ore || 0;
  const orePrice = ITEMS.iron_ore.sellPrice;

  byId("credits").textContent = formatNumber(state.credits) + " cr";
  byId("ore-amount").textContent = formatNumber(ore);
  byId("ore-value").textContent = formatNumber(ore * orePrice) + " cr";

  // The Sell button is greyed out when there's nothing to sell.
  byId("sell-ore").disabled = ore === 0;

  // --- Each ship ---
  for (const ship of state.ships) {
    const card = byId("ship-" + ship.id);
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


// -------------------------------------------------------------
// addLog(message)
// Adds a line to the ship's log panel (newest at the top).
// -------------------------------------------------------------
export function addLog(message) {
  const log = byId("log");
  const line = document.createElement("li");

  // Show the time, then the message.
  // (UK style, 24-hour: "15:54")
  const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  line.textContent = `[${time}] ${message}`;

  log.prepend(line);   // prepend = add to the top

  // Keep the log short: drop the oldest lines beyond 30.
  while (log.children.length > 30) {
    log.lastElementChild.remove();
  }
}


// -------------------------------------------------------------
// Helpers for nice-looking numbers.
// -------------------------------------------------------------

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
