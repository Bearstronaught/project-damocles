// =============================================================
// js/shipyard-view.js
// -------------------------------------------------------------
// THE SHIPYARD VIEWSCREEN (Dan, 3 Nov): the build cradle at the
// top of the Shipyard screen.
//
// One hull sits in the cradle, lying sideways (Dan chose sideways
// over nose-up: it fits the wide viewscreen better). A dim outline
// shows the whole hull; the bright, finished part grows from the
// stern to the nose as the player gathers what the next ship of
// that type costs. A teal "build line" marks how far it's got.
// When everything is in hand the whole hull lights up and the
// Build button in the readouts can be pressed.
//
// What "everything" means: the credits, and (for later hulls such
// as the Hauler) any manufactured products the ship needs. The
// bar shows the part that's furthest behind, so a hull is only
// "complete" when every need is met.
//
// The player picks which hull sits in the cradle with the buttons
// along the bottom (unlocked hulls only). The pick is remembered
// in this browser, not the save: it's how they like the screen.
//
// PICKER STATES (Dan, 4 Nov). Each button can be:
//   dim          not affordable yet
//   is-ready     you could build one right now: bright amber name
//                with a glowing outline, and one short pulse the
//                moment it becomes buildable
//   is-picked    the hull in the cradle: a solid filled button
//                (filled wins if it's both; the Build button and
//                Needed list already say it's ready)
// "Ready" is also in each button's screen-reader label, so the
// difference never rests on colour alone.
//
// TRIPS READOUT (Dan, 4 Nov). The trip table that used to sit on
// the hull tiles below the cradle (removed) now sits in the
// readouts, for the hull in the cradle.
//
// BUILDING (Dan, 5 Nov). Ships are built on a slipway over time
// (slipway.js). While a hull is being built, the cradle shows THAT
// hull filling in from the stern as the build runs, with the time
// left in the status line - the build on the picked hull's own
// berth first, else any berth that's busy. With nothing building,
// the cradle goes back to showing the picked hull lit up as far as
// it's paid for. The Slipways readout lists every order, with
// Cancel (a full refund).
//
// ART: today the cradle draws the code-drawn hulls from art.js,
// looked up by name (hull_prospector and so on). When the bought
// sprites can go on the public site, the same name can point at a
// sprite instead (design doc: Art and visual style); freighters
// will then fill in row by row with the freighter builder.
// =============================================================

import { SHIP_TYPES, HULL_SIZES, ITEMS, SKILLS, UPGRADES } from "../data/content.js";
import { getShipPrice, canBuyShip, countOwned } from "./shipyard.js";
import { BERTHS, getBerthFor, isBerthOpen, getOrders, getBuilding, getBuildProgressOf,
         getTimeUntilReady, getQueueWaitMs, getBuildMs, countOrdered } from "./slipway.js";
import { canBuyIndustryUpgrade } from "./upgrades.js";
import { gameNow } from "./clock.js";
import { isShipTypeUnlocked } from "./skills.js";
import { getShipPoints, getCommandFree } from "./command.js";
import { getShipArt, getSchematic } from "./art.js";
import { getHullGrades, getShipStats, getHullShortName } from "./ship-upgrades.js";
import { formatNumber, formatTonnes, formatSpeed, formatDuration, tripTable } from "./ui.js";
import { make, setText } from "./svg.js";


// -------------------------------------------------------------
// GEOMETRY (the drawing is 1000 x 360 units)
// The hull drawings in art.js are 140 x 80; the cradle shows one
// 3.6 times bigger, in the middle.
// -------------------------------------------------------------
const VIEW_W = 1000;
const SCALE = 3.6;
const HULL_W = 140 * SCALE;             // 504
const HULL_H = 80 * SCALE;              // 288
const HULL_X = (VIEW_W - HULL_W) / 2;   // 248: centred
const HULL_Y = 30;


