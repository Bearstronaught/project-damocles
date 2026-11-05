// =============================================================
// js/art.js
// -------------------------------------------------------------
// SHIP SCHEMATICS: top-down line drawings of each hull.
//
// Each drawing is SVG - a way of describing a picture with
// shapes ("a line from here to here", "a box this big"), which
// the browser draws. They're written as text right here, so
// there are no image files to manage.
//
// Design doc rule ("swappable art"): every picture is looked up
// by NAME (like "hull_prospector"). When proper art exists one
// day, it replaces the entry here and nothing else changes.
//
// Ships face right (the nose is on the right, engines on the
// left). The shapes use CSS classes, styled in style.css:
//   hull    the main outline (cool steel)
//   detail  panel lines and small parts (fainter steel)
//   accent  working parts: drill heads (amber)
//   engine  the drive flame (teal; only shows when flying)
// =============================================================


const SCHEMATICS = {

  // --- Prospector: small, one drill arm, one engine ---
  hull_prospector: `
    <svg viewBox="0 0 140 80" class="schematic" aria-hidden="true">
      <!-- drive flame (shown while busy) -->
      <polygon class="engine" points="14,36 2,40 14,44" />
      <!-- engine block -->
      <rect class="hull" x="14" y="33" width="10" height="14" />
      <!-- main hull: a stretched hexagon -->
      <polygon class="hull" points="24,26 78,22 96,32 96,48 78,58 24,54" />
      <!-- cargo bay, split into two holds -->
      <rect class="detail" x="34" y="32" width="34" height="16" />
      <line class="detail" x1="51" y1="32" x2="51" y2="48" />
      <!-- cockpit window -->
      <rect class="detail" x="82" y="35" width="8" height="10" />
      <!-- drill arm and drill head -->
      <line class="hull" x1="96" y1="40" x2="114" y2="40" />
      <polygon class="accent" points="114,33 128,40 114,47" />
      <!-- small sensor mast -->
      <line class="detail" x1="60" y1="22" x2="60" y2="14" />
      <circle class="detail" cx="60" cy="12" r="2" />
    </svg>`,

  // --- Excavator: wide, twin drill arms, twin engines, ore pods ---
  hull_excavator: `
    <svg viewBox="0 0 140 80" class="schematic" aria-hidden="true">
      <!-- twin drive flames -->
      <polygon class="engine" points="12,25 0,29 12,33" />
      <polygon class="engine" points="12,47 0,51 12,55" />
      <!-- twin engine blocks -->
      <rect class="hull" x="12" y="22" width="10" height="14" />
      <rect class="hull" x="12" y="44" width="10" height="14" />
      <!-- main hull -->
      <polygon class="hull" points="22,16 84,14 100,26 100,54 84,66 22,64" />
      <!-- ore pods bolted to the top and bottom -->
      <rect class="detail" x="30" y="6" width="44" height="8" />
      <rect class="detail" x="30" y="66" width="44" height="8" />
      <!-- cargo bay, four holds -->
      <rect class="detail" x="32" y="26" width="46" height="28" />
      <line class="detail" x1="55" y1="26" x2="55" y2="54" />
      <line class="detail" x1="32" y1="40" x2="78" y2="40" />
      <!-- bridge -->
      <rect class="detail" x="84" y="34" width="10" height="12" />
      <!-- twin drill arms and heads -->
      <line class="hull" x1="100" y1="30" x2="116" y2="30" />
      <line class="hull" x1="100" y1="50" x2="116" y2="50" />
      <polygon class="accent" points="116,24 132,30 116,36" />
      <polygon class="accent" points="116,44 132,50 116,56" />
    </svg>`,

  // --- Deep-core barge (large, 4 Nov): built for open space only.
  //     A long, blocky hull with no wings, three engines, four
  //     armoured ore holds, and one heavy drill train down the
  //     centre line ending in a wide cutting head. Fills more of
  //     the frame than the Excavator, so it reads as the big one. ---
  hull_deep_core_barge: `
    <svg viewBox="0 0 140 80" class="schematic" aria-hidden="true">
      <!-- three drive flames -->
      <polygon class="engine" points="8,19 0,22 8,25" />
      <polygon class="engine" points="8,37 0,40 8,43" />
      <polygon class="engine" points="8,55 0,58 8,61" />
      <!-- three engine blocks on a crossbeam -->
      <rect class="hull" x="8" y="16" width="9" height="12" />
      <rect class="hull" x="8" y="34" width="9" height="12" />
      <rect class="hull" x="8" y="52" width="9" height="12" />
      <line class="detail" x1="17" y1="22" x2="17" y2="58" />
      <!-- main hull: a long armoured block, squared off -->
      <polygon class="hull" points="17,10 86,10 96,18 96,62 86,70 17,70" />
      <!-- four armoured ore holds, two either side of the spine -->
      <rect class="detail" x="24" y="15" width="28" height="20" />
      <rect class="detail" x="56" y="15" width="28" height="20" />
      <rect class="detail" x="24" y="45" width="28" height="20" />
      <rect class="detail" x="56" y="45" width="28" height="20" />
      <!-- the spine between them -->
      <line class="detail" x1="20" y1="40" x2="90" y2="40" />
      <!-- bridge at the bow -->
      <rect class="detail" x="86" y="34" width="7" height="12" />
      <!-- the drill train: a thick shaft and a wide cutting head -->
      <rect class="hull" x="96" y="35" width="20" height="10" />
      <line class="detail" x1="103" y1="35" x2="103" y2="45" />
      <line class="detail" x1="110" y1="35" x2="110" y2="45" />
      <polygon class="accent" points="116,26 124,26 136,40 124,54 116,54" />
    </svg>`,

  // --- Courier: a spine with two rows of cargo pods clamped on
  //     each side, cockpit at the nose, one engine at the back.
  //     (Like the freighter builder: more rows = longer ship.) ---
  hull_courier: `
    <svg viewBox="0 0 140 80" class="schematic" aria-hidden="true">
      <!-- drive flame -->
      <polygon class="engine" points="16,35 2,40 16,45" />
      <!-- engine block -->
      <rect class="hull" x="16" y="30" width="14" height="20" />
      <!-- the spine running down the middle -->
      <rect class="hull" x="30" y="36" width="74" height="8" />
      <!-- cargo pods: two rows, one either side of the spine -->
      <rect class="accent" x="38" y="18" width="26" height="16" />
      <rect class="accent" x="38" y="46" width="26" height="16" />
      <rect class="accent" x="70" y="18" width="26" height="16" />
      <rect class="accent" x="70" y="46" width="26" height="16" />
      <!-- clamp arms holding the pods to the spine -->
      <line class="detail" x1="51" y1="34" x2="51" y2="36" />
      <line class="detail" x1="51" y1="44" x2="51" y2="46" />
      <line class="detail" x1="83" y1="34" x2="83" y2="36" />
      <line class="detail" x1="83" y1="44" x2="83" y2="46" />
      <!-- cockpit at the nose -->
      <polygon class="hull" points="104,32 122,34 130,40 122,46 104,48" />
      <rect class="detail" x="112" y="37" width="8" height="6" />
    </svg>`,

  // --- Hauler: the Courier's layout stretched out. A longer spine
  //     with FOUR rows of cargo pods (two per side of each row),
  //     twin engines at the back for the extra mass, and the same
  //     cockpit at the nose. (Four rows to the Courier's two, as
  //     the roster says: the freighter builder will draw these
  //     row by row once the sprites go in.) ---
  hull_hauler: `
    <svg viewBox="0 0 140 80" class="schematic" aria-hidden="true">
      <!-- twin drive flames -->
      <polygon class="engine" points="12,28 0,32 12,36" />
      <polygon class="engine" points="12,44 0,48 12,52" />
      <!-- twin engine blocks -->
      <rect class="hull" x="12" y="25" width="12" height="14" />
      <rect class="hull" x="12" y="41" width="12" height="14" />
      <!-- the long spine -->
      <rect class="hull" x="24" y="36" width="88" height="8" />
      <!-- cargo pods: four rows, one pod either side of the spine -->
      <rect class="accent" x="28" y="18" width="18" height="16" />
      <rect class="accent" x="28" y="46" width="18" height="16" />
      <rect class="accent" x="49" y="18" width="18" height="16" />
      <rect class="accent" x="49" y="46" width="18" height="16" />
      <rect class="accent" x="70" y="18" width="18" height="16" />
      <rect class="accent" x="70" y="46" width="18" height="16" />
      <rect class="accent" x="91" y="18" width="18" height="16" />
      <rect class="accent" x="91" y="46" width="18" height="16" />
      <!-- clamp arms holding each row of pods to the spine -->
      <line class="detail" x1="37" y1="34" x2="37" y2="36" />
      <line class="detail" x1="37" y1="44" x2="37" y2="46" />
      <line class="detail" x1="58" y1="34" x2="58" y2="36" />
      <line class="detail" x1="58" y1="44" x2="58" y2="46" />
      <line class="detail" x1="79" y1="34" x2="79" y2="36" />
      <line class="detail" x1="79" y1="44" x2="79" y2="46" />
      <line class="detail" x1="100" y1="34" x2="100" y2="36" />
      <line class="detail" x1="100" y1="44" x2="100" y2="46" />
      <!-- cockpit at the nose -->
      <polygon class="hull" points="112,32 126,34 134,40 126,46 112,48" />
      <rect class="detail" x="117" y="37" width="8" height="6" />
    </svg>`,

  // --- Pathfinder: a slim scout. A long narrow hull, two sensor
  //     pods on short booms, and a sensor dome (the "accent": it
  //     pulses while scanning, like a drill while mining). ---
  hull_pathfinder: `
    <svg viewBox="0 0 140 80" class="schematic" aria-hidden="true">
      <!-- drive flame -->
      <polygon class="engine" points="20,37 4,40 20,43" />
      <!-- engine block -->
      <rect class="hull" x="20" y="34" width="10" height="12" />
      <!-- the long, narrow hull, coming to a sharp nose -->
      <polygon class="hull" points="30,32 76,30 112,37 124,40 112,43 76,50 30,48" />
      <!-- cockpit -->
      <rect class="detail" x="96" y="37" width="9" height="6" />
      <!-- sensor pods on short booms, above and below -->
      <line class="detail" x1="58" y1="31" x2="58" y2="22" />
      <line class="detail" x1="58" y1="49" x2="58" y2="58" />
      <rect class="detail" x="46" y="17" width="24" height="5" />
      <rect class="detail" x="46" y="58" width="24" height="5" />
      <!-- the sensor dome on the spine -->
      <circle class="accent" cx="62" cy="40" r="6" />
      <line class="detail" x1="40" y1="40" x2="54" y2="40" />
    </svg>`,
};


