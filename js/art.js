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
};


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