// -------------------------------------------------------------
// getBuildNeeds(state, typeId)
// What the next ship of this type needs, as a list of
//   { label, have, need, unit }
// Always the credits; then any products listed in the hull's
// "costs" (the Hauler is the first, 5 Nov; design doc
// Manufacturing).
// -------------------------------------------------------------
export function getBuildNeeds(state, typeId) {
  const needs = [{ label: "Credits", have: state.credits, need: getShipPrice(state, typeId) ?? 0, unit: "cr" }];
  for (const [itemId, amount] of Object.entries(SHIP_TYPES[typeId].costs || {})) {
    needs.push({ label: ITEMS[itemId].name, have: state.inventory[itemId] || 0, need: amount, unit: "t" });
  }
  return needs;
}

// -------------------------------------------------------------
// getBuildProgress(state, typeId)
// How far along the hull in the cradle is, 0 to 1: the need that
// is furthest behind (so it's 1 only when everything is in hand).
// -------------------------------------------------------------
export function getBuildProgress(state, typeId) {
  let progress = 1;
  for (const need of getBuildNeeds(state, typeId)) {
    if (need.need > 0) progress = Math.min(progress, need.have / need.need);
  }
  return Math.max(0, Math.min(1, progress));
}

// -------------------------------------------------------------
// defaultHull(state)
// Which hull starts in the cradle: the most recently unlocked one
// (the highest unlock level; on a tie, the later in the list).
// -------------------------------------------------------------
export function defaultHull(state) {
  let best = null;
  for (const [typeId, type] of Object.entries(SHIP_TYPES)) {
    if (!isShipTypeUnlocked(state, typeId)) continue;
    if (!best || type.unlockLevel >= SHIP_TYPES[best].unlockLevel) best = typeId;
  }
  return best;
}

// What the Trips table measures, shown beside its title
const TRIP_TAGS = {
  mining: "Round trip from home",
  freight: "One full hold, sold at the hub",
  scout: "Round trip, scan included",
};

// -------------------------------------------------------------
// compareWith(typeId)
// Another hull of the same job to compare with "per command
// point", or null if there isn't one. The nearest size wins, the
// one below first: a Deep-core barge against the Excavator (not
// the Prospector), an Excavator against the Prospector, and a
// Prospector against the Excavator above it.
// -------------------------------------------------------------
const SIZE_ORDER = ["small", "medium", "large", "capital"];
function compareWith(typeId) {
  const type = SHIP_TYPES[typeId];
  const rank = SIZE_ORDER.indexOf(type.size);
  const others = Object.keys(SHIP_TYPES).filter((otherId) =>
    otherId !== typeId && SHIP_TYPES[otherId].role === type.role && SHIP_TYPES[otherId].size !== type.size);
  // Sort by how many sizes away, and on a tie the smaller one first
  const distance = (otherId) => {
    const step = SIZE_ORDER.indexOf(SHIP_TYPES[otherId].size) - rank;
    return Math.abs(step) * 2 + (step > 0 ? 1 : 0);
  };
  others.sort((a, b) => distance(a) - distance(b));
  return others[0] || null;
}


// -------------------------------------------------------------
// The remembered pick (localStorage). "try" because some browsers
// block storage; then the cradle just starts on the default.
// -------------------------------------------------------------
const PICK_KEY = "damocles-cradle-hull";
function loadPick() {
  try { return localStorage.getItem(PICK_KEY); } catch (error) { return null; }
}
function savePick(typeId) {
  try { localStorage.setItem(PICK_KEY, typeId); } catch (error) { /* not remembered: fine */ }
}


