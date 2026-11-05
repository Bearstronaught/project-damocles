// =============================================================
// js/market.js
// -------------------------------------------------------------
// LIVING MARKETS (Dan, 5 Nov).
//
// There are two places to sell, and only one of them is "living":
//
//   ANVIL STATION   The Ledger: Halvorsen-Sato's automated market,
//                   buying at stale Sol prices for owners 80 years
//                   of messages away. It never reacts to a glut, so
//                   it ALWAYS buys anything at its flat home price.
//                   The safety net. (Nothing in this file.)
//
//   LAST POST       A small stranded society. It pays the hub price,
//                   but flood it with one good and that good's price
//                   sags. This file is all about Last Post.
//
// HOW THE PRICE SAGS
// Each item has a GLUT: the tonnes of it sold at Last Post
// recently. The more glut, the lower that item's price there:
//
//   no glut         the full hub price     (iridium bars: 264 cr)
//   half "absorb"   halfway down           (214.5 cr)
//   "absorb" tonnes down to Anvil's price  (165 cr) - and never lower,
//                   so a trip to Last Post never loses money
//
// "Absorb" is how much Last Post can take before the price hits
// Anvil's. It's set in CREDITS on the balance sheet (the same for
// every item), so cheap ore and dear iridium bars both soak up the
// same value. It grows with your reputation with the belt
// independents: their tier's size (x1 Unknown ... x4 Partner) - the
// same numbers that make their contracts bigger.
//
// HOW IT RECOVERS
// Glut halves every MARKET.halfLifeHours. That's one formula, so
// we never have to "tick" the market: each item just remembers its
// glut and WHEN, and the glut at any later time is worked out:
//     glut now = glut then x 0.5 ^ (hours since ÷ half-life)
// That's what keeps offline catch-up exact.
//
// A BIG DELIVERY pays the AVERAGE price across its tonnes, worked
// out as the glut rises during the sale (sellIntoMarket). So one
// 600 t load and six 100 t loads in a row are paid the same.
//
// Trade XP doesn't change: it's still tonnes x distance (trade.js).
//
// What the save holds (state.market.glut):
//   { iron_ore: { tonnes: 1200, at: 1730800000000 }, ... }
// =============================================================

import { ITEMS, MARKET } from "../data/content.js";
import { getTier } from "./contracts.js";

// Last Post belongs to the belt independents (content.js).
const LAST_POST_FACTION = "independents";

const HOUR_MS = 60 * 60 * 1000;


// -------------------------------------------------------------
// getAbsorb(state, itemId)
// How many tonnes of this item Last Post takes before its price is
// down to Anvil's: the absorb credits, times the reputation tier's
// size, divided by the item's full hub price.
//   e.g. absorb 20,000,000 cr, tier x1, iridium bars at 264 cr:
//        20,000,000 ÷ 264 = about 75,800 t
// -------------------------------------------------------------
export function getAbsorb(state, itemId) {
  const size = getTier(state, LAST_POST_FACTION).size;
  return (MARKET.absorbCredits * size) / ITEMS[itemId].hubPrice;
}


// -------------------------------------------------------------
// getGlut(state, itemId, now)
// The tonnes of this item still "weighing on" Last Post at time
// "now", after recovering since the last sale.
// -------------------------------------------------------------
export function getGlut(state, itemId, now) {
  const record = state.market.glut[itemId];
  if (!record) return 0;

  // Hours since the glut was written down. A clock set backwards
  // would make this negative; count that as no time at all.
  const hours = Math.max(0, now - record.at) / HOUR_MS;
  return record.tonnes * 0.5 ** (hours / MARKET.halfLifeHours);
}


// -------------------------------------------------------------
// priceAtGlut(state, itemId, glut)
// Last Post's price for ONE tonne when this much glut is sitting
// there: a straight line from the hub price (no glut) down to
// Anvil's price (glut = absorb), then flat.
// -------------------------------------------------------------
function priceAtGlut(state, itemId, glut) {
  const item = ITEMS[itemId];
  const drop = item.hubPrice - item.sellPrice;               // how far it can fall
  const share = Math.min(1, glut / getAbsorb(state, itemId)); // 0 to 1 of the way down
  return item.hubPrice - drop * share;
}


// -------------------------------------------------------------
// getHubPrice(state, itemId, now)
// What Last Post pays for one tonne right now (before the Trade
// perk). This is the number the cargo tables show.
// -------------------------------------------------------------
export function getHubPrice(state, itemId, now) {
  return priceAtGlut(state, itemId, getGlut(state, itemId, now));
}


// -------------------------------------------------------------
// getPriceShare(state, itemId, now)
// Today's Last Post price as a share of its full price, 0 to 1
// (1 = no glut). For the "−12%" notes on screen.
// -------------------------------------------------------------
export function getPriceShare(state, itemId, now) {
  return getHubPrice(state, itemId, now) / ITEMS[itemId].hubPrice;
}


// -------------------------------------------------------------
// quoteSale(state, itemId, tonnes, now)
// What selling this many tonnes at Last Post right now would pay
// (before the Trade perk), WITHOUT selling anything. It adds up
// the price tonne by tonne as the glut rises - done exactly with
// the area under the price line, not a loop.
// -------------------------------------------------------------
export function quoteSale(state, itemId, tonnes, now) {
  if (tonnes <= 0) return 0;
  const item = ITEMS[itemId];
  const absorb = getAbsorb(state, itemId);
  const start = getGlut(state, itemId, now);   // glut before the first tonne
  const end = start + tonnes;                  // glut after the last

  let credits = 0;

  // 1. The part sold while the glut is still under "absorb": the
  //    price falls in a straight line, so its area is
  //    (tonnes) x (the price halfway through that part).
  if (start < absorb) {
    const sloped = Math.min(end, absorb) - start;          // tonnes on the slope
    const middle = start + sloped / 2;                      // glut halfway through them
    credits += sloped * priceAtGlut(state, itemId, middle);
  }

  // 2. The part sold past "absorb": Anvil's price, flat.
  const flat = end - Math.max(start, absorb);
  if (flat > 0) {
    credits += flat * item.sellPrice;
  }
  return credits;
}


// -------------------------------------------------------------
// sellIntoMarket(state, itemId, tonnes, now)
// Sells at Last Post: works out the pay (quoteSale), then adds the
// tonnes to the glut. Returns the credits (before the Trade perk).
// -------------------------------------------------------------
export function sellIntoMarket(state, itemId, tonnes, now) {
  const credits = quoteSale(state, itemId, tonnes, now);
  state.market.glut[itemId] = {
    tonnes: getGlut(state, itemId, now) + tonnes,
    at: now,
  };
  return credits;
}


// -------------------------------------------------------------
// createMarket()
// An untouched market for a new game: no glut anywhere.
// -------------------------------------------------------------
export function createMarket() {
  return { glut: {} };
}
