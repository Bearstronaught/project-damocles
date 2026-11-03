// =============================================================
// js/exploration-view.js
// -------------------------------------------------------------
// THE EXPLORATION VIEWSCREEN (Dan, 1 and 3 Nov): a sensor sweep
// at the top of the Exploration screen. Anvil Station sits in the
// middle of a set of range rings; every survey target is drawn at
// a distance set by its real flight time, so the furthest targets
// are the longest trips.
//
//   surveyed      a grey dot with a tick
//   ready         an amber ring: a scout could go now; the card
//                 beside the sweep has its Launch button
//   locked        a dashed ring with the Exploration level it needs
//   not found yet hidden (a wreck stage needs the one before it)
//
// Scouts fly out along a line to their target and back, from the
// same trip numbers as their trip bars (jobs.js getJobPhase), and
// the sweep line turns slowly round (it stays still if the player
// has asked their device for reduced motion).
// =============================================================

import { SURVEY_TARGETS } from "../data/content.js";
import { getTarget, getTargetStatus, getReadySurveys, getScoutPlan, DEEP_SCAN_ID } from "./exploration.js";
import { getJobForShip, getJobPhase } from "./jobs.js";
import { gameNow } from "./clock.js";
import { formatDuration } from "./ui.js";
import { make, setText } from "./svg.js";


// -------------------------------------------------------------
// GEOMETRY (the drawing is 1000 x 400 units)
// -------------------------------------------------------------
// (If you move it, move transform-origin in style.css's
// .ev-sweep rule too, so the sweep still turns round the station.)
const CENTRE = { x: 380, y: 205 };
const UNITS_PER_SECOND = 0.65;    // distance per second of flight
const NEAR = 30;                  // the closest ring, so nothing sits on the station

// polarPoint(seconds, angle)
// The point "seconds" of flight from the station, "angle" degrees
// round (0 = right, 90 = down, -90 = up).
function polarPoint(seconds, angle) {
  const r = NEAR + seconds * UNITS_PER_SECOND;
  const radians = angle * Math.PI / 180;
  return { x: CENTRE.x + r * Math.cos(radians), y: CENTRE.y + r * Math.sin(radians) };
}

// The direction each target sits in. Only for the drawing: the
// distance comes from the target's own flight time. The wreck's
// four stages share one marker.
const ANGLES = {
  inner_belt_survey: 160,
  outer_belt_survey: 20,
  wreck: 55,
  ice_moon: -60,
  silent_relay: -130,
  system_edge: 140,
  [DEEP_SCAN_ID]: -20,
};
const WRECK_STAGES = ["wreck_1", "wreck_2", "wreck_3", "wreck_4"];

// Which marker a target uses ("wreck_3" -> "wreck")
function markerFor(targetId) {
  return WRECK_STAGES.includes(targetId) ? "wreck" : targetId;
}