// -------------------------------------------------------------
// drawCradle(svg)
// The gantry, the clamps, and empty groups for the hull. Gives
// back the parts update() changes.
// -------------------------------------------------------------
function drawCradle(svg) {
  // The gantry: a frame with corner braces
  make("path", { class: "sy-gantry", d: "M60 18 H940 M60 342 H940 M90 18 V342 M910 18 V342 M90 18 L130 58 M910 18 L870 58 M90 342 L130 302 M910 342 L870 302" }, svg);

  // Clamp arms reaching in from above and below
  for (const x of [330, 500, 670]) {
    make("line", { class: "sy-clamp", x1: x, y1: 18, x2: x, y2: 92 }, svg);
    make("line", { class: "sy-clamp", x1: x, y1: 342, x2: x, y2: 268 }, svg);
    make("rect", { class: "sy-clamp-pad", x: x - 7, y: 90, width: 14, height: 6 }, svg);
    make("rect", { class: "sy-clamp-pad", x: x - 7, y: 264, width: 14, height: 6 }, svg);
  }

  // Where the hull goes: placed and scaled to fill the middle
  const place = `translate(${HULL_X} ${HULL_Y}) scale(${SCALE})`;
  const ghost = make("g", { class: "sy-ghost schematic", transform: place }, svg);
  // The finished part, cut off at the build line by a clip path
  const defs = make("defs", {}, svg);
  const clip = make("clipPath", { id: "sy-clip" }, defs);
  const clipRect = make("rect", { x: 0, y: 0, width: 0, height: 360 }, clip);
  // (The clip goes on an outer group with no transform, so the clip
  // rectangle is measured in the drawing's own 1000-wide units.)
  const clipped = make("g", { "clip-path": "url(#sy-clip)" }, svg);
  const built = make("g", { class: "sy-built schematic", transform: place }, clipped);

  // The build line
  const line = make("line", { class: "sy-line", x1: 0, y1: 40, x2: 0, y2: 320 }, svg);

  // The size line under the hull: "SMALL HULL · 1 COMMAND PT"
  make("path", { class: "sy-dim", d: `M${HULL_X} 330 H${HULL_X + HULL_W} M${HULL_X} 324 V336 M${HULL_X + HULL_W} 324 V336` }, svg);
  const size = make("text", { class: "sy-size", x: VIEW_W / 2, y: 325, "text-anchor": "middle" }, svg);

  return { ghost, built, clipRect, line, size, shownHull: null, shownGrades: "" };
}

// The inside of an art.js drawing (everything between <svg ...> and
// </svg>), so it can go in one of our groups
function innerOf(svgText) {
  return svgText.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
}


