// =============================================================
// js/contracts-screen.js
// -------------------------------------------------------------
// THE CONTRACTS SCREEN: the belt independents' board, one card per
// slot, and your reputation with them.
//
// Built once (buildContractsScreen), then its words are updated 4
// times a second (renderContracts), only where something changed.
// The rules live in contracts.js; this file only shows them and
// passes button presses on to main.js (the "actions").
// =============================================================

import { CONTRACT_KINDS, CONTRACTS, CONTRACT_FACTION, ITEMS, REPUTATION_TIERS } from "../data/content.js";
import { isBoardOpen, getTier, getProgress, canDeliver, describeContract } from "./contracts.js";
import { formatNumber, formatTonnes, formatDuration } from "./ui.js";
import { gameNow } from "./clock.js";

// What sort of job each kind is, for the small tag on its card.
const KIND_TAGS = {
  deliver: "Delivery",
  mine: "Work",
  refine: "Work",
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


// =============================================================
// BUILD (once)
// =============================================================

// -------------------------------------------------------------
// buildContractsScreen(actions, makeTwoClick)
// One card per board slot. "makeTwoClick" is ui.js's two-click
// button helper, used for Discard so a stray tap can't throw a
// contract away.
// -------------------------------------------------------------
export function buildContractsScreen(actions, makeTwoClick) {
  byId("faction-name").textContent = CONTRACT_FACTION.name;
  byId("faction-desc").textContent = CONTRACT_FACTION.description;

  const list = byId("contract-list");
  list.innerHTML = "";
  for (let slot = 0; slot < CONTRACTS.slots; slot++) {
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
    // Two clicks to discard: the first arms it, the second does it.
    makeTwoClick(part(card, "discard"), "Click again to discard", () => {
      actions.discardContract(slot);
      part(card, "message").textContent = "";
    }, "Discard");

    list.appendChild(card);
  }

  // One line per reputation tier, for the Reputation panel
  byId("tier-list").innerHTML = REPUTATION_TIERS.map((tier, index) => `
    <li data-tier="${index}">
      <span class="tier-name">${tier.name}</span>
      <span class="tier-from">from ${formatNumber(tier.from)}</span>
      <span class="tier-size">contracts ×${tier.size}</span>
    </li>`).join("");
}


// =============================================================
// RENDER (4 times a second)
// =============================================================

// -------------------------------------------------------------
// renderContracts(state)
// Updates every card and the reputation panel. Returns what the
// Contracts tab's nav dot is about: contracts not seen yet, and
// deliveries that can be handed over now, e.g.
//   { "contract:12": 1, "deliver:12": 1 }
// -------------------------------------------------------------
export function renderContracts(state) {
  const ready = {};
  if (!isBoardOpen(state)) return ready;
  const now = gameNow(state);

  state.contracts.slots.forEach((slot, index) => {
    const card = byId("contract-slot-" + index);
    const contract = slot.contract;
    card.classList.toggle("empty", !contract);

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
    setText(part(card, "progress"), progressText(kind.kind, contract, progress));

    // What it pays. A delivery compares with selling it at home;
    // a work contract is a bonus on goods you keep anyway.
    let pay = formatNumber(contract.credits) + " cr";
    if (kind.kind === "deliver") {
      pay += ` (selling it at home: ${formatNumber(contract.amount * ITEMS[contract.itemId].sellPrice)} cr)`;
    } else if (kind.kind === "mine" || kind.kind === "refine") {
      pay += ` bonus; you keep the ${kind.kind === "mine" ? "ore" : "metal"}`;
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
      if (check.ok) ready["deliver:" + contract.number] = 1;
    } else {
      card.classList.remove("deliverable");
    }
  });

  // --- Reputation ---
  const reputation = state.contracts.reputation;
  const tier = getTier(state);
  setText(byId("rep-tier"), tier.name);
  setText(byId("rep-points"), formatNumber(reputation) + " reputation");
  const fill = tier.next ? (reputation - tier.from) / (tier.next.from - tier.from) : 1;
  byId("rep-bar").style.width = (fill * 100) + "%";
  setText(byId("rep-next"), tier.next
    ? `${formatNumber(tier.next.from - reputation)} more to ${tier.next.name}: contracts ×${tier.next.size} the size, and the pay with them.`
    : "Their highest regard. Contracts are as big as they get.");
  setText(byId("contracts-done"), `${formatNumber(state.contracts.completed)} contracts finished`);
  for (const line of document.querySelectorAll("#tier-list [data-tier]")) {
    line.classList.toggle("current", Number(line.dataset.tier) === tier.index);
    line.classList.toggle("reached", Number(line.dataset.tier) <= tier.index);
  }
  return ready;
}

// -------------------------------------------------------------
// progressText(kind, contract, progress)
// How far along a contract is, in words, e.g.
//   "In your hold: 120 t of 150 t"
//   "Brought home from the Outer Belt: 60 t of 280 t"
// -------------------------------------------------------------
function progressText(kind, contract, { have, need }) {
  if (kind === "deliver") return `In your hold: ${formatTonnes(have)} of ${formatTonnes(need)}`;
  if (kind === "mine") return `Brought home since it was posted: ${formatTonnes(have)} of ${formatTonnes(need)}`;
  if (kind === "refine") return `Made since it was posted: ${formatTonnes(have)} of ${formatTonnes(need)}`;
  if (kind === "survey") return have >= need ? "Surveyed" : "Not surveyed yet";
  return `Deep scans run since it was posted: ${have} of ${need}`;
}
