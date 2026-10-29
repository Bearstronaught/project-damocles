// =============================================================
// js/bonded.js
// -------------------------------------------------------------
// BONDED STOCK: goods the player sets aside so they're never sold.
//
// "Bonded" is a real shipping term: goods held in a warehouse
// that aren't released for sale. Here, each item in the home
// hold can have a BOND amount, e.g. "bond 100 t of hull plating".
//
//   Freighters and the Sell buttons only take stock ABOVE the
//   bond. They never sell it.
//   The refinery and workshop can still use ALL of it - keeping
//   goods for them is the whole point.
//
// It's a RULE, not a second hold: nothing is moved anywhere, so
// it works the same while the game is closed.
//
// A bond can be more than you have right now. "Bond 100 t" with
// only 40 t in the hold means "keep all 40, and keep the next
// 60 t that arrive too".
//
// Bonds are stored in the save as amounts in tonnes:
//   state.bonded = { hull_plating: 100, iron_bar: 60 }
// An item with no entry has no bond (0 t).
// =============================================================

import { ITEMS } from "../data/content.js";


// -------------------------------------------------------------
// getBond(state, itemId)
// How many tonnes of this item are bonded (0 if none).
// -------------------------------------------------------------
export function getBond(state, itemId) {
  return state.bonded[itemId] || 0;
}

// -------------------------------------------------------------
// getSellable(state, itemId)
// How much of an item can be sold or hauled away: whatever is
// in the hold above its bond. Never below 0.
//   200 t in the hold, bond 100 t  ->  100 t sellable
//    40 t in the hold, bond 100 t  ->    0 t sellable
// -------------------------------------------------------------
export function getSellable(state, itemId) {
  const inHold = state.inventory[itemId] || 0;
  return Math.max(0, inHold - getBond(state, itemId));
}

// -------------------------------------------------------------
// getBondedInHold(state, itemId)
// How much of what's in the hold right now is held back by the
// bond: the smaller of the stock and the bond.
//    200 t in the hold, bond 100 t  ->  100 t bonded
//     40 t in the hold, bond 100 t  ->   40 t bonded
// (For the screen: "120 t (100 bonded)".)
// -------------------------------------------------------------
export function getBondedInHold(state, itemId) {
  const inHold = state.inventory[itemId] || 0;
  return Math.min(inHold, getBond(state, itemId));
}

// -------------------------------------------------------------
// setBond(state, itemId, tonnes)
// Sets an item's bond. 0 releases it.
// Returns { ok: true } or { ok: false, reason } for the screen.
// -------------------------------------------------------------
export function setBond(state, itemId, tonnes) {
  if (!ITEMS[itemId]) {
    return { ok: false, reason: "There's no such item." };
  }
  // Whole tonnes from 0 upwards ("Number.isInteger" rules out
  // 2.5, text and blanks).
  if (!Number.isInteger(tonnes) || tonnes < 0) {
    return { ok: false, reason: "A bond is a whole number of tonnes, 0 or more." };
  }

  if (tonnes === 0) {
    delete state.bonded[itemId];   // released: no entry at all
  } else {
    state.bonded[itemId] = tonnes;
  }
  return { ok: true };
}
