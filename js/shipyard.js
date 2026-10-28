// =============================================================
// js/shipyard.js
// -------------------------------------------------------------
// SHIPYARD: buying and selling ships.
// =============================================================

import { SHIP_TYPES, SHIP_NAMES, SELL_RATE } from "../data/content.js";
import { isShipTypeUnlocked } from "./skills.js";
import { getShipPoints, getCommandFree } from "./command.js";
import { findShip } from "./state.js";
import { getJobForShip } from "./jobs.js";


// -------------------------------------------------------------
// canBuyShip(state, shipTypeId)
// Checks whether a ship can be bought right now.
// Returns { ok: true } or { ok: false, reason: "..." } so the
// screen can tell the player WHY not. The checks run in order,
// so the player sees the first thing stopping them.
// -------------------------------------------------------------
export function canBuyShip(state, shipTypeId) {
  const shipType = SHIP_TYPES[shipTypeId];

  if (shipType.cost === null) {
    return { ok: false, reason: "Not for sale" };
  }
  if (!isShipTypeUnlocked(state, shipTypeId)) {
    return { ok: false, reason: "Locked" };
  }
  if (getShipPoints(shipTypeId) > getCommandFree(state)) {
    return { ok: false, reason: "Not enough command points" };
  }
  if (state.credits < shipType.cost) {
    return { ok: false, reason: "Not enough credits" };
  }
  return { ok: true };
}


// -------------------------------------------------------------
// buyShip(state, shipTypeId)
// Pays for a ship and adds it to the fleet.
// Returns the new ship, or null if it couldn't be bought.
// -------------------------------------------------------------
export function buyShip(state, shipTypeId) {
  // Check first - never take money for a ship we can't give.
  if (!canBuyShip(state, shipTypeId).ok) {
    return null;
  }

  state.credits -= SHIP_TYPES[shipTypeId].cost;

  // Every ship gets a unique ID from a counter that only ever
  // goes up, so IDs are never reused (even after a ship is sold).
  const number = state.nextShipNumber;
  state.nextShipNumber += 1;

  const ship = {
    id: "ship-" + number,
    name: pickShipName(number),
    type: shipTypeId,
    destination: "inner_belt",   // where it mines until told otherwise
  };

  state.ships.push(ship);
  return ship;
}


// -------------------------------------------------------------
// getSellValue(shipTypeId)
// What a ship sells for: half its shop price (SELL_RATE), or
// its fixed resale value if the shop doesn't sell it.
// -------------------------------------------------------------
export function getSellValue(shipTypeId) {
  const shipType = SHIP_TYPES[shipTypeId];
  if (shipType.cost === null) {
    return shipType.resale || 0;
  }
  return Math.floor(shipType.cost * SELL_RATE);
}


// -------------------------------------------------------------
// canSellShip(state, shipId)
// A ship can only be sold when it's docked (not mid-trip), and
// never your last one - with no ships you couldn't earn
// anything to start again.
// -------------------------------------------------------------
export function canSellShip(state, shipId) {
  if (!findShip(state, shipId)) {
    return { ok: false, reason: "No such ship" };
  }
  if (state.ships.length <= 1) {
    return { ok: false, reason: "Last ship" };
  }
  if (getJobForShip(state, shipId)) {
    return { ok: false, reason: "Ship is busy" };
  }
  return { ok: true };
}


// -------------------------------------------------------------
// sellShip(state, shipId)
// Sells a ship: removes it from the fleet and pays out.
// Returns the credits earned, or 0 if it couldn't be sold.
// -------------------------------------------------------------
export function sellShip(state, shipId) {
  if (!canSellShip(state, shipId).ok) {
    return 0;
  }
  const ship = findShip(state, shipId);
  const value = getSellValue(ship.type);

  // Keep every ship EXCEPT this one.
  state.ships = state.ships.filter((s) => s.id !== shipId);
  state.credits += value;
  return value;
}


// -------------------------------------------------------------
// pickShipName(number)
// Ship 2 gets the first name in SHIP_NAMES, ship 3 the second,
// and so on. After the list runs out: "Barge 8", "Barge 9"...
// -------------------------------------------------------------
function pickShipName(number) {
  const index = number - 2;   // ship-1 is the starting ship
  if (index >= 0 && index < SHIP_NAMES.length) {
    return SHIP_NAMES[index];
  }
  return "Barge " + number;
}
