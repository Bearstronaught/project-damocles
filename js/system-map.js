// =============================================================
// js/system-map.js
// -------------------------------------------------------------
// THE SYSTEM MAP: the viewscreen at the top of the Command
// screen (Dan, 1 and 3 Nov). A drawing of the home system with
// Anvil Station, the asteroid belts, Last Post and the places
// your scouts have found, and every ship that's out, moving in
// real time along its trip.
//
// How a ship's position is worked out
// -----------------------------------
// The game doesn't store "where is this ship". It stores each
// trip as a timed job: when it started and how long each part
// (outbound, mining, returning...) takes. jobs.js getJobPhase()
// turns that into "which part are we in, and how far through".
// The trip bars on the ship cards use exactly the same numbers,
// so the map and the bars always agree. For example a barge 40%
// of the way through its outbound flight is drawn 40% of the way
// from the station to its field.
//
// Distances
// ---------
// How far out a place is drawn comes from its real flight time
// in the balance sheet (Inner Belt 45 s, Outer Belt 90 s, Last
// Post 180 s...), so further on the map means a longer flight.
// Only the DIRECTION of each place (its angle) is chosen here,
// to spread things out so the drawing is easy to read. Nothing
// on this map changes the game: it only draws it.
//
// Smooth movement
// ---------------
// The game itself updates 4 times a second (main.js). The map
// redraws on every screen frame instead (requestAnimationFrame,
// about 60 a second) by asking the game clock what time it is
// now, so ships glide rather than jump. It only does this while
// the Command screen is showing; the browser pauses it in a
// hidden tab.
// =============================================================

import { FIELDS, HUB, HOME, SHIP_TYPES } from "../data/content.js";
import { getJobForShip, getJobPhase } from "./jobs.js";
import { gameNow } from "./clock.js";
import { getTarget, getTargetStatus, DEEP_SCAN_ID } from "./exploration.js";
import { isFieldUnlocked } from "./skills.js";
import { make } from "./svg.js";


// -------------------------------------------------------------
// THE DRAWING'S GEOMETRY
// -------------------------------------------------------------
// The drawing is 1000 x 440 units (its "viewBox"); the browser
// scales it to fit the panel. The star sits near the left edge.
const STAR = { x: 120, y: 220 };

// Orbits are drawn as flattened circles (ellipses), as if the
// system is seen from a little above. An orbit's width grows by
// 3 units for every second of flight from the station.
const UNITS_PER_SECOND = 3;
const STATION_ORBIT = 90;     // the station's own orbit, close in
const FLATTEN = 0.42;         // how flat the ellipses are (1 = circle)

// orbitPoint(seconds, angle)
// The point on the orbit "seconds" of flight out, at "angle"
// degrees around the star (0 = right, 90 = down, -90 = up).
function orbitPoint(seconds, angle) {
  const rx = STATION_ORBIT + seconds * UNITS_PER_SECOND;   // half the ellipse's width
  const ry = rx * FLATTEN;                                  // half its height
  const radians = angle * Math.PI / 180;                    // Math.cos wants radians
  return { x: STAR.x + rx * Math.cos(radians), y: STAR.y + ry * Math.sin(radians) };
}

// Anvil Station: on the inner orbit, a little above the star.
const STATION = orbitPoint(0, -20);

// Where each place sits. "seconds" is its real flight time from
// the game data; "angle" is only for the drawing.
//   ring: true  = an asteroid belt, drawn as a whole ring. Each
//                 ship mines at its own point on it (see shipAngle).
// getPlaces() is a function, not a fixed list, because the
// survey targets are only filled in once content.js has loaded.
function getPlaces() {
  return {
    inner_belt: { name: FIELDS.inner_belt.name, seconds: FIELDS.inner_belt.travelSeconds, angle: -10, ring: true },
    outer_belt: { name: FIELDS.outer_belt.name, seconds: FIELDS.outer_belt.travelSeconds, angle: 8, ring: true },
    ice_moon: { name: FIELDS.ice_moon.name, seconds: FIELDS.ice_moon.travelSeconds, angle: -38 },
    // The deep core (4 Nov): far out to the upper right, clear of
    // the Ice moon and Last Post (at 62 its label fell off the map)
    deep_core: { name: FIELDS.deep_core.name, seconds: FIELDS.deep_core.travelSeconds, angle: -18 },
    hub: { name: HUB.name, seconds: HUB.travelSeconds, angle: 28 },
    // The wreck is in the Outer Belt (same flight time)
    wreck: { name: "The wreck", seconds: getTarget("wreck_1").travelSeconds, angle: 52 },
    silent_relay: { name: getTarget("silent_relay").name, seconds: getTarget("silent_relay").travelSeconds, angle: -50 },
    system_edge: { name: getTarget("system_edge").name, seconds: getTarget("system_edge").travelSeconds, angle: 12 },
    deep_scan: { name: "Deep scan", seconds: getTarget(DEEP_SCAN_ID).travelSeconds, angle: -90 },
  };
}

