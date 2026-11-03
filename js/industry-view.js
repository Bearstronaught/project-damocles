// =============================================================
// js/industry-view.js
// -------------------------------------------------------------
// THE INDUSTRY VIEWSCREEN (Dan, 1 and 3 Nov): a live cutaway of
// Anvil Station at the top of the Industry screen, drawn the way
// goods move through it, left to right:
//
//   DOCK  ->  REFINERY  ->  WORKSHOP  ->  HOLD
//   ore       furnaces      work orders   ores, bars, parts,
//   arrives   smelt bars    make parts    salvage
//
//   - Each furnace is one refinery slot. It fills from the bottom
//     as its batch smelts, and says what it's making and how long
//     is left. Locked slots are dashed outlines with their level.
//   - Each ring is one workshop slot: how far through its current
//     work order it is ("9/20" batches).
//   - The four tanks are the hold's sections (the same as the
//     hold tables), drawn against each other so you can see at a
//     glance what you have most of.
//
// It reads the same jobs the slot cards below it use (refinery.js,
// workshop.js), so the two always agree. Like the system map, it
// redraws every screen frame while the Industry screen is open.
// =============================================================

import { RECIPES, WORKSHOP_RECIPES, REFINERY, WORKSHOP, ITEMS, ITEM_GROUPS } from "../data/content.js";
import { isRefineryOpen, getSlotCount, getMaxSlots, getSlotUnlockLevel, getRefineJob } from "./refinery.js";
import { isWorkshopOpen, getWorkshopSlotCount, getWorkshopSlotUnlockLevel, getWorkshopJob, getRunningIndex } from "./workshop.js";
import { getJobForShip, getJobPhase } from "./jobs.js";
import { gameNow } from "./clock.js";
import { formatTonnes, formatDuration } from "./ui.js";
import { make, setText } from "./svg.js";


// -------------------------------------------------------------
// THE DRAWING'S LAYOUT (in drawing units; the drawing is 1000
// wide and 340 tall, scaled to fit the panel)
// -------------------------------------------------------------
const TOP = 100;            // top of the furnaces and tanks
const HEIGHT = 160;         // how tall they are
const BOTTOM = TOP + HEIGHT;

// Where each section starts, left to right
const DOCK_X = 95;
const REFINERY_X = 252;     // first furnace
const FURNACE_W = 56;
const FURNACE_GAP = 12;
const WORKSHOP_X = 574;     // centre of the first ring
const RING_GAP = 70;
const RING_R = 28;
const RING_Y = 175;
const HOLD_X = 774;         // first tank
const TANK_W = 34;
const TANK_GAP = 8;

// The full length of a ring's circle, for drawing part of it
// (a ring that's 45% done shows 45% of this length).
const RING_LENGTH = 2 * Math.PI * RING_R;


// -------------------------------------------------------------
// shortName(name)
// "Iron bars" -> "IRON", "Hull plating" -> "HULL": the first word,
// so it fits under a furnace or a ring.
// -------------------------------------------------------------
function shortName(name) {
  return name.split(" ")[0].toUpperCase();
}


