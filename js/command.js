// =============================================================
// js/command.js
// -------------------------------------------------------------
// COMMAND CAPACITY: how big a fleet the player can run.
//
// Every ship costs command points by hull size (small 1,
// medium 2 ... set in content.js). The player has a total they
// can't go over, which starts small and grows by buying
// Fleet command upgrades with credits.
//
// The state only stores HOW MANY upgrades were bought
// (state.commandUpgrades). The total is always worked out from
// that, the same way levels are worked out from XP.
// =============================================================

import { COMMAND, HULL_SIZES, SHIP_TYPES } from "../data/content.js";


// -------------------------------------------------------------
// getShipPoints(shipTypeId)
// How many command points one ship of this type uses.
// -------------------------------------------------------------
export function getShipPoints(shipTypeId) {
  const size = SHIP_TYPES[shipTypeId].size;
  return HULL_SIZES[size].commandPoints;
}


// -------------------------------------------------------------
// getCommandCapacity(state)
// The player's total points: the starting amount, plus the
// points from every upgrade bought.
// e.g. 4 + (2 upgrades x 2 points) = 8
// -------------------------------------------------------------
export function getCommandCapacity(state) {
  return COMMAND.startPoints + state.commandUpgrades * COMMAND.pointsPerUpgrade;
}


// -------------------------------------------------------------
// getCommandUsed(state)
// Points used by the whole fleet: each ship's points added up.
// -------------------------------------------------------------
export function getCommandUsed(state) {
  let used = 0;
  for (const ship of state.ships) {
    used += getShipPoints(ship.type);
  }
  return used;
}


// -------------------------------------------------------------
// getCommandFree(state)
// Points left over for new ships.
// -------------------------------------------------------------
export function getCommandFree(state) {
  return getCommandCapacity(state) - getCommandUsed(state);
}


// -------------------------------------------------------------
// getNextUpgradeCost(state)
// Price of the next Fleet command upgrade, or null if the
// player has bought them all.
// Each one costs costMultiplier times the last:
//   upgrade 1: 80,000   upgrade 2: 160,000   upgrade 3: 320,000 ...
// -------------------------------------------------------------
export function getNextUpgradeCost(state) {
  if (state.commandUpgrades >= COMMAND.maxUpgrades) {
    return null;
  }
  // Math.pow(2, n) = 2 multiplied by itself n times (2^0 = 1).
  return COMMAND.firstUpgradeCost * Math.pow(COMMAND.costMultiplier, state.commandUpgrades);
}


// -------------------------------------------------------------
// canBuyUpgrade(state)
// Returns { ok: true } or { ok: false, reason: "..." }
// -------------------------------------------------------------
export function canBuyUpgrade(state) {
  const cost = getNextUpgradeCost(state);
  if (cost === null) {
    return { ok: false, reason: "Fully upgraded" };
  }
  if (state.credits < cost) {
    return { ok: false, reason: "Not enough credits" };
  }
  return { ok: true };
}


// -------------------------------------------------------------
// buyUpgrade(state)
// Pays for one Fleet command upgrade.
// Returns the points gained, or 0 if it couldn't be bought.
// -------------------------------------------------------------
export function buyUpgrade(state) {
  if (!canBuyUpgrade(state).ok) {
    return 0;
  }
  state.credits -= getNextUpgradeCost(state);   // pay first...
  state.commandUpgrades += 1;                   // ...then count it
  return COMMAND.pointsPerUpgrade;
}