// -------------------------------------------------------------
// setupShipyardView(getState, actions)
// Starts the cradle. "actions" is main.js's list of player
// actions: Build uses actions.buyShip, the same as the cards.
// -------------------------------------------------------------
export function setupShipyardView(getState, actions) {
  const svg = document.getElementById("shipyard-view");
  const screen = document.querySelector('section.screen[data-screen="shipyard"]');
  if (!svg || !screen) return;

  const view = drawCradle(svg);
  const els = {
    status: document.getElementById("sy-status"),
    picker: document.getElementById("sy-picker"),
    name: document.getElementById("sy-name"),
    tag: document.getElementById("sy-tag"),
    desc: document.getElementById("sy-desc"),
    build: document.getElementById("sy-build"),
    note: document.getElementById("sy-note"),
    needs: document.getElementById("sy-needs"),
    compareTag: document.getElementById("sy-compare-tag"),
    stats: document.getElementById("sy-stats"),
    trips: document.getElementById("sy-trips"),
    tripsTag: document.getElementById("sy-trips-tag"),
    berths: document.getElementById("sy-berths"),
    berthsTag: document.getElementById("sy-slipways-tag"),
    berthMessage: document.getElementById("sy-berth-message"),
  };
  let picked = loadPick();
  const pickButtons = {};
  let lastNeeds = "";
  let lastBerths = "";       // which orders the Slipways readout shows, to know when to rebuild it
  let lastStats = "";
  let lastTrips = "";        // the trip table's HTML last time it was drawn
  let tripsCheckedAt = 0;    // when (ms) the trip table was last worked out
  const wasReady = {};       // each hull's "ready" state last frame, to spot the change

  els.build.addEventListener("click", () => {
    if (picked) actions.buyShip(picked);
  });

  // The Slipways readout's buttons: Cancel on an order, or Buy on
  // the heavy slipway. One listener for the whole area, because
  // the rows are rebuilt as orders come and go.
  els.berths.addEventListener("click", (event) => {
    const cancel = event.target.closest("[data-cancel]");
    if (cancel) {
      actions.cancelBuild(cancel.dataset.cancel);
      setText(els.berthMessage, "");
      return;
    }
    const buy = event.target.closest("[data-buy-upgrade]");
    if (buy) {
      const result = actions.buyIndustryUpgrade(buy.dataset.buyUpgrade);
      setText(els.berthMessage, result && !result.ok ? result.reason : "");
    }
  });

  function frame() {
    requestAnimationFrame(frame);
    if (screen.hidden) return;      // only draw while the page is open
    const state = getState();

    // ----- Which hull is in the cradle -----
    if (!picked || !SHIP_TYPES[picked] || !isShipTypeUnlocked(state, picked)) picked = defaultHull(state);
    if (!picked) return;
    const type = SHIP_TYPES[picked];

    // The pick buttons: one per unlocked hull, made as hulls unlock
    for (const typeId of Object.keys(SHIP_TYPES)) {
      const unlocked = isShipTypeUnlocked(state, typeId);
      if (unlocked && !pickButtons[typeId]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sy-pick";
        button.textContent = getHullShortName(typeId);   // "Prospector-class barge" -> "Prospector"
        button.addEventListener("click", () => { picked = typeId; savePick(typeId); });
        button.addEventListener("animationend", () => button.classList.remove("is-fresh"));
        els.picker.appendChild(button);
        pickButtons[typeId] = button;
      }
      const button = pickButtons[typeId];
      if (button) {
        button.hidden = !unlocked;
        button.classList.toggle("is-picked", typeId === picked);
        button.setAttribute("aria-pressed", String(typeId === picked));

        // Could you build one right now? Same check as the Build
        // button, so the picker and the button always agree.
        const ready = unlocked && canBuyShip(state, typeId).ok;
        button.classList.toggle("is-ready", ready);

        // Just became ready: play the pulse once. The class comes
        // off when the animation ends, so it can play again next
        // time. (With reduced motion on, the CSS skips the pulse.)
        if (ready && !wasReady[typeId]) {
          button.classList.add("is-fresh");
        }
        wasReady[typeId] = ready;

        // What a screen reader says: the name, plus "ready to build"
        const shortName = getHullShortName(typeId);
        const label = ready ? `${shortName}, ready to build` : shortName;
        if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
      }
    }

    // ----- What the cradle shows: a hull being built, if there is
    //       one (the picked hull's own berth first), else the
    //       picked hull lit up as far as it's paid for -----
    const gameTime = gameNow(state);
    const pickedBerth = getBerthFor(picked);
    const active = (pickedBerth && getBuilding(state, pickedBerth))
      || Object.keys(BERTHS).map((berthId) => getBuilding(state, berthId)).find(Boolean)
      || null;
    const shownId = active ? active.type : picked;
    const shownType = SHIP_TYPES[shownId];

    // ----- The hull drawing: redrawn only when the hull or its
    //       fitted components change -----
    const grades = getHullGrades(state, shownId);
    const gradesKey = JSON.stringify(grades);
    if (view.shownHull !== shownId || view.shownGrades !== gradesKey) {
      view.ghost.innerHTML = innerOf(getSchematic(shownType.art));
      view.built.innerHTML = innerOf(getShipArt(shownType.art, grades));
      view.shownHull = shownId;
      view.shownGrades = gradesKey;
    }

    // ----- How far it's built: the real build, or the savings -----
    const progress = active ? getBuildProgressOf(active, gameTime) : getBuildProgress(state, picked);
    const edge = HULL_X + HULL_W * progress;     // where the build line sits
    view.clipRect.setAttribute("width", edge.toFixed(1));
    view.line.setAttribute("x1", edge.toFixed(1));
    view.line.setAttribute("x2", edge.toFixed(1));
    const complete = !active && progress >= 1;
    svg.classList.toggle("is-complete", complete);
    svg.classList.toggle("is-building", Boolean(active));

    const shownPoints = getShipPoints(shownId);
    setText(view.size, `${HULL_SIZES[shownType.size].name.toUpperCase()} HULL · ${shownPoints} COMMAND PT${shownPoints === 1 ? "" : "S"}`);
    const points = getShipPoints(picked);

    // ----- Status line, card and button -----
    const check = canBuyShip(state, picked);
    const price = getShipPrice(state, picked);
    if (active) {
      const left = Math.max(0, active.startedAt + active.durationMs - gameTime);
      setText(els.status, `Building ${getHullShortName(active.type)} · ${formatDuration(left)} left`);
    } else {
      setText(els.status, complete ? "Ready to build" : `Assembly ${Math.floor(progress * 100)}%`);
    }
    setText(els.name, type.name);
    // e.g. "Mining · 2 owned · 1 on order"
    const onOrder = countOrdered(state, picked);
    setText(els.tag, `${SKILLS[type.skill].name} · ${countOwned(state, picked)} owned` + (onOrder > 0 ? ` · ${onOrder} on order` : ""));
    setText(els.desc, type.description);
    // e.g. "Build · 150,000 cr + 60 t hull plating + 30 t wiring coils"
    const goods = Object.entries(type.costs || {})
      .map(([itemId, tonnes]) => ` + ${formatTonnes(tonnes)} ${ITEMS[itemId].name.toLowerCase()}`).join("");
    setText(els.build, price === null ? "Not sold" : `Build · ${formatNumber(price)} cr${goods}`);
    els.build.disabled = !check.ok;
    let note;
    if (check.ok) {
      // When it would be ready: straight away on a free berth, or
      // behind whatever is already there.
      const wait = getQueueWaitMs(state, pickedBerth, gameTime);
      const when = wait > 0
        ? `Joins the queue: ready in ${formatDuration(wait + getBuildMs(picked))}.`
        : `Builds in ${formatDuration(getBuildMs(picked))}.`;
      note = `${when} Uses ${points} of your ${getCommandFree(state)} free command points.`;
    }
    else if (check.reason === "Not enough command points") note = `Needs ${points} command points; you have ${getCommandFree(state)} free. Ships on order count too.`;
    else if (check.reason === "Not enough credits") note = `${formatNumber(price - state.credits)} cr to go.`;
    else note = check.reason;
    setText(els.note, note);

    // ----- Needs: have / need, rebuilt only when it changes -----
    const needs = getBuildNeeds(state, picked).map((n) => ({
      label: n.label,
      text: n.unit === "cr"
        ? `${formatNumber(Math.min(n.have, n.need))} / ${formatNumber(n.need)} cr`
        : `${formatTonnes(Math.min(n.have, n.need))} / ${formatTonnes(n.need)}`,
      met: n.have >= n.need,
    }));
    needs.push({ label: "Command points", text: `${getCommandFree(state)} free / ${points}`, met: getCommandFree(state) >= points });
    // A berth to build it on (large hulls need the heavy slipway)
    if (pickedBerth === null) {
      needs.push({ label: "Berth", text: "Shipyard station", met: false });
    } else if (!isBerthOpen(state, pickedBerth)) {
      needs.push({ label: "Berth", text: `${BERTHS[pickedBerth].name}: not built`, met: false });
    }
    const needsKey = JSON.stringify(needs);
    if (needsKey !== lastNeeds) {
      lastNeeds = needsKey;
      els.needs.innerHTML = "";
      for (const need of needs) els.needs.appendChild(row(need.label, need.text, need.met ? "is-met" : "is-short"));
    }

    // ----- The Slipways readout -----
    lastBerths = drawBerths(state, gameTime, els, lastBerths);

    // ----- Stats, per command point against a same-job hull -----
    const other = compareWith(picked);
    const mine = getShipStats(state, picked);
    const theirs = other ? getShipStats(state, other) : null;
    const perPoint = (value, typeId) => value / getShipPoints(typeId);
    const versus = (key) => {
      if (!theirs || !theirs[key]) return "";
      const change = perPoint(mine[key], picked) / perPoint(theirs[key], other) - 1;
      return ` (${change >= 0 ? "+" : ""}${Math.round(change * 100)}%)`;
    };
    const stats = [];
    if (type.cargoCapacity > 0) stats.push(["Hold", `${formatTonnes(mine.cargoCapacity)}${versus("cargoCapacity")}`]);
    if (mine.miningRate) stats.push(["Drill", `${formatTonnes(Math.round(mine.miningRate))}/min${versus("miningRate")}`]);
    stats.push(["Speed", formatSpeed(mine.speed)]);
    stats.push(["Loading", `${HULL_SIZES[type.size].loadingRate} t/s`]);
    const statsKey = JSON.stringify(stats) + other;
    if (statsKey !== lastStats) {
      lastStats = statsKey;
      setText(els.compareTag, other ? `Per pt vs ${getHullShortName(other)}` : "With your components");
      els.stats.innerHTML = "";
      for (const [label, value] of stats) els.stats.appendChild(row(label, value, ""));
    }

    // ----- Trips: worked out at most twice a second (it only
    //       changes with levels, components or a new pick), and
    //       redrawn only when the table actually changes -----
    const now = performance.now();
    if (now - tripsCheckedAt > 500 || els.trips.dataset.hull !== picked) {
      tripsCheckedAt = now;
      const html = tripTable(state, picked);
      if (html !== lastTrips || els.trips.dataset.hull !== picked) {
        lastTrips = html;
        els.trips.dataset.hull = picked;
        els.trips.innerHTML = html;
        setText(els.tripsTag, TRIP_TAGS[type.role] || TRIP_TAGS.mining);
      }
    }
  }
  requestAnimationFrame(frame);
}

