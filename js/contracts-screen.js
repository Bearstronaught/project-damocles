// =============================================================
// js/contracts-screen.js
// -------------------------------------------------------------
// THE CONTRACTS SCREEN: the board, and your reputation.
//
// Both are split by FACTION (Dan, 30 Oct): one collapsible box per
// faction, like the role groups on Command. The board's box holds
// that faction's contract cards; the reputation box says where you
// stand with them. Boxes start open; one you close stays closed
// after a refresh (remembered in the browser, not the save).
//
// Built once (buildContractsScreen), then its words are updated 4
// times a second (renderContracts), only where something changed.
// The rules live in contracts.js; this file only shows them and
// passes button presses on to main.js (the "actions").
// =============================================================

import { CONTRACT_KINDS, CONTRACTS, CONTRACT_FACTIONS, ITEMS, REPUTATION_TIERS, SHIP_TYPES, FIELDS } from "../data/content.js";
import { isBoardOpen, getTier, getReputation, getProgress, canDeliver, describeContract, getCharter } from "./contracts.js";
import { formatNumber, formatTonnes, formatDuration } from "./ui.js";
import { gameNow } from "./clock.js";

// What sort of job each kind is, for the small tag on its card.
const KIND_TAGS = {
  deliver: "Delivery",
  charter: "Charter",
  survey: "Exploration",
  deepScan: "Exploration",
};

// Shortcut: find an element on the page by its id="..." name.
function byId(id) {
  return document.getElementById(id);
}

// Find a labelled part inside a card: part(card, "pay")
function part(card, name) {
  return card.querySelector(`[data-part="${name}"]`);
}

// Changes text only when it's different (it runs 4 times a second).
function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}


// -------------------------------------------------------------
// WHICH BOXES ARE CLOSED
// Kept in the browser (localStorage), like the role groups on
// Command: it's how you like the screen, not game progress. Ids
// look like "board:independents" and "rep:independents".
// "try" because some browsers block storage (private windows);
// then every box simply starts open.
// -------------------------------------------------------------
const CLOSED_KEY = "damocles-closed-contract-groups";

function loadClosed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(CLOSED_KEY)) || []);
  } catch (error) {
    return new Set();
  }
}

function saveClosed() {
  try {
    localStorage.setItem(CLOSED_KEY, JSON.stringify([...closedBoxes]));
  } catch (error) {
    // Storage blocked: the box just won't stay closed after a refresh.
  }
}

const closedBoxes = loadClosed();

// -------------------------------------------------------------
// buildFactionBox(id, factionName)
// One collapsible box: a heading line (faction name, a short
// summary filled in by render, More/Less hint) and a body.
// Uses the role-group look from the Command screen.
// -------------------------------------------------------------
function buildFactionBox(id, factionName) {
  const box = document.createElement("details");
  box.className = "role-group expandable faction-group";
  box.id = "faction-" + id.replace(":", "-");   // e.g. faction-board-independents
  box.open = !closedBoxes.has(id);
  box.innerHTML = `
    <summary class="role-group-head">
      <span class="role-group-name">${factionName}</span>
      <span class="role-group-summary" data-part="summary"></span>
      <span class="expand-hint" aria-hidden="true"></span>
    </summary>
    <div class="faction-body" data-part="body"></div>
  `;
  // Remember when the player opens or closes it.
  box.addEventListener("toggle", () => {
    if (box.open) {
      closedBoxes.delete(id);
    } else {
      closedBoxes.add(id);
    }
    saveClosed();
  });
  return box;
}


// =============================================================
// BUILD (once)
// =============================================================

