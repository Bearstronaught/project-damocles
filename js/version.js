// =============================================================
// js/version.js
// -------------------------------------------------------------
// THE GAME'S VERSION NUMBER, shown at the bottom of the menu.
//
// The numbering works up to 1.0, the full game (Dan, 30 Oct):
//
//     0 . phase . build
//
//   phase  the roadmap phase being built (2 = Industry). A new
//          phase moves this number and resets the build to 0.
//   build  goes up by one with every release in that phase.
//
// Don't change it here by hand. Run
//     node tools/release.js 0.2.1
// which writes the new number here AND stamps it into index.html
// (see that script for why).
// =============================================================

export const VERSION = "0.2.0";