// -------------------------------------------------------------
// drawBerths(state, now, els, lastKey)
// The Slipways readout: one block per berth with its status and
// its orders. The rows are rebuilt only when the orders change
// (or the heavy slipway's state does); the times and bars inside
// them are updated every frame. Returns the key it drew, so the
// next frame can tell whether anything changed.
// -------------------------------------------------------------
function drawBerths(state, now, els, lastKey) {
  // What's on the slipways, as a short key: berth, order and
  // whether it has started, plus whether each berth is open.
  const key = Object.keys(BERTHS).map((berthId) =>
    berthId + ":" + isBerthOpen(state, berthId) + ":" +
    getOrders(state, berthId).map((o) => o.id + (o.startedAt === null ? "q" : "b")).join(",")
  ).join("|");

  if (key !== lastKey) {
    els.berths.innerHTML = "";
    for (const [berthId, berth] of Object.entries(BERTHS)) {
      const block = document.createElement("div");
      block.className = "sy-berth";
      const sizes = berth.sizes.map((size) => HULL_SIZES[size].name.toLowerCase()).join(" and ");

      // Heading: the berth's name and its state ("Idle", "Building")
      const head = document.createElement("h3");
      head.className = "sub-title sy-berth-head";
      head.innerHTML = `<span>${berth.name}</span><span class="component-total" data-berth-status="${berthId}"></span>`;
      block.appendChild(head);

      if (!isBerthOpen(state, berthId)) {
        // Not built yet: what it's for, and how to get it
        const upgrade = UPGRADES[berth.upgrade];
        const goods = Object.entries(upgrade.costs)
          .map(([itemId, tonnes]) => `${formatTonnes(tonnes)} ${ITEMS[itemId].name.toLowerCase()}`);
        const cost = [...goods, formatNumber(upgrade.credits) + " cr"].join(" + ");
        const text = document.createElement("p");
        text.className = "price-note";
        text.textContent = `Builds ${sizes} hulls. Opens at ${SKILLS[upgrade.skill].name} ${upgrade.level}: ${cost}.`;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn btn-small";
        button.dataset.buyUpgrade = berth.upgrade;
        button.dataset.berthBuy = berthId;
        button.textContent = `Build the ${berth.name.toLowerCase()}`;
        block.append(text, button);
      } else {
        const orders = getOrders(state, berthId);
        if (orders.length === 0) {
          const text = document.createElement("p");
          text.className = "price-note";
          text.textContent = `Builds ${sizes} hulls. Nothing on order.`;
          block.appendChild(text);
        }
        const list = document.createElement("ul");
        list.className = "sy-list";
        for (const order of orders) {
          const item = document.createElement("li");
          item.className = "sy-row sy-order" + (order.startedAt === null ? " is-queued" : " is-building");
          item.innerHTML = `
            <span class="sy-order-name">${getHullShortName(order.type)}</span>
            <span class="sy-value" data-order-time="${order.id}"></span>
            <button class="btn btn-small btn-quiet" type="button" data-cancel="${order.id}"
                    aria-label="Cancel the ${getHullShortName(order.type)} order, full refund">Cancel</button>
            ${order.startedAt === null ? "" : `<span class="sy-order-bar"><span data-order-bar="${order.id}"></span></span>`}
          `;
          list.appendChild(item);
        }
        block.appendChild(list);
      }
      els.berths.appendChild(block);
    }
  }

  // ----- Every frame: times, bars and statuses -----
  let ordersTotal = 0;
  for (const berthId of Object.keys(BERTHS)) {
    const status = els.berths.querySelector(`[data-berth-status="${berthId}"]`);
    const orders = getOrders(state, berthId);
    ordersTotal += orders.length;
    if (!isBerthOpen(state, berthId)) {
      setText(status, "Not built");
    } else if (orders.length === 0) {
      setText(status, "Idle");
    } else {
      setText(status, orders.length === 1 ? "Building" : `Building · ${orders.length - 1} queued`);
    }

    // The heavy slipway's Buy button: only pressable when it can be bought
    const buy = els.berths.querySelector(`[data-berth-buy="${berthId}"]`);
    if (buy) {
      const check = canBuyIndustryUpgrade(state, BERTHS[berthId].upgrade);
      buy.disabled = !check.ok;
      buy.title = check.ok ? "" : check.reason;
    }

    for (const order of orders) {
      const time = els.berths.querySelector(`[data-order-time="${order.id}"]`);
      if (order.startedAt === null) {
        setText(time, `ready in ${formatDuration(getTimeUntilReady(state, order.id, now))}`);
      } else {
        const left = Math.max(0, order.startedAt + order.durationMs - now);
        setText(time, `${formatDuration(left)} left`);
        const bar = els.berths.querySelector(`[data-order-bar="${order.id}"]`);
        if (bar) bar.style.width = (getBuildProgressOf(order, now) * 100).toFixed(1) + "%";
      }
    }
  }
  setText(els.berthsTag, ordersTotal === 0 ? "Nothing on order" : `${ordersTotal} on order`);
  return key;
}

// One readout row: a label on the left, a value on the right
function row(label, value, className) {
  const item = document.createElement("li");
  item.className = "sy-row " + className;
  const left = document.createElement("span");
  left.textContent = label;
  const right = document.createElement("span");
  right.className = "sy-value";
  right.textContent = value;
  item.append(left, right);
  return item;
}
