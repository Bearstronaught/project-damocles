// =============================================================
// js/trade.js
// -------------------------------------------------------------
// TRADE: turning goods into credits.
//
// For now prices are fixed (from content.js). Later, each
// station will have its own supply and demand (design doc:
// "Markets"), and that logic will live here.
// =============================================================

import { ITEMS } from "../data/content.js";


// -------------------------------------------------------------
// sellAll(state, itemId)
// Sells every unit of one item. Returns the credits earned.
// -------------------------------------------------------------
export function sellAll(state, itemId) {
  const amount = state.inventory[itemId] || 0;   // "|| 0" = treat missing as zero

  // Nothing to sell? Nothing earned.
  if (amount <= 0) {
    return 0;
  }

  const earned = amount * ITEMS[itemId].sellPrice;

  state.inventory[itemId] = 0;   // the goods leave the hold...
  state.credits += earned;       // ...and the money arrives

  return earned;
}


// -------------------------------------------------------------
// sellEverything(state)
// Sells every item in the hold. Returns the total earned.
// -------------------------------------------------------------
export function sellEverything(state) {
  let total = 0;
  for (const itemId of Object.keys(ITEMS)) {
    total += sellAll(state, itemId);
  }
  return total;
}


// -------------------------------------------------------------
// getCargoValue(state)
// What everything in the hold is worth right now.
// -------------------------------------------------------------
export function getCargoValue(state) {
  let total = 0;
  for (const [itemId, item] of Object.entries(ITEMS)) {
    total += (state.inventory[itemId] || 0) * item.sellPrice;
  }
  return total;
}