// Which place each survey target is at
const TARGET_PLACE = {
  inner_belt_survey: "inner_belt",
  outer_belt_survey: "outer_belt",
  wreck_1: "wreck", wreck_2: "wreck", wreck_3: "wreck", wreck_4: "wreck",
  ice_moon: "ice_moon",
  silent_relay: "silent_relay",
  system_edge: "system_edge",
  [DEEP_SCAN_ID]: "deep_scan",   // [ ] uses the constant's value as the name
};

// Ship colours by role: the same muted group colours as the menu
// (style.css). Mining is amber like the Command screen.
const ROLE_CLASS = {
  mining: "map-ship-mining",
  freight: "map-ship-freight",
  scout: "map-ship-scout",
};


// -------------------------------------------------------------
// shipAngle(ship, baseAngle)
// Eight barges at the same belt would all sit on one dot, so
// each ship mines at its own point along the ring (Dan agreed
// this is only for looks). The spread comes from the ship's id
// ("ship-7" -> 7), so a ship always goes to the same spot.
// -------------------------------------------------------------
function shipAngle(ship, baseAngle) {
  const number = Number(String(ship.id).replace(/\D/g, "")) || 0;   // \D = anything not a digit
  // (number * 5) % 9 gives 0..8 in a mixed-up order, so ships
  // bought one after another don't land side by side.
  const step = (number * 5) % 9 - 4;    // -4 .. 4
  return baseAngle + step * 4;          // up to 16 degrees either side
}


// -------------------------------------------------------------
// whereIs(state, ship, now, places)
// Where a ship is right now, and which way it's facing.
// Gives back { x, y, heading, moving, destination, placeId,
//               destinationName, phase }
// or null for a ship sitting at home (docked ships aren't drawn;
// the station label counts them instead).
// -------------------------------------------------------------
function whereIs(state, ship, now, places) {
  const job = getJobForShip(state, ship.id);
  if (!job) return null;                  // docked
  const phase = getJobPhase(job, now);
  if (phase.phase === "waiting") return null;   // freighter waiting at home

  // Where this trip goes
  let placeId;
  if (job.type === "haul") placeId = "hub";
  else if (job.type === "scout") placeId = TARGET_PLACE[job.targetId];
  else placeId = job.fieldId;             // mining (charters too)
  const place = places[placeId];
  if (!place) return null;                // somewhere this map doesn't know yet

  const angle = place.ring ? shipAngle(ship, place.angle) : place.angle;
  const there = orbitPoint(place.seconds, angle);

  // "fills" is how full each part of the trip is, 0 to 1, in the
  // order getJobPhase lists them (see jobs.js). Pick out the
  // flight out and the flight back.
  let out, back;
  if (job.type === "haul") {
    out = phase.fills[1];   // loading, OUTBOUND, trading, returning
    back = phase.fills[3];
  } else {
    out = phase.fills[0];   // OUTBOUND, mining/scanning, RETURNING, (unloading)
    back = phase.fills[2];
  }

  // Part way there: walk from the station towards the place.
  // Part way back: walk from the place towards the station.
  // In between (mining, scanning, selling): at the place.
  // Before leaving (loading) or after landing (unloading): at home.
  let from, to, amount;
  if (out < 1) { from = STATION; to = there; amount = out; }
  else if (back > 0) { from = there; to = STATION; amount = back; }
  else { from = there; to = there; amount = 1; }

  const atHome = (out === 0 && back === 0) || back >= 1;
  if (atHome) return null;                // loading or unloading: counted as at the station

  const x = from.x + (to.x - from.x) * amount;
  const y = from.y + (to.y - from.y) * amount;
  const moving = from !== to;
  // Face the way it's flying; while working, face back home.
  const target = moving ? to : STATION;
  const heading = Math.atan2(target.y - y, target.x - x) * 180 / Math.PI;
  return { x, y, heading, moving, destination: there, placeId, destinationName: place.name, phase: phase.phase };
}


