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
// Sells every unit of an item. Returns the credits earned.
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
