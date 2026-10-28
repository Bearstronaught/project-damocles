// =============================================================
// js/trade.js
// -------------------------------------------------------------
// TRADE: turning goods into credits, and earning Trade XP.
//
// There are two places to sell:
//   HOME DOCK     instant, at each item's sellPrice
//   MERCHANT HUB  better prices (hubPrice), but a freighter has
//                 to fly the goods there. Each unit delivered
//                 also earns bonus Trade XP for the trip.
//
// Every sale, anywhere, earns Trade XP based on the credits it
// made (TRADE.creditsPerXp in content.js).
//
// Later, each station will have its own supply and demand
// (design doc: "Markets"), and that logic will live here too.
// =============================================================

import { ITEMS, TRADE } from "../data/content.js";
import { addXp } from "./skills.js";


// -------------------------------------------------------------
// getPrice(itemId, market)
// What one unit sells for. market is "home" or "hub".
// -------------------------------------------------------------
export function getPrice(itemId, market) {
  const item = ITEMS[itemId];
  if (market === "hub") {
    return item.hubPrice;
  }
  return item.sellPrice;
}


// -------------------------------------------------------------
// getTradeXp(credits, unitsDeliveredToHub)
// How much Trade XP a sale is worth:
//   1 XP per 10 credits earned (from TRADE.creditsPerXp)
//   + 1 bonus XP per unit delivered to the hub
// e.g. 60 cr at home         -> 6 XP
//      480 cr for 60 units at the hub -> 48 + 60 = 108 XP
// -------------------------------------------------------------
export function getTradeXp(credits, unitsDeliveredToHub = 0) {
  const saleXp = credits / TRADE.creditsPerXp;
  const bonusXp = unitsDeliveredToHub * TRADE.hubBonusXpPerUnit;
  return saleXp + bonusXp;
}


// -------------------------------------------------------------
// sellAll(state, itemId)
// Sells every unit of one item at the HOME dock.
// Returns what happened, so the screen can report it:
//   { credits: 60, xp: 6, newLevels: [] }
// -------------------------------------------------------------
export function sellAll(state, itemId) {
  const amount = state.inventory[itemId] || 0;   // "|| 0" = treat missing as zero

  // Nothing to sell? Nothing earned.
  if (amount <= 0) {
    return { credits: 0, xp: 0, newLevels: [] };
  }

  const earned = amount * getPrice(itemId, "home");

  state.inventory[itemId] = 0;   // the goods leave the hold...
  state.credits += earned;       // ...and the money arrives

  // Selling earns Trade XP. addXp tells us about any level-ups.
  const xp = getTradeXp(earned);
  const newLevels = addXp(state, "trade", xp);

  return { credits: earned, xp: xp, newLevels: newLevels };
}


// -------------------------------------------------------------
// sellEverything(state)
// Sells every item in the hold at the HOME dock.
// Returns the totals: { credits, xp, newLevels }.
// -------------------------------------------------------------
export function sellEverything(state) {
  const total = { credits: 0, xp: 0, newLevels: [] };

  for (const itemId of Object.keys(ITEMS)) {
    const sale = sellAll(state, itemId);
    total.credits += sale.credits;
    total.xp += sale.xp;
    // "..." spreads one list into another: [2] + [3] -> [2, 3]
    total.newLevels.push(...sale.newLevels);
  }
  return total;
}


// -------------------------------------------------------------
// sellAtHub(state, cargo)
// Sells a freighter's cargo at the MERCHANT HUB.
// cargo lists what the ship carried, e.g.
//   { iron_ore: 40, nickel_ore: 20 }
// The goods have already left the home hold when the ship was
// loaded, so this only pays out - it doesn't touch the hold.
// Returns { credits, xp, units, newLevels }.
// -------------------------------------------------------------
export function sellAtHub(state, cargo) {
  let credits = 0;
  let units = 0;

  // Object.entries gives pairs: ["iron_ore", 40]
  for (const [itemId, amount] of Object.entries(cargo)) {
    credits += amount * getPrice(itemId, "hub");
    units += amount;
  }

  state.credits += credits;

  // Sale XP plus the bonus for every unit hauled there.
  const xp = getTradeXp(credits, units);
  const newLevels = addXp(state, "trade", xp);

  return { credits: credits, xp: xp, units: units, newLevels: newLevels };
}


// -------------------------------------------------------------
// getCargoValue(state, market)
// What everything in the home hold is worth at one market
// ("home" by default, or "hub").
// -------------------------------------------------------------
export function getCargoValue(state, market = "home") {
  let total = 0;
  for (const itemId of Object.keys(ITEMS)) {
    total += (state.inventory[itemId] || 0) * getPrice(itemId, market);
  }
  return total;
}