// -------------------------------------------------------------
// drawBackground(svg, places)
// Everything that doesn't move: orbits, belts, the star, the
// station and the places. Drawn once; updatePlaces() then shows
// or dims each place as the game unlocks it.
// Returns the elements updatePlaces() needs, by place id.
// -------------------------------------------------------------
function drawBackground(svg, places) {
  // Faint orbit lines: the station's, and one at each place
  const orbits = make("g", { class: "map-orbits" }, svg);
  for (const seconds of [0, places.ice_moon.seconds, places.hub.seconds]) {
    const rx = STATION_ORBIT + seconds * UNITS_PER_SECOND;
    make("ellipse", { cx: STAR.x, cy: STAR.y, rx, ry: rx * FLATTEN }, orbits);
  }

  // The routes layer goes here, under the places and ships
  const routes = make("g", { class: "map-routes" }, svg);

  // The star, with a soft halo
  make("circle", { class: "map-star-halo", cx: STAR.x, cy: STAR.y, r: 34 }, svg);
  make("circle", { class: "map-star", cx: STAR.x, cy: STAR.y, r: 18 }, svg);

  const placeElements = {};
  for (const [id, place] of Object.entries(places)) {
    const group = make("g", { class: "map-place", "data-place": id }, svg);
    const point = orbitPoint(place.seconds, place.angle);
    if (place.ring) {
      // A belt: a dotted ring all the way round
      const rx = STATION_ORBIT + place.seconds * UNITS_PER_SECOND;
      make("ellipse", { class: "map-belt", cx: STAR.x, cy: STAR.y, rx, ry: rx * FLATTEN }, group);
    } else if (id === "hub") {
      make("polygon", { class: "map-hub", points: diamond(point, 8) }, group);
    } else if (id === "ice_moon") {
      make("circle", { class: "map-moon", cx: point.x, cy: point.y, r: 6 }, group);
    } else {
      make("circle", { class: "map-marker", cx: point.x, cy: point.y, r: 4 }, group);
    }
    // The label sits beside the place (for a belt, beside where
    // its ships gather). The <tspan> holds a short note such as
    // "locked" that updatePlaces() fills in.
    // Near the right edge the label goes on the left of the
    // place instead ("end" = the text ends at x), so it isn't cut off.
    const nearRightEdge = point.x > 820;
    const label = make("text", {
      class: "map-label",
      x: nearRightEdge ? point.x - 12 : point.x + 12,
      y: point.y - 8,
      "text-anchor": nearRightEdge ? "end" : "start",
    }, group);
    label.textContent = place.name.toUpperCase();
    const note = make("tspan", { class: "map-note" }, label);
    placeElements[id] = { group, note };
  }

  // Anvil Station, on top of everything else
  const station = make("g", { class: "map-station" }, svg);
  make("rect", { x: STATION.x - 8, y: STATION.y - 8, width: 16, height: 16 }, station);
  const stationLabel = make("text", { class: "map-label map-label-station", x: STATION.x - 30, y: STATION.y - 16 }, station);
  stationLabel.textContent = HOME.name.toUpperCase();
  const docked = make("tspan", { class: "map-note" }, stationLabel);

  return { places: placeElements, routes, docked };
}

// The points of a small diamond around a centre, for Last Post
function diamond(centre, size) {
  const { x, y } = centre;
  return `${x},${y - size} ${x + size},${y} ${x},${y + size} ${x - size},${y}`;
}


// -------------------------------------------------------------
// updatePlaces(state, view)
// Shows, hides or dims each place as the game opens it:
//   belts and the Ice moon: dimmed with "locked" until you can mine them
//   the wreck, the relay and the system edge: hidden until a
//   scout can survey them (they're discoveries)
// -------------------------------------------------------------
function updatePlaces(state, view) {
  const show = (id, visible, locked, note) => {
    const { group, note: noteElement } = view.places[id];
    group.classList.toggle("is-hidden", !visible);
    group.classList.toggle("is-locked", locked);
    if (noteElement.textContent !== note) noteElement.textContent = note;
  };

  show("inner_belt", true, false, "");
  show("outer_belt", true, !isFieldUnlocked(state, "outer_belt"), isFieldUnlocked(state, "outer_belt") ? "" : " · LOCKED");
  const iceOpen = isFieldUnlocked(state, "ice_moon");
  show("ice_moon", true, !iceOpen, iceOpen ? " · SMALL HULLS" : " · UNSURVEYED");
  // The deep core shows from the start, so players see something big
  // to aim for, and says which hulls can work it.
  const coreOpen = isFieldUnlocked(state, "deep_core");
  show("deep_core", true, !coreOpen, coreOpen ? " · LARGE HULLS" : ` · MINING ${FIELDS.deep_core.unlockLevel}`);
  show("hub", true, false, "");

  // A discovery shows once a scout could go there, or has been.
  const found = (targetId) => getTargetStatus(state, targetId) !== "locked";
  // The wreck: which stage is next
  const stages = ["wreck_1", "wreck_2", "wreck_3", "wreck_4"];
  const done = stages.filter((id) => getTargetStatus(state, id) === "surveyed").length;
  show("wreck", found("wreck_1"), false, done === stages.length ? " · SURVEYED" : ` · STAGE ${done + 1} OF ${stages.length}`);
  show("silent_relay", found("silent_relay"), false, "");
  show("system_edge", found("system_edge"), false, "");
  show("deep_scan", false, false, "");     // only a label while a scout is there (see below)
}