// -------------------------------------------------------------
// buildContractsScreen(actions, makeTwoClick)
// A board box and a reputation box for each faction, and one card
// per board slot. "makeTwoClick" is ui.js's two-click button
// helper, used for Discard so a stray tap can't throw a contract
// away.
// -------------------------------------------------------------
export function buildContractsScreen(actions, makeTwoClick) {
  const boardArea = byId("contract-groups");
  const repArea = byId("rep-groups");
  boardArea.innerHTML = "";
  repArea.innerHTML = "";

  for (const [factionId, faction] of Object.entries(CONTRACT_FACTIONS)) {
    // The board box: a grid that this faction's contract cards
    // move into (see renderContracts).
    const boardBox = buildFactionBox("board:" + factionId, faction.name);
    part(boardBox, "body").innerHTML = `<div class="card-grid contract-grid" data-part="cards"></div>`;
    boardBox.dataset.faction = factionId;
    boardArea.appendChild(boardBox);

    // The reputation box: who they are, your tier and points, how
    // far to the next tier, and the whole ladder.
    const repBox = buildFactionBox("rep:" + factionId, faction.name);
    part(repBox, "body").innerHTML = `
      <p class="price-note">${faction.description}</p>
      <div class="rep-head">
        <span class="rep-tier" data-part="tier"></span>
        <span class="rep-points" data-part="points"></span>
      </div>
      <div class="progress"><div class="progress-fill xp-fill" data-part="bar"></div></div>
      <p class="price-note" data-part="next"></p>
      <ul class="tier-list">
        ${REPUTATION_TIERS.map((tier, index) => `
          <li data-tier="${index}">
            <span class="tier-name">${tier.name}</span>
            <span class="tier-from">from ${formatNumber(tier.from)}</span>
            <span class="tier-size">contracts ×${tier.size}</span>
          </li>`).join("")}
      </ul>
    `;
    repArea.appendChild(repBox);
  }

  // The slot cards. They start in the first faction's box;
  // renderContracts moves each into the box of the faction whose
  // contract it holds.
  const firstGrid = part(boardArea.querySelector(".faction-group"), "cards");
  builtSlots = 0;
  buildActions = { actions, makeTwoClick, firstGrid };
  addSlotCards(CONTRACTS.slots);
}

// The pieces addSlotCards needs, kept from buildContractsScreen.
let buildActions = null;
let builtSlots = 0;   // how many slot cards exist

// -------------------------------------------------------------
// addSlotCards(count)
// Makes slot cards until there are "count" of them. A Diplomacy
// level can add a slot to the board, so renderContracts calls
// this whenever the board has more slots than cards.
// -------------------------------------------------------------
function addSlotCards(count) {
  const { actions, makeTwoClick, firstGrid } = buildActions;
  for (let slot = builtSlots; slot < count; slot++) {
    const card = document.createElement("div");
    card.className = "contract-card";
    card.id = "contract-slot-" + slot;
    card.innerHTML = `
      <div class="card-header">
        <span class="card-name" data-part="title"></span>
        <span class="card-tag" data-part="tag"></span>
      </div>
      <p class="contract-text" data-part="text"></p>
      <div class="progress"><div class="progress-fill" data-part="bar"></div></div>
      <div class="contract-progress" data-part="progress"></div>
      <dl class="stats contract-pay">
        <dt>Pays</dt>        <dd data-part="pay"></dd>
        <dt>Reputation</dt>  <dd data-part="rep"></dd>
      </dl>
      <!-- Charters only: pick a mining ship to lend -->
      <div class="charter-pick" data-part="charter">
        <select class="dest-select" data-part="ships" aria-label="Ship to charter"></select>
        <button class="btn btn-primary" data-part="charter-go">Charter</button>
      </div>
      <div class="contract-buttons">
        <button class="btn btn-primary" data-part="deliver">Deliver</button>
        <button class="btn btn-small" data-part="discard">Discard</button>
      </div>
      <p class="order-message" data-part="message" role="status"></p>
      <!-- Shown instead of all the above while the slot waits -->
      <p class="contract-waiting" data-part="waiting"></p>
    `;

    part(card, "deliver").addEventListener("click", () => {
      const result = actions.deliverContract(slot);
      part(card, "message").textContent = result.ok ? "" : result.reason;
    });
    // Charter: lend the ship picked in the dropdown
    part(card, "charter-go").addEventListener("click", () => {
      const result = actions.charterShip(slot, part(card, "ships").value);
      part(card, "message").textContent = result.ok ? "" : result.reason;
    });
    // Two clicks to discard: the first arms it, the second does it.
    makeTwoClick(part(card, "discard"), "Click again to discard", () => {
      actions.discardContract(slot);
      part(card, "message").textContent = "";
    }, "Discard");

    firstGrid.appendChild(card);
  }
  builtSlots = Math.max(builtSlots, count);
}