// =============================================================
// HARDPOINTS: where each ship component sits on a drawing.
// -------------------------------------------------------------
// One [x, y] point per component, in the drawing's own units
// (every drawing is 140 wide by 80 tall). getShipArt() puts a
// small marker at each one, showing the grade fitted there:
//   dashed ring          stock (nothing fitted)
//   teal ring + I/II/III that Mk fitted
// Like the drawings, these are looked up by art NAME, so new
// art brings its own hardpoints.
// =============================================================
const HARDPOINTS = {
  hull_prospector: {
    drive: [19, 40],      // the engine block
    hold:  [42, 40],      // the cargo bay
    drill: [105, 40],     // the drill arm
  },
  hull_excavator: {
    drive: [17, 40],      // between the twin engines
    hold:  [43, 33],      // the cargo bay
    drill: [108, 40],     // between the twin drill arms
  },
  hull_deep_core_barge: {
    drive: [12, 40],      // the middle engine
    hold:  [54, 25],      // between the upper holds
    drill: [106, 40],     // the drill train
  },
  hull_courier: {
    drive: [23, 40],      // the engine block
    hold:  [67, 40],      // the spine, between the pods
  },
  hull_hauler: {
    drive: [18, 40],      // between the twin engines
    hold:  [68, 40],      // the spine, between the middle pods
  },
  hull_pathfinder: {
    drive:   [25, 40],    // the engine block
    sensors: [62, 40],    // the sensor dome
  },
};