// -------------------------------------------------------------
// setupSystemMap(getState, onShipClick)
// Starts the map. Called once by main.js.
//   getState    a function that gives back the current game
//               (main.js swaps in a new one on import or reset)
//   onShipClick called with a ship's id when it's tapped
// -------------------------------------------------------------
export function setupSystemMap(getState, onShipClick) {
  const svg = document.getElementById("system-map");
  const screen = document.querySelector('section.screen[data-screen="command"]');
  if (!svg || !screen) return;            // no map on this page

  const places = getPlaces();
  const view = drawBackground(svg, places);
  const shipLayer = make("g", { class: "map-ships" }, svg);
  const shipElements = new Map();          // ship id -> its drawn parts
  const count = document.getElementById("map-count");

  // One drawn ship: a small arrowhead and its name. It's a
  // button: click (or Enter) jumps to the ship's card.
  function drawShip(ship) {
    const group = make("g", { class: "map-ship", tabindex: "0", role: "button" }, shipLayer);
    // An invisible circle round the arrow, much bigger than it, so
    // the ship is easy to tap with a finger.
    make("circle", { class: "map-hit", r: 18 }, group);
    const arrow = make("polygon", { points: "-6,-5 7,0 -6,5" }, group);
    const label = make("text", { class: "map-label map-ship-label", x: 10, y: -8 }, group);
    const route = make("line", { class: "map-route" }, view.routes);
    const go = () => onShipClick(ship.id);
    group.addEventListener("click", go);
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); go(); }
    });
    return { group, arrow, label, route };
  }

  let lastPlacesUpdate = 0;

  // frame(): runs once per screen frame
  function frame() {
    requestAnimationFrame(frame);          // ask for the next frame first
    if (screen.hidden) return;             // not on Command: nothing to draw

    const state = getState();
    const now = gameNow(state);

    // Places change rarely: check them twice a second
    if (performance.now() - lastPlacesUpdate > 500) {
      updatePlaces(state, view);
      lastPlacesUpdate = performance.now();
    }

    let out = 0;
    let atHome = 0;
    let deepScanning = false;
    const seen = new Set();
    for (const ship of state.ships) {
      seen.add(ship.id);
      // Make the ship's drawing the first time we see it
      let drawn = shipElements.get(ship.id);
      if (!drawn) {
        drawn = drawShip(ship);
        shipElements.set(ship.id, drawn);
      }
      const where = whereIs(state, ship, now, places);
      drawn.group.classList.toggle("is-hidden", !where);
      drawn.route.classList.toggle("is-hidden", !where || !where.moving);
      if (!where) { atHome++; continue; }
      out++;

      // Colour by role, name, position and heading
      const role = SHIP_TYPES[ship.type].role;
      drawn.group.setAttribute("class", "map-ship " + (ROLE_CLASS[role] || ""));
      drawn.route.setAttribute("class", "map-route " + (ROLE_CLASS[role] || "") + (where.moving ? "" : " is-hidden"));
      if (drawn.label.textContent !== ship.name.toUpperCase()) drawn.label.textContent = ship.name.toUpperCase();
      drawn.group.setAttribute("transform", `translate(${where.x.toFixed(1)} ${where.y.toFixed(1)})`);
      drawn.arrow.setAttribute("transform", `rotate(${where.heading.toFixed(0)})`);
      drawn.group.setAttribute("aria-label", `${ship.name}, ${where.phase}, ${where.destinationName}`);
      // The dashed line it's flying along
      if (where.moving) {
        drawn.route.setAttribute("x1", STATION.x);
        drawn.route.setAttribute("y1", STATION.y);
        drawn.route.setAttribute("x2", where.destination.x.toFixed(1));
        drawn.route.setAttribute("y2", where.destination.y.toFixed(1));
      }
      if (where.placeId === "deep_scan") deepScanning = true;
    }

    // Ships that were sold: remove their drawings
    for (const [id, drawn] of shipElements) {
      if (!seen.has(id)) {
        drawn.group.remove();
        drawn.route.remove();
        shipElements.delete(id);
      }
    }

    // The deep scan point only shows while a scout is out there
    view.places.deep_scan.group.classList.toggle("is-hidden", !deepScanning);

    // "2 docked" beside the station, and the count in the corner
    const dockedText = atHome > 0 ? ` · ${atHome} DOCKED` : "";
    if (view.docked.textContent !== dockedText) view.docked.textContent = dockedText;
    const countText = `${out} ship${out === 1 ? "" : "s"} out · tap a ship to find its card`;
    if (count && count.textContent !== countText) count.textContent = countText;
  }

  requestAnimationFrame(frame);
}