// =============================================================
// RENDER (4 times a second)
// =============================================================

// -------------------------------------------------------------
// renderContracts(state)
// Updates every card, each faction's box, and reputation. Returns what the
// Contracts tab's nav dot is about: contracts not seen yet, and
// deliveries that can be handed over now, e.g.
//   { "contract:12": 1, "deliver:12": 1 }
// -------------------------------------------------------------
export function renderContracts(state) {
  const ready = {};
  if (!isBoardOpen(state)) return ready;
  const now = gameNow(state);

  // A Diplomacy level added a slot? Make its card. (And after a
  // reset to a smaller board, hide the cards it no longer has.)
  if (state.contracts.slots.length > builtSlots) addSlotCards(state.contracts.slots.length);
  for (let index = 0; index < builtSlots; index++) {
    byId("contract-slot-" + index).hidden = index >= state.contracts.slots.length;
  }

  // Per faction, for the box headings: { independents: { contracts: 2, ready: 1 } }
  const counts = {};
  for (const factionId of Object.keys(CONTRACT_FACTIONS)) {
    counts[factionId] = { contracts: 0, ready: 0 };
  }

  state.contracts.slots.forEach((slot, index) => {
    const card = byId("contract-slot-" + index);
    const contract = slot.contract;
    card.classList.toggle("empty", !contract);

    // Put the card in its faction's box (only moves it when it's
    // in the wrong one). A waiting slot stays where it was.
    if (contract) {
      const grid = part(byId("faction-board-" + contract.faction), "cards");
      if (card.parentElement !== grid) grid.appendChild(card);
      counts[contract.faction].contracts += 1;
    }

    // --- Waiting for the next contract ---
    if (!contract) {
      setText(part(card, "title"), "Waiting for work");
      setText(part(card, "tag"), "");
      setText(part(card, "waiting"), slot.readyAt === null
        ? "Nothing you can do for them yet. A contract will be posted as soon as there is."
        : `A new contract will be posted in ${formatDuration(Math.max(0, slot.readyAt - now))}.`);
      return;
    }

    const kind = CONTRACT_KINDS[contract.kindId];
    ready["contract:" + contract.number] = 1;

    setText(part(card, "title"), kind.title);
    setText(part(card, "tag"), KIND_TAGS[kind.kind]);
    setText(part(card, "text"), describeContract(contract, formatTonnes));

    // Progress bar and words
    const progress = getProgress(state, contract);
    part(card, "bar").style.width = (progress.have / progress.need * 100) + "%";
    setText(part(card, "progress"), progressText(state, kind.kind, contract, progress));

    // Charters: the ship picker, until a ship is lent
    const picking = kind.kind === "charter" && !contract.shipId;
    part(card, "charter").hidden = !picking;
    if (picking) fillShipPicker(state, part(card, "ships"), part(card, "charter-go"));

    // What it pays. A delivery compares with selling it at home;
    // a work contract is a bonus on goods you keep anyway.
    let pay = formatNumber(contract.credits) + " cr";
    if (kind.kind === "deliver" || kind.kind === "charter") {
      // Compared with selling the same goods at home
      pay += ` (selling it at home: ${formatNumber(contract.amount * ITEMS[contract.itemId].sellPrice)} cr)`;
    }
    setText(part(card, "pay"), pay);
    setText(part(card, "rep"), "+" + contract.reputation);

    // Deliver only shows on deliveries; work contracts finish by themselves.
    const deliver = part(card, "deliver");
    deliver.hidden = kind.kind !== "deliver";
    if (kind.kind === "deliver") {
      const check = canDeliver(state, index);
      deliver.disabled = !check.ok;
      card.classList.toggle("deliverable", check.ok);
      if (check.ok) {
        ready["deliver:" + contract.number] = 1;
        counts[contract.faction].ready += 1;
      }
    } else {
      card.classList.remove("deliverable");
    }
  });

  // --- Each faction's boxes ---
  for (const [factionId, faction] of Object.entries(CONTRACT_FACTIONS)) {
    // The board box heading, e.g. "2 contracts · 1 ready to hand over"
    // (lit amber when one is ready, so a closed box still says so).
    const boardBox = byId("faction-board-" + factionId);
    const { contracts, ready: readyCount } = counts[factionId];
    let summary = contracts === 1 ? "1 contract" : `${contracts} contracts`;
    if (readyCount > 0) summary += ` · ${readyCount} ready to hand over`;
    setText(part(boardBox, "summary"), summary);
    boardBox.classList.toggle("needs-orders", readyCount > 0);

    // The reputation box: heading "Known · 120 reputation"
    const repBox = byId("faction-rep-" + factionId);
    const reputation = getReputation(state, factionId);
    const tier = getTier(state, factionId);
    setText(part(repBox, "summary"), `${tier.name} · ${formatNumber(reputation)} reputation`);
    setText(part(repBox, "tier"), tier.name);
    setText(part(repBox, "points"), formatNumber(reputation) + " reputation");
    // The bar fills from this tier's start to the next tier's.
    const fill = tier.next ? (reputation - tier.from) / (tier.next.from - tier.from) : 1;
    part(repBox, "bar").style.width = (fill * 100) + "%";
    setText(part(repBox, "next"), tier.next
      ? `${formatNumber(tier.next.from - reputation)} more to ${tier.next.name} with the ${faction.name.toLowerCase()}: ` +
        `their contracts ×${tier.next.size} the size, and the pay with them.`
      : "Their highest regard. Their contracts are as big as they get.");
    for (const line of repBox.querySelectorAll("[data-tier]")) {
      line.classList.toggle("current", Number(line.dataset.tier) === tier.index);
      line.classList.toggle("reached", Number(line.dataset.tier) <= tier.index);
    }
  }
  setText(byId("contracts-done"), `${formatNumber(state.contracts.completed)} contracts finished`);
  return ready;
}

