// =============================================================
// js/trade.js
// -------------------------------------------------------------
// TRADE: turning goods into credits, and earning Trade XP.
//
// There are two places to sell:
//   HOME DOCK     instant, at each item's sellPrice
//   MERCHANT HUB  better prices (hubPrice), but a freighter has
//                 to fly the goods there.
//
// Trade XP comes only from freighters: tonnes delivered x the
// distance flown (TRADE.tonneMinutesPerXp in content.js).
// Selling at the home dock earns credits but no Trade XP.
//
// Later, each station will have its own supply and demand
// (design doc: "Markets"), and that logic will live here too.
// =============================================================

import { ITEMS, TRADE, HUB } from "../data/content.js";
import { addXp, getTradeHubPerk } from "./skills.js";
import { getSellable } from "./bonded.js";


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
// getTradeXp(tonnes, travelSeconds)
// Full Trade XP for delivering this many tonnes to a market
// this far away (one-way flight seconds at drive speed 1.00x):
//   tonnes x minutes of distance / TRADE.tonneMinutesPerXp
// e.g. 600 t to the hub, 180 s (3 minutes) away:
//   600 x 3 / 15 = 120 XP
// The cargo's value doesn't matter: iron or steel, same XP.
// -------------------------------------------------------------
export function getTradeXp(tonnes, travelSeconds) {
  const minutes = travelSeconds / 60;
  return (tonnes * minutes) / TRADE.tonneMinutesPerXp;
}


// -------------------------------------------------------------
// sellAll(state, itemId)
// Sells all of one item at the HOME dock - except any BONDED
// stock, which stays in the hold (see bonded.js). No Trade XP
// here: that comes from freighters (Dan, 29 Oct).
// Returns what happened, so the screen can report it:
//   { credits: 600, xp: 0, newLevels: [] }
// -------------------------------------------------------------
export function sellAll(state, itemId) {
  const amount = getSellable(state, itemId);   // what's above the bond

  // Nothing to sell? Nothing earned.
  if (amount <= 0) {
    return { credits: 0, xp: 0, newLevels: [] };
  }

  const earned = amount * getPrice(itemId, "home");

  state.inventory[itemId] -= amount;   // the goods leave the hold (the bond stays)...
  state.credits += earned;       // ...and the money arrives

  // The first sale ever unlocks the Pathfinder and the Exploration
  // tab (design doc, Early exploration). Written straight onto the
  // state, so there's nothing to import here.
  state.milestones.firstSale = true;

  return { credits: earned, xp: 0, newLevels: [] };
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
// sellAtHub(state, cargo, xpShare)
// Sells a freighter's cargo at the MERCHANT HUB.
// cargo lists what the ship carried, e.g.
//   { iron_ore: 400, nickel_ore: 200 }   (tonnes)
// xpShare is this freighter's share of its Trade XP when other
// freighters are flying too (1 = all of it; see jobs.js).
// The goods have already left the home hold when the ship was
// loaded, so this only pays out - it doesn't touch the hold.
// The Trade level perk adds to the whole sale: at Trade 10
// (+4.5%), a 4,800 cr cargo pays 5,016 cr. It uses the level
// BEFORE this sale's XP is added.
// Returns { credits, xp, tonnes, newLevels }.
// -------------------------------------------------------------
export function sellAtHub(state, cargo, xpShare = 1) {
  let value = 0;
  let tonnes = 0;

  // Object.entries gives pairs: ["iron_ore", 40]
  for (const [itemId, amount] of Object.entries(cargo)) {
    value += amount * getPrice(itemId, "hub");
    tonnes += amount;
  }

  // Add the Trade perk, rounded to whole credits.
  const credits = Math.round(value * (1 + getTradeHubPerk(state)));

  state.credits += credits;
  state.milestones.firstSale = true;   // (see sellAll)

  // Trade XP for the haul: tonnes x distance, times the share.
  const xp = getTradeXp(tonnes, HUB.travelSeconds) * xpShare;
  const newLevels = addXp(state, "trade", xp);

  return { credits: credits, xp: xp, tonnes: tonnes, newLevels: newLevels };
}


// -------------------------------------------------------------
// getCargoValue(state, market)
// What everything in the home hold that can be SOLD is worth at
// one market ("home" by default, or "hub"). Bonded stock isn't
// for sale, so it isn't counted.
// -------------------------------------------------------------
export function getCargoValue(state, market = "home") {
  let total = 0;
  for (const itemId of Object.keys(ITEMS)) {
    total += getSellable(state, itemId) * getPrice(itemId, market);
  }
  return total;
}