// -------------------------------------------------------------
// drawSweep(svg)
// The rings, the sweep and one marker per target. Gives back the
// parts update() changes.
// -------------------------------------------------------------
function drawSweep(svg) {
  // Range rings every minute of flight, out to 4 minutes, and a
  // cross through the middle
  for (const seconds of [60, 120, 180, 240]) {
    make("circle", { class: "ev-ring", cx: CENTRE.x, cy: CENTRE.y, r: NEAR + seconds * UNITS_PER_SECOND }, svg);
    // A small "2 MIN" style label on each ring, at the top
    make("text", { class: "ev-ring-label", x: CENTRE.x + 4, y: CENTRE.y - (NEAR + seconds * UNITS_PER_SECOND) - 4 }, svg)
      .textContent = `${seconds / 60} MIN`;
  }
  const reach = NEAR + 240 * UNITS_PER_SECOND;
  make("path", { class: "ev-ring", d: `M${CENTRE.x - reach} ${CENTRE.y} H${CENTRE.x + reach} M${CENTRE.x} ${CENTRE.y - reach} V${CENTRE.y + reach}` }, svg);

  // The sweep: a faint wedge and a bright edge, turned by CSS
  // (style.css .ev-sweep) round the station
  const sweep = make("g", { class: "ev-sweep" }, svg);
  const tip = polarPoint(240, 0);
  const back = polarPoint(240, -28);
  make("path", { class: "ev-wedge", d: `M${CENTRE.x} ${CENTRE.y} L${tip.x} ${tip.y} A${reach} ${reach} 0 0 0 ${back.x} ${back.y} Z` }, sweep);
  make("line", { class: "ev-edge", x1: CENTRE.x, y1: CENTRE.y, x2: tip.x, y2: tip.y }, sweep);

  // The routes layer (under the markers and scouts)
  const routes = make("g", {}, svg);

  // One marker per place
  const markers = {};
  const places = Object.keys(SURVEY_TARGETS).map(markerFor).concat([DEEP_SCAN_ID]);
  for (const placeId of new Set(places)) {   // a Set drops the repeats (four wreck stages)
    const target = getTarget(placeId === "wreck" ? "wreck_1" : placeId);
    const point = polarPoint(target.travelSeconds, ANGLES[placeId]);
    const group = make("g", { class: "ev-target" }, svg);
    const halo = make("circle", { class: "ev-halo", cx: point.x, cy: point.y, r: 16 }, group);
    const dot = make("circle", { class: "ev-dot", cx: point.x, cy: point.y, r: 5 }, group);
    // Each label points away from the station: targets on the
    // left half get their label on the left, so labels on
    // opposite sides never run into each other.
    const right = point.x >= CENTRE.x;
    const label = make("text", {
      class: "ev-label",
      x: right ? point.x + 12 : point.x - 12,
      y: point.y + 4,
      "text-anchor": right ? "start" : "end",
    }, group);
    markers[placeId] = { group, halo, dot, label, point };
  }

  // The station in the middle
  make("rect", { class: "ev-station", x: CENTRE.x - 6, y: CENTRE.y - 6, width: 12, height: 12 }, svg);

  const scouts = make("g", {}, svg);
  return { markers, routes, scouts };
}


// -------------------------------------------------------------
// placeLabel(state, placeId)
// The name shown on the sweep: the wreck shows which stage is
// next, e.g. "THE WRECK · 3 OF 4".
// -------------------------------------------------------------
function placeLabel(state, placeId) {
  if (placeId === "wreck") {
    const done = WRECK_STAGES.filter((id) => getTargetStatus(state, id) === "surveyed").length;
    return done === WRECK_STAGES.length ? "THE WRECK ✓" : `THE WRECK · ${done + 1} OF ${WRECK_STAGES.length}`;
  }
  if (placeId === DEEP_SCAN_ID) return "DEEP SCAN";
  return getTarget(placeId).name.toUpperCase();
}


// -------------------------------------------------------------
// markerStatus(state, placeId, ready)
// How a marker is drawn: "surveyed", "ready", "available" (open,
// but already launched or a scout's on it), "locked" or "hidden".
// For the wreck: the status of its next stage.
// -------------------------------------------------------------
function markerStatus(state, placeId, ready) {
  let targetId = placeId;
  if (placeId === "wreck") {
    targetId = WRECK_STAGES.find((id) => getTargetStatus(state, id) !== "surveyed");
    if (!targetId) return "surveyed";                    // all four done
    // An unfound wreck stays hidden until the first stage could be done
    if (targetId === "wreck_1" && getTargetStatus(state, "wreck_1") !== "available") return "hidden";
  }
  if (placeId === DEEP_SCAN_ID) return "hidden";        // shown only while a scout is there
  if (ready.includes(targetId)) return "ready";
  const status = getTargetStatus(state, targetId);
  if (status === "needs") return placeId === "wreck" ? "locked" : "hidden";
  return status;                                         // "surveyed", "available" or "locked"
}


