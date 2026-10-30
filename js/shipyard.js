// =============================================================
// js/shipyard.js
// -------------------------------------------------------------
// SHIPYARD: buying and selling ships.
// =============================================================

import { SHIP_TYPES, SHIP_NAMES, SELL_RATE, SHIP_PRICE_GROWTH } from "../data/content.js";
import { isShipTypeUnlocked } from "./skills.js";
import { getShipPoints, getCommandFree } from "./command.js";
import { findShip } from "./state.js";
import { getJobForShip } from "./jobs.js";
import { getCharter } from "./contracts.js";


// -------------------------------------------------------------
// countOwned(state, shipTypeId)
// How many ships of this type are in the fleet right now.
// -------------------------------------------------------------
export function countOwned(state, shipTypeId) {
  return state.ships.filter((ship) => ship.type === shipTypeId).length;
}


// -------------------------------------------------------------
// getPriceWithOwned(shipTypeId, owned)
// The price of a ship of this type when you already own "owned"
// of them. The base cost (the price when you own none) grows by
// SHIP_PRICE_GROWTH for each one you own:
//     owned 0: base          5,000
//     owned 1: base x 1.6    8,000
//     owned 2: base x 1.6²  12,800   ...and so on.
// Rounded to whole credits. Returns null if the shop doesn't
// sell this type at all.
// -------------------------------------------------------------
export function getPriceWithOwned(shipTypeId, owned) {
  const shipType = SHIP_TYPES[shipTypeId];
  if (shipType.cost === null) {
    return null;
  }
  // ** means "to the power of": 1.6 ** 2 = 1.6 x 1.6 = 2.56
  return Math.round(shipType.cost * SHIP_PRICE_GROWTH ** owned);
}


// -------------------------------------------------------------
// getShipPrice(state, shipTypeId)
// What the NEXT ship of this type costs for this player.
// -------------------------------------------------------------
export function getShipPrice(state, shipTypeId) {
  return getPriceWithOwned(shipTypeId, countOwned(state, shipTypeId));
}


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
  if (state.credits < getShipPrice(state, shipTypeId)) {
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

  // Pay the price BEFORE adding the ship, so the price is worked
  // out from the fleet as it was when the player clicked Buy.
  state.credits -= getShipPrice(state, shipTypeId);

  // Every ship gets a unique ID from a counter that only ever
  // goes up, so IDs are never reused (even after a ship is sold).
  const number = state.nextShipNumber;
  state.nextShipNumber += 1;

  const ship = {
    id: "ship-" + number,
    name: pickShipName(number),
    type: shipTypeId,
  };

  // What the ship does until told otherwise, by its role:
  if (SHIP_TYPES[shipTypeId].role === "freight") {
    ship.haulMode = "full";              // wait for a full hold
  } else {
    ship.destination = "inner_belt";     // mine the nearest field
  }

  state.ships.push(ship);
  return ship;
}


// -------------------------------------------------------------
// getSellValue(state, shipTypeId)
// What one ship of this type sells for right now: half
// (SELL_RATE) of what it would cost to buy it back. Buying it
// back means owning one fewer, so that's the price at owned - 1.
// This way buying a ship and selling it straight away always
// loses half the money, however many you own.
// A type the shop doesn't sell uses its fixed resale value.
// -------------------------------------------------------------
export function getSellValue(state, shipTypeId) {
  const shipType = SHIP_TYPES[shipTypeId];
  if (shipType.cost === null) {
    return shipType.resale || 0;
  }
  const owned = countOwned(state, shipTypeId);
  const buyBackPrice = getPriceWithOwned(shipTypeId, Math.max(owned - 1, 0));
  return Math.floor(buyBackPrice * SELL_RATE);
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
  // Lent out on a charter: finish or discard the contract first.
  if (getCharter(state, shipId)) {
    return { ok: false, reason: "On a charter" };
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
  // Work out the value BEFORE removing the ship (it depends on
  // how many of this type are in the fleet).
  const value = getSellValue(state, ship.type);

  // Keep every ship EXCEPT this one.
  state.ships = state.ships.filter((s) => s.id !== shipId);
  state.credits += value;
  return value;
}


// -------------------------------------------------------------
// RENAMING SHIPS
// -------------------------------------------------------------

// The longest name allowed, so names fit on the ship cards.
export const MAX_NAME_LENGTH = 24;

// -------------------------------------------------------------
// renameShip(state, shipId, newName)
// Gives a ship a new name. Returns { ok: true, oldName, name }
// or { ok: false, reason: "..." } so the screen can say why not.
// -------------------------------------------------------------
export function renameShip(state, shipId, newName) {
  const ship = findShip(state, shipId);
  if (!ship) {
    return { ok: false, reason: "No such ship." };
  }

  const name = tidyName(newName);

  if (name === "") {
    return { ok: false, reason: "Give the ship a name." };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, reason: `Names can be up to ${MAX_NAME_LENGTH} characters.` };
  }

  // No two ships with the same name (ignoring capitals), so the
  // log never leaves you wondering which "Lucky Strike" docked.
  const taken = state.ships.some(
    (other) => other.id !== shipId && other.name.toLowerCase() === name.toLowerCase()
  );
  if (taken) {
    return { ok: false, reason: "Another ship already has that name." };
  }

  const oldName = ship.name;
  ship.name = name;
  return { ok: true, oldName: oldName, name: name };
}

// -------------------------------------------------------------
// tidyName(text)
// Removes spaces from the ends, and squashes runs of spaces
// (or tabs, or line breaks) in the middle down to one space:
//   "  Lucky    Strike  " -> "Lucky Strike"
// -------------------------------------------------------------
function tidyName(text) {
  // \s+ means "one or more spaces of any kind"; g means "everywhere"
  return (text || "").replace(/\s+/g, " ").trim();
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