// -------------------------------------------------------------
// fillShipPicker(state, select, button)
// The charter's dropdown: your mining ships that aren't already on
// a charter. Rebuilt only when that list changes (rewriting it 4
// times a second would close it while you're choosing).
// -------------------------------------------------------------
function fillShipPicker(state, select, button) {
  const ships = state.ships.filter((ship) => SHIP_TYPES[ship.type].role === "mining" && !getCharter(state, ship.id));
  const key = ships.map((ship) => ship.id + ":" + ship.name).join(",");
  if (select.dataset.key !== key) {
    select.dataset.key = key;
    const chosen = select.value;
    select.innerHTML = ships.length === 0
      ? `<option value="">No mining ship free</option>`
      : ships.map((ship) => `<option value="${ship.id}">${ship.name} (${SHIP_TYPES[ship.type].name})</option>`).join("");
    if (ships.some((ship) => ship.id === chosen)) select.value = chosen;   // keep the choice
  }
  button.disabled = ships.length === 0;
}

// -------------------------------------------------------------
// progressText(state, kind, contract, progress)
// How far along a contract is, in words, e.g.
//   "In your hold: 120 t of 150 t"
//   "Rockhopper is working the Outer Belt: 120 t of 300 t handed over"
// -------------------------------------------------------------
function progressText(state, kind, contract, { have, need }) {
  if (kind === "deliver") return `In your hold: ${formatTonnes(have)} of ${formatTonnes(need)}`;
  if (kind === "charter") {
    if (!contract.shipId) return "Pick a mining ship to lend. It starts from its next departure.";
    const ship = state.ships.find((s) => s.id === contract.shipId);
    return `${ship.name} is working the ${FIELDS[contract.fieldId].name}: ${formatTonnes(have)} of ${formatTonnes(need)} handed over`;
  }
  if (kind === "survey") return have >= need ? "Surveyed" : "Not surveyed yet";
  return `Deep scans run since it was posted: ${have} of ${need}`;
}