// -------------------------------------------------------------
// drawStation(svg)
// Everything that doesn't move: the hull, its sections and their
// names, and the slots, tanks and arrows (empty, filled in by
// update()). Gives back the parts update() changes.
// -------------------------------------------------------------
function drawStation(svg) {
  // The station's hull: a long box with cut corners
  make("polygon", { class: "iv-hull", points: "60,120 110,62 890,62 940,120 940,252 890,310 110,310 60,252" }, svg);
  for (const x of [238, 528, 758]) {
    make("line", { class: "iv-divider", x1: x, y1: 62, x2: x, y2: 310 }, svg);
  }
  // The docking ports on the left (where barges come in)
  make("path", { class: "iv-divider", d: "M20 186 H60 M20 210 H60" }, svg);

  // Section names along the top
  const names = [["DOCK", 80], ["REFINERY", 252], ["WORKSHOP", 542], ["HOLD", 774]];
  for (const [text, x] of names) {
    make("text", { class: "iv-section", x, y: 50 }, svg).textContent = text;
  }

  // ----- Dock: the ore waiting to be smelted -----
  make("rect", { class: "iv-bay", x: DOCK_X, y: 140, width: 120, height: 100 }, svg);
  const dockOre = make("text", { class: "iv-value", x: DOCK_X + 60, y: 196, "text-anchor": "middle" }, svg);
  make("text", { class: "iv-small", x: DOCK_X + 60, y: 214, "text-anchor": "middle" }, svg).textContent = "ORE IN";
  // A barge arrow that shows while one is unloading
  const barge = make("polygon", { class: "iv-barge", points: "26,192 40,198 26,204" }, svg);
  const dockNote = make("text", { class: "iv-small", x: DOCK_X + 60, y: 286, "text-anchor": "middle" }, svg);

  // ----- Refinery: one furnace per slot (up to getMaxSlots) -----
  const furnaces = [];
  for (let slot = 0; slot < getMaxSlots(); slot++) {
    const x = REFINERY_X + slot * (FURNACE_W + FURNACE_GAP);
    const shell = make("rect", { class: "iv-furnace", x, y: TOP, width: FURNACE_W, height: HEIGHT }, svg);
    // The glow inside, drawn from the bottom up (update sets its height)
    const fill = make("rect", { class: "iv-melt", x: x + 4, y: BOTTOM - 4, width: FURNACE_W - 8, height: 0 }, svg);
    const label = make("text", { class: "iv-small", x: x + FURNACE_W / 2, y: BOTTOM + 22, "text-anchor": "middle" }, svg);
    const time = make("text", { class: "iv-small iv-dim", x: x + FURNACE_W / 2, y: BOTTOM + 38, "text-anchor": "middle" }, svg);
    furnaces.push({ shell, fill, label, time });
  }
  const refineryNote = make("text", { class: "iv-small iv-dim", x: 383, y: TOP + HEIGHT / 2, "text-anchor": "middle" }, svg);

  // ----- Workshop: one ring per slot -----
  const rings = [];
  for (let slot = 0; slot < WORKSHOP.slotLevels.length; slot++) {
    const cx = WORKSHOP_X + slot * RING_GAP;
    const track = make("circle", { class: "iv-ring-track", cx, cy: RING_Y, r: RING_R }, svg);
    // The progress arc: a circle whose dash shows only part of it.
    // rotate(-90) starts it at the top, like a clock.
    const arc = make("circle", {
      class: "iv-ring", cx, cy: RING_Y, r: RING_R,
      "stroke-dasharray": `0 ${RING_LENGTH}`,
      transform: `rotate(-90 ${cx} ${RING_Y})`,
    }, svg);
    const count = make("text", { class: "iv-ring-text", x: cx, y: RING_Y + 5, "text-anchor": "middle" }, svg);
    const label = make("text", { class: "iv-small", x: cx, y: RING_Y + RING_R + 22, "text-anchor": "middle" }, svg);
    rings.push({ track, arc, count, label });
  }
  const workshopNote = make("text", { class: "iv-small iv-dim", x: 643, y: BOTTOM + 38, "text-anchor": "middle" }, svg);

  // ----- Hold: one tank per section -----
  const tanks = [];
  Object.entries(ITEM_GROUPS).forEach(([groupId, group], i) => {
    const x = HOLD_X + i * (TANK_W + TANK_GAP);
    make("rect", { class: "iv-tank", x, y: TOP, width: TANK_W, height: HEIGHT }, svg);
    const fill = make("rect", { class: "iv-tank-fill iv-tank-" + groupId, x: x + 3, y: BOTTOM - 3, width: TANK_W - 6, height: 0 }, svg);
    make("text", { class: "iv-tiny", x: x + TANK_W / 2, y: BOTTOM + 20, "text-anchor": "middle" }, svg)
      .textContent = group.name.toUpperCase();
    const amount = make("text", { class: "iv-tiny iv-dim", x: x + TANK_W / 2, y: BOTTOM + 36, "text-anchor": "middle" }, svg);
    tanks.push({ groupId, fill, amount });
  });

  // ----- The arrows between sections -----
  // Each lights up (and its dashes move) while goods are flowing.
  const arrow = (x1, x2, y) => make("line", { class: "iv-flow", x1, y1: y, x2, y2: y }, svg);
  const flows = {
    dockToRefinery: arrow(DOCK_X + 122, REFINERY_X - 4, 190),
    refineryToWorkshop: arrow(REFINERY_X + 4 * (FURNACE_W + FURNACE_GAP) - 6, WORKSHOP_X - RING_R - 6, RING_Y),
    workshopToHold: arrow(WORKSHOP_X + 2 * RING_GAP + RING_R + 6, HOLD_X - 6, RING_Y),
  };

  return { dockOre, barge, dockNote, furnaces, refineryNote, rings, workshopNote, tanks, flows };
}


// -------------------------------------------------------------
// fillBar(rect, amount)
// Sets a furnace's glow or a tank's fill to "amount" (0 to 1) of
// its height, growing up from the bottom.
// -------------------------------------------------------------
function fillBar(rect, amount, inset) {
  const full = HEIGHT - 2 * inset;
  const height = full * Math.min(Math.max(amount, 0), 1);
  rect.setAttribute("height", height.toFixed(1));
  rect.setAttribute("y", (BOTTOM - inset - height).toFixed(1));
}