// -------------------------------------------------------------
// update(state, now, view, card)
// Brings the sweep up to date. Runs every frame.
// -------------------------------------------------------------
function update(state, now, view, card, shipParts) {
  const ready = getReadySurveys(state);

  for (const [placeId, marker] of Object.entries(view.markers)) {
    const status = markerStatus(state, placeId, ready);
    marker.group.setAttribute("class", "ev-target is-" + status);
    let text = placeLabel(state, placeId);
    if (status === "surveyed" && placeId !== "wreck") text += " ✓";
    if (status === "ready") text += " · READY";
    if (status === "locked") {
      const id = placeId === "wreck" ? WRECK_STAGES.find((s) => getTargetStatus(state, s) !== "surveyed") : placeId;
      text += ` · LV ${getTarget(id).unlockLevel}`;
    }
    setText(marker.label, text);
  }

  // ----- Scouts flying out and back -----
  let deepScanning = false;
  const seen = new Set();
  for (const ship of state.ships) {
    const job = getJobForShip(state, ship.id);
    if (!job || job.type !== "scout") continue;
    seen.add(ship.id);
    const placeId = markerFor(job.targetId);
    const marker = view.markers[placeId];
    if (!marker) continue;
    if (placeId === DEEP_SCAN_ID) deepScanning = true;

    // Make this scout's drawing the first time
    let parts = shipParts.get(ship.id);
    if (!parts) {
      const group = make("g", { class: "ev-scout" }, view.scouts);
      make("polygon", { points: "-6,-5 7,0 -6,5" }, group);
      const name = make("text", { class: "ev-scout-label", x: 10, y: -8 }, group);
      const route = make("line", { class: "ev-route" }, view.routes);
      parts = { group, name, route };
      shipParts.set(ship.id, parts);
    }

    // Out along the line, at the target while scanning, back again
    const phase = getJobPhase(job, now);
    const [out, , back] = phase.fills;      // outbound, scanning, returning
    const amount = out < 1 ? out : 1 - back;
    const x = CENTRE.x + (marker.point.x - CENTRE.x) * amount;
    const y = CENTRE.y + (marker.point.y - CENTRE.y) * amount;
    const goingOut = out < 1 || back === 0;
    const angle = Math.atan2(marker.point.y - CENTRE.y, marker.point.x - CENTRE.x) * 180 / Math.PI + (goingOut ? 0 : 180);
    parts.group.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${angle.toFixed(0)})`);
    // The name stays upright: it's turned back by the same angle
    parts.name.setAttribute("transform", `rotate(${(-angle).toFixed(0)})`);
    setText(parts.name, ship.name.toUpperCase());
    parts.route.setAttribute("x1", CENTRE.x);
    parts.route.setAttribute("y1", CENTRE.y);
    parts.route.setAttribute("x2", marker.point.x.toFixed(1));
    parts.route.setAttribute("y2", marker.point.y.toFixed(1));
  }
  // Scouts that docked or were sold: remove their drawings
  for (const [id, parts] of shipParts) {
    if (!seen.has(id)) {
      parts.group.remove();
      parts.route.remove();
      shipParts.delete(id);
    }
  }
  view.markers[DEEP_SCAN_ID].group.classList.toggle("is-hidden", !deepScanning);
  if (deepScanning) view.markers[DEEP_SCAN_ID].group.classList.add("is-available");

  // ----- The card: the next survey ready to launch -----
  const next = ready[0];
  card.box.hidden = !next;
  if (next) {
    const target = getTarget(next);
    setText(card.name, target.name);
    // The same trip time as the target list shows: a Pathfinder's
    // (the only scout so far), with its drive and sensor upgrades
    const plan = getScoutPlan(state, "pathfinder", next);
    setText(card.trip, formatDuration(plan.durationMs) + " trip");
    setText(card.more, ready.length > 1 ? `+ ${ready.length - 1} more ready below` : "");
    card.box.dataset.target = next;
  }
}


// -------------------------------------------------------------
// setupExplorationView(getState, actions)
// Starts the viewscreen. "actions" is main.js's list of player
// actions; the card's button uses actions.launchSurvey, the same
// as the Launch survey buttons in the target list.
// -------------------------------------------------------------
export function setupExplorationView(getState, actions) {
  const svg = document.getElementById("exploration-view");
  const screen = document.querySelector('section.screen[data-screen="exploration"]');
  if (!svg || !screen) return;

  const view = drawSweep(svg);
  const shipParts = new Map();     // scout id -> its drawn parts
  const card = {
    box: document.getElementById("ev-card"),
    name: document.getElementById("ev-card-name"),
    trip: document.getElementById("ev-card-trip"),
    more: document.getElementById("ev-card-more"),
  };
  document.getElementById("ev-card-launch").addEventListener("click", () => {
    if (card.box.dataset.target) actions.launchSurvey(card.box.dataset.target);
  });

  function frame() {
    requestAnimationFrame(frame);
    if (screen.hidden) return;
    const state = getState();
    update(state, gameNow(state), view, card, shipParts);
  }
  requestAnimationFrame(frame);
}
