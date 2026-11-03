// =============================================================
// js/contracts-view.js
// -------------------------------------------------------------
// THE CONTRACTS VIEWSCREEN (Dan, 3 Nov): the noticeboard on the
// Last Post concourse, at the top of the Contracts screen.
//
// One pinned notice per board slot, showing at a glance where each
// contract stands:
//
//   Ready         done; the notice is green and has a Hand in
//                 button (the same action as the card below it)
//   In progress   a ship or refinery slot is lent to it, or some of
//                 the work is done
//   Open          posted, nothing done for it yet
//   Waiting       an empty slot, counting down to its next notice
//
// Under the notices: the next slot the board will gain, and at
// which Diplomacy level. In the readout column, "Lent out" lists
// the ships and refinery slots working for clients right now.
//
// Unlike the other viewscreens this one is plain HTML, not an SVG
// drawing: a notice is mostly words, and HTML wraps words for us
// (so on a phone the notices simply fall into two columns).
// =============================================================

import { CONTRACT_KINDS, CONTRACT_FACTIONS, CONTRACTS, ITEMS } from "../data/content.js";
import { isBoardOpen, getProgress, canHandIn, getTier } from "./contracts.js";
import { getLevel } from "./skills.js";
import { findShip } from "./state.js";
import { gameNow } from "./clock.js";
import { formatNumber, formatTonnes, formatDuration } from "./ui.js";
import { setText } from "./svg.js";   // the "only change words that changed" helper

// The small word in each notice's corner, by kind of work
const KIND_TAGS = {
  deliver: "Delivery",
  charter: "Charter",
  toll: "Toll smelting",
  survey: "Survey",
  deepScan: "Deep scan",
};


// -------------------------------------------------------------
// noticeStatus(state, slotIndex)
// Which of the four states a slot's notice is in (see the top).
// -------------------------------------------------------------
export function noticeStatus(state, slotIndex) {
  const contract = state.contracts.slots[slotIndex]?.contract;
  if (!contract) return "waiting";
  if (canHandIn(state, slotIndex).ok) return "ready";

  // Something lent to it, or some of the work done, counts as started
  const lent = (contract.shipId ?? null) !== null || (contract.refinerySlot ?? null) !== null;
  const progress = getProgress(state, contract);
  if (lent || progress.have > 0) return "progress";
  return "open";
}

// The word shown at the top of each notice
const STATUS_WORDS = {
  ready: "Ready",
  progress: "In progress",
  open: "Open",
  waiting: "Waiting",
};


// -------------------------------------------------------------
// shortLine(contract)
// One short line saying who wants what, e.g.
// "A belt co-op · 300 t iron ore". The full wording is on the
// card below; a notice only has room for the gist.
// -------------------------------------------------------------
function shortLine(contract) {
  const kind = CONTRACT_KINDS[contract.kindId].kind;
  let what;
  if (kind === "survey") what = "a survey";
  else if (kind === "deepScan") what = `${contract.amount} deep scans`;
  else what = `${formatTonnes(contract.amount)} ${ITEMS[contract.itemId].name.toLowerCase()}`;
  return `${contract.client} · ${what}`;
}


// -------------------------------------------------------------
// getLentOut(state)
// Everything the player has lent to clients right now, for the
// "Lent out" readout: [{ name, job }]
// -------------------------------------------------------------
export function getLentOut(state) {
  const lent = [];
  for (const slot of state.contracts.slots) {
    const contract = slot.contract;
    if (!contract) continue;
    // A chartered ship: its hauls go to the client
    if ((contract.shipId ?? null) !== null) {
      const ship = findShip(state, contract.shipId);
      if (ship) lent.push({ name: ship.name, job: "Charter" });
    }
    // A refinery slot smelting the client's ore
    if ((contract.refinerySlot ?? null) !== null) {
      lent.push({ name: `Refinery slot ${contract.refinerySlot + 1}`, job: "Toll smelting" });
    }
  }
  return lent;
}


// -------------------------------------------------------------
// makeNotice(slotIndex, actions)
// Builds one notice's HTML once. Its words are filled in by
// update(). Gives back the parts update() changes.
// -------------------------------------------------------------
function makeNotice(slotIndex, actions) {
  const box = document.createElement("article");
  box.className = "cv-notice";
  box.innerHTML = `
    <span class="cv-pin" aria-hidden="true"></span>
    <div class="cv-top"><span class="cv-status"></span><span class="cv-kind"></span></div>
    <h3 class="cv-title"></h3>
    <p class="cv-line"></p>
    <div class="cv-bar"><div class="cv-fill"></div></div>
    <p class="cv-pay"></p>
    <button class="btn btn-primary cv-handin" type="button">Hand in</button>
    <p class="cv-wait"></p>
  `;
  const parts = {
    box,
    status: box.querySelector(".cv-status"),
    kind: box.querySelector(".cv-kind"),
    title: box.querySelector(".cv-title"),
    line: box.querySelector(".cv-line"),
    fill: box.querySelector(".cv-fill"),
    pay: box.querySelector(".cv-pay"),
    handIn: box.querySelector(".cv-handin"),
    wait: box.querySelector(".cv-wait"),
    lastStatus: null,
  };
  // The same action as the Hand in button on the card below
  parts.handIn.addEventListener("click", () => actions.handInContract(slotIndex));
  return parts;
}