// -------------------------------------------------------------
// update(state, now, view)
// Brings the drawing up to date with the game. Runs every frame.
// -------------------------------------------------------------
function update(state, now, view) {
  // ----- Dock -----
  let ore = 0;
  for (const [itemId, item] of Object.entries(ITEMS)) {
    if (item.group === "ore") ore += state.inventory[itemId] || 0;
  }
  setText(view.dockOre, formatTonnes(ore));
  // A barge counts as docking while it's in its "unloading" part
  const unloading = state.ships.filter((ship) => {
    const job = getJobForShip(state, ship.id);
    return job && job.type === "mining" && getJobPhase(job, now).phase === "unloading";
  }).length;
  view.barge.classList.toggle("is-hidden", unloading === 0);
  setText(view.dockNote, unloading > 0 ? `${unloading} UNLOADING` : "");

  // ----- Refinery -----
  const refineryOpen = isRefineryOpen(state);
  setText(view.refineryNote, refineryOpen ? "" : `OPENS AT MINING ${REFINERY.openAtMiningLevel}`);
  const slots = getSlotCount(state);
  let smelting = false;
  view.furnaces.forEach((furnace, slot) => {
    const unlocked = slot < slots;
    furnace.shell.classList.toggle("is-locked", !unlocked);
    if (!unlocked) {
      fillBar(furnace.fill, 0, 4);
      // A slot past the level-unlocked ones comes from an upgrade
      const level = getSlotUnlockLevel(slot);
      setText(furnace.label, !refineryOpen ? "" : level ? `LV ${level}` : "UPGRADE");
      setText(furnace.time, "");
      return;
    }
    const job = getRefineJob(state, slot);
    if (!job) {
      fillBar(furnace.fill, 0, 4);
      setText(furnace.label, "OFF");
      setText(furnace.time, "");
      return;
    }
    // Lent to a client (toll smelting) shows as TOLL
    setText(furnace.label, job.toll !== undefined ? "TOLL" : shortName(RECIPES[job.recipeId].name));
    if (job.status === "working") {
      smelting = true;
      const done = (now - job.startedAt) / job.durationMs;
      fillBar(furnace.fill, done, 4);
      setText(furnace.time, formatDuration(Math.max(job.startedAt + job.durationMs - now, 0)));
    } else {
      fillBar(furnace.fill, 0, 4);
      setText(furnace.time, "NO ORE");
    }
  });

  // ----- Workshop -----
  const workshopOpen = isWorkshopOpen(state);
  setText(view.workshopNote, workshopOpen ? "" : `OPENS AT REFINING ${WORKSHOP.openAtRefiningLevel}`);
  const workshopSlots = getWorkshopSlotCount(state);
  let making = false;
  view.rings.forEach((ring, slot) => {
    const unlocked = slot < workshopSlots;
    ring.track.classList.toggle("is-locked", !unlocked);
    let amount = 0;
    let count = "";
    let label = "";
    if (!unlocked) {
      label = workshopOpen ? `LV ${getWorkshopSlotUnlockLevel(slot)}` : "";
    } else {
      const job = getWorkshopJob(state, slot);
      const order = job && job.orders ? job.orders[getRunningIndex(job)] : null;
      if (!job) {
        label = "IDLE";
      } else if (order) {
        // Batches done so far, plus how far through the current one
        const batch = job.status === "working" ? Math.min((now - job.startedAt) / job.durationMs, 1) : 0;
        amount = (order.done + batch) / order.batches;
        count = `${order.done}/${order.batches}`;
        label = job.status === "working" ? shortName(WORKSHOP_RECIPES[order.recipeId].name) : "NO METAL";
        if (job.status === "working") making = true;
      } else {
        // Running a standing order (Control centre), not a work order
        label = "STANDING";
        if (job.status === "working") {
          amount = Math.min((now - job.startedAt) / job.durationMs, 1);
          making = true;
        }
      }
    }
    ring.arc.setAttribute("stroke-dasharray", `${(amount * RING_LENGTH).toFixed(1)} ${RING_LENGTH.toFixed(1)}`);
    setText(ring.count, count);
    setText(ring.label, label);
  });

  // ----- Hold: each tank against the fullest one -----
  const totals = {};
  for (const [itemId, item] of Object.entries(ITEMS)) {
    totals[item.group] = (totals[item.group] || 0) + (state.inventory[itemId] || 0);
  }
  const most = Math.max(1, ...Object.values(totals));   // never divide by 0
  for (const tank of view.tanks) {
    const tonnes = totals[tank.groupId] || 0;
    // A sliver for any amount at all, so "a little" isn't drawn as none
    fillBar(tank.fill, tonnes > 0 ? Math.max(tonnes / most, 0.03) : 0, 3);
    setText(tank.amount, formatTonnes(tonnes));
  }

  // ----- The arrows light up while goods move along them -----
  view.flows.dockToRefinery.classList.toggle("is-active", smelting);
  view.flows.refineryToWorkshop.classList.toggle("is-active", making);
  view.flows.workshopToHold.classList.toggle("is-active", making);
}


// -------------------------------------------------------------
// setupIndustryView(getState)
// Starts the viewscreen. Called once by main.js, which passes a
// function giving the current game (it changes on import/reset).
// -------------------------------------------------------------
export function setupIndustryView(getState) {
  const svg = document.getElementById("industry-view");
  const screen = document.querySelector('section.screen[data-screen="industry"]');
  if (!svg || !screen) return;

  const view = drawStation(svg);

  function frame() {
    requestAnimationFrame(frame);
    if (screen.hidden) return;            // not on Industry: nothing to draw
    const state = getState();
    update(state, gameNow(state), view);
  }
  requestAnimationFrame(frame);
}
