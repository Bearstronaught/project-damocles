// =============================================================
// js/shipyard.js
// -------------------------------------------------------------
// SHIPYARD: buying new ships.
// =============================================================

import { SHIP_TYPES, SHIP_NAMES } from "../data/content.js";
import { isShipTypeUnlocked } from "./skills.js";


// -------------------------------------------------------------
// canBuyShip(state, shipTypeId)
// Checks whether a ship can be bought right now.
// Returns { ok: true } or { ok: false, reason: "..." } so the
// screen can tell the player WHY not.
// -------------------------------------------------------------
export function canBuyShip(state, shipTypeId) {
  const shipType = SHIP_TYPES[shipTypeId];

  if (shipType.cost === null) {
    return { ok: false, reason: "Not for sale" };
  }
  if (!isShipTypeUnlocked(state, shipTypeId)) {
    return { ok: false, reason: "Locked" };
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
  // goes up, so IDs are never reused (even if ships are sold
  // or lost one day).
  const number = state.nextShipNumber;
  state.nextShipNumber += 1;

  const ship = {
    id: "ship-" + number,
    name: pickShipName(number),
    type: shipTypeId,
  };

  state.ships.push(ship);
  return ship;
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