// -------------------------------------------------------------
// updateNotice(state, now, slotIndex, notice)
// Brings one notice up to date.
// -------------------------------------------------------------
function updateNotice(state, now, slotIndex, notice) {
  const slot = state.contracts.slots[slotIndex];
  const status = noticeStatus(state, slotIndex);

  // Change the class only when the status changes (saves the
  // browser restyling the notice 60 times a second)
  if (notice.lastStatus !== status) {
    notice.box.className = "cv-notice is-" + status;
    notice.lastStatus = status;
  }
  setText(notice.status, STATUS_WORDS[status]);

  // An empty slot: only the countdown
  if (status === "waiting") {
    setText(notice.kind, `Slot ${slotIndex + 1}`);
    setText(notice.title, "");
    setText(notice.line, "");
    setText(notice.pay, "");
    setText(notice.wait, slot.readyAt === null
      ? "A notice goes up as soon as there's work you can do"
      : formatDuration(Math.max(0, slot.readyAt - now)) + " until the next notice");
    return;
  }

  const contract = slot.contract;
  const kind = CONTRACT_KINDS[contract.kindId];
  setText(notice.kind, KIND_TAGS[kind.kind] || "");
  setText(notice.title, kind.title);
  setText(notice.line, shortLine(contract));
  setText(notice.pay, `${formatNumber(contract.credits)} cr · +${formatNumber(contract.reputation)} rep`);
  setText(notice.wait, "");

  // Progress bar: how much of the work is done
  const progress = getProgress(state, contract);
  const percent = progress.need > 0 ? Math.round((progress.have / progress.need) * 100) : 0;
  const width = percent + "%";
  if (notice.fill.style.width !== width) notice.fill.style.width = width;
}


// -------------------------------------------------------------
// setupContractsView(getState, actions)
// Starts the noticeboard. "actions" is main.js's list of player
// actions: the Hand in buttons use actions.handInContract.
// -------------------------------------------------------------
export function setupContractsView(getState, actions) {
  const board = document.getElementById("cv-board");
  const closedNote = document.getElementById("cv-closed");
  const nextSlot = document.getElementById("cv-next-slot");
  const faction = document.getElementById("cv-faction");
  const lentList = document.getElementById("lent-list");
  const lentEmpty = document.getElementById("lent-empty");
  const screen = document.querySelector('section.screen[data-screen="contracts"]');
  if (!board || !screen) return;

  const notices = [];          // one per board slot, made as the board grows
  let lastLent = "";           // the lent-out list last drawn, to skip redraws

  function frame() {
    requestAnimationFrame(frame);
    if (screen.hidden) return;     // only draw while the page is open
    const state = getState();
    const now = gameNow(state);

    // Before Mining 3 the board isn't up yet
    const open = isBoardOpen(state);
    closedNote.hidden = open;
    board.hidden = !open;
    if (!open) {
      setText(closedNote, `The board goes up at Mining ${CONTRACTS.openAtMiningLevel}.`);
      return;
    }

    // A Diplomacy level can add a slot: make its notice
    while (notices.length < state.contracts.slots.length) {
      const notice = makeNotice(notices.length, actions);
      board.appendChild(notice.box);
      notices.push(notice);
    }
    notices.forEach((notice, index) => {
      notice.box.hidden = index >= state.contracts.slots.length;
      if (!notice.box.hidden) updateNotice(state, now, index, notice);
    });

    // The next slot the board gains, if any are left
    const diplomacy = getLevel(state, "diplomacy");
    const nextLevel = CONTRACTS.slotLevels.find((level) => level > diplomacy);
    setText(nextSlot, nextLevel
      ? `Slot ${state.contracts.slots.length + 1} opens at Diplomacy ${nextLevel}`
      : "Every slot is open");

    // Who posts here, and how they rate you. One faction so far
    // (design doc: a second needs a rule for who posts each notice).
    const [factionId, factionData] = Object.entries(CONTRACT_FACTIONS)[0];
    setText(faction, `${factionData.name} · ${getTier(state, factionId).name}`);

    // Lent out: rebuilt only when the list changes
    const lent = getLentOut(state);
    const key = JSON.stringify(lent);
    if (key !== lastLent) {
      lastLent = key;
      lentList.innerHTML = "";
      for (const item of lent) {
        const row = document.createElement("li");
        row.className = "lent-row";
        const name = document.createElement("span");
        name.textContent = item.name;
        const job = document.createElement("span");
        job.className = "lent-job";
        job.textContent = item.job;
        row.append(name, job);
        lentList.appendChild(row);
      }
      lentEmpty.hidden = lent.length > 0;
    }
  }
  requestAnimationFrame(frame);
}