// Roman numerals for the grade inside a marker.
const GRADE_MARKS = { 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V" };


// -------------------------------------------------------------
// getShipArt(artName, grades, labels)
// The drawing with a hardpoint marker on each component.
// "grades" says what's fitted, e.g. { drill: 1, hold: 0, drive: 2 }.
// "labels" (optional) is what hovering each marker shows, as
// [title, detail], e.g. { drill: ["Drill", "Mk I · +15% mining rate"] }.
// "pending" (optional) lists parts bought but not fitted yet
// (the ship is out working), e.g. { drill: 2 }: their marker
// gets an amber ring until the ship docks.
// Parts the hull doesn't have (a freighter's drill) are skipped.
// -------------------------------------------------------------
export function getShipArt(artName, grades, labels = {}, pending = {}) {
  const drawing = getSchematic(artName);
  const points = HARDPOINTS[artName];
  if (!points) {
    return drawing;   // no hardpoints known for this art yet
  }

  let markers = "";
  for (const [partId, [x, y]] of Object.entries(points)) {
    if (!(partId in grades)) continue;
    const grade = grades[partId];
    // The hover text, kept on the marker as data-tip-title and
    // data-tip (ui.js shows them in a tooltip box).
    const [title, detail] = labels[partId] || ["", ""];
    // <g> groups the ring and its label so they move together;
    // "translate" moves the group to the hardpoint.
    markers += `
      <g class="hardpoint ${grade > 0 ? "fitted" : "stock"}${partId in pending ? " pending" : ""}" transform="translate(${x} ${y})"
         data-tip-title="${title}" data-tip="${detail}">
        <circle class="hit" r="11" />
        <circle r="7.5" />
        ${grade > 0 ? `<text y="2.8">${GRADE_MARKS[grade]}</text>` : ""}
      </g>`;
  }
  // Slip the markers in just before the drawing's closing tag,
  // so they're drawn on top of the ship.
  return drawing.replace("</svg>", markers + "\n    </svg>");
}


// -------------------------------------------------------------
// getSchematic(artName)
// Returns the drawing for a name, or a plain placeholder box if
// no drawing exists yet (so a new ship type never breaks the
// screen just because its art isn't ready).
// -------------------------------------------------------------
export function getSchematic(artName) {
  if (SCHEMATICS[artName]) {
    return SCHEMATICS[artName];
  }
  return `
    <svg viewBox="0 0 140 80" class="schematic" aria-hidden="true">
      <rect class="detail" x="30" y="20" width="80" height="40" stroke-dasharray="4 4" />
      <text x="70" y="44" text-anchor="middle" class="art-missing">NO SCHEMATIC</text>
    </svg>`;
}
