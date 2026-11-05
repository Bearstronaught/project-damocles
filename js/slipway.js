// =============================================================
// js/slipway.js
// -------------------------------------------------------------
// SLIPWAYS: where new hulls are built (Dan, 4 and 5 Nov).
//
// Ships no longer appear the moment you pay. You place an ORDER,
// and the hull is built on a berth at Anvil Station over a set
// time (from HULL_SIZES in content.js):
//     small    about 2 minutes
//     medium   about 20 minutes
//     large    about 3 hours
//     capital  about a day
//
// There are two berths at Anvil:
//
//   SLIPWAY        small and medium hulls. Open from the start.
//   HEAVY SLIPWAY  large hulls. An upgrade, from Mining 30
//                  (heavy_slipway in UPGRADES). It's a separate
//                  berth, so a 3-hour barge never holds up a
//                  2-minute Prospector or Courier.
//
// Capital hulls can't be built at Anvil at all: they need a
// shipyard station (Expansion phase). Until then, getBerthFor
// says null for them.
//
// Each berth builds ONE hull at a time. Further orders for that
// berth wait in a queue and start, in order, the moment the one
// ahead is finished.
//
// THE RULES (Dan, 5 Nov):
//   - An order is paid in full when it's placed.
//   - It holds its command points from that moment (command.js
//     counts orders), so the cap can't be overbooked.
//   - Prices count ships on order (shipyard.js), so queueing three
//     Prospectors costs the same as buying them one at a time.
//   - Cancelling refunds everything paid, whether the order is
//     still queued or half built.
//   - There's no "rush" button.
//
// HOW IT FITS THE SIMULATION ENGINE
// An order that is being built has a startedAt time, just like a
// ship's job, and finishes at startedAt + durationMs. jobs.js asks
// getNextBuildEvent() for the earliest one due, and finishBuild()
// makes it happen. So builds finish offline exactly as they would
// while you watch - the same rule as everything else.
//
// An order looks like this (in state.builds):
//   {
//     id: "order-3",            unique, never reused
//     type: "excavator",        what's being built
//     berth: "slipway",         which berth builds it
//     paid: { credits: 60000, goods: {} },   refunded on cancel
//     durationMs: 1200000,      how long the build takes
//     startedAt: 1730800000000  when building began, or null
//   }                           while it waits in the queue
// =============================================================

import { SHIP_TYPES, HULL_SIZES, SHIP_NAMES } from "../data/content.js";
import { isOwned } from "./upgrades.js";
import { getFirstFieldFor } from "./skills.js";


// -------------------------------------------------------------
// BERTHS: Anvil Station's building berths, in screen order.
//   name     what the player reads
//   sizes    the hull sizes it can build
//   upgrade  an upgrade that must be owned first (null = open
//            from the start)
// -------------------------------------------------------------
export const BERTHS = {
  slipway: { name: "Slipway", sizes: ["small", "medium"], upgrade: null },
  heavy: { name: "Heavy slipway", sizes: ["large"], upgrade: "heavy_slipway" },
};


// -------------------------------------------------------------
// getBerthFor(shipTypeId)
// Which berth builds this hull, or null if no berth at Anvil can
// (capital hulls).
// -------------------------------------------------------------
export function getBerthFor(shipTypeId) {
  const size = SHIP_TYPES[shipTypeId].size;
  for (const [berthId, berth] of Object.entries(BERTHS)) {
    if (berth.sizes.includes(size)) {
      return berthId;
    }
  }
  return null;
}


// -------------------------------------------------------------
// isBerthOpen(state, berthId)
// True if the player can use this berth: it needs no upgrade,
// or its upgrade is owned.
// -------------------------------------------------------------
export function isBerthOpen(state, berthId) {
  const berth = BERTHS[berthId];
  return berth.upgrade === null || isOwned(state, berth.upgrade);
}


// -------------------------------------------------------------
// getBuildMs(shipTypeId)
// How long one hull of this type takes to build, in ms.
// -------------------------------------------------------------
export function getBuildMs(shipTypeId) {
  const size = SHIP_TYPES[shipTypeId].size;
  return HULL_SIZES[size].buildSeconds * 1000;
}


// -------------------------------------------------------------
// getOrders(state, berthId)
// Every order for one berth, in the order they'll be built: the
// one building now (if any) first, then the queue.
// -------------------------------------------------------------
export function getOrders(state, berthId) {
  return state.builds.filter((order) => order.berth === berthId);
}


// -------------------------------------------------------------
// getBuilding(state, berthId)
// The order being built on this berth right now, or null.
// -------------------------------------------------------------
export function getBuilding(state, berthId) {
  return getOrders(state, berthId).find((order) => order.startedAt !== null) || null;
}


// -------------------------------------------------------------
// countOrdered(state, shipTypeId)
// How many ships of this type are on order (queued or building).
// -------------------------------------------------------------
export function countOrdered(state, shipTypeId) {
  return state.builds.filter((order) => order.type === shipTypeId).length;
}


// -------------------------------------------------------------
// getTimeUntilReady(state, orderId, now)
// How long, in ms, until this order's hull is finished: what's
// left of the build ahead of it, plus every queued build ahead of
// it, plus its own build. Used for "ready in 24m" on the screen.
// -------------------------------------------------------------
export function getTimeUntilReady(state, orderId, now) {
  const order = state.builds.find((o) => o.id === orderId);
  if (!order) return 0;

  let total = 0;
  for (const other of getOrders(state, order.berth)) {
    if (other.startedAt !== null) {
      // The one being built: only what's left of it counts.
      total += Math.max(0, other.startedAt + other.durationMs - now);
    } else {
      total += other.durationMs;
    }
    if (other === order) break;   // stop once we reach this order
  }
  return total;
}


// -------------------------------------------------------------
// getQueueWaitMs(state, berthId, now)
// How long a NEW order on this berth would wait before building
// starts (0 if the berth is free). Used for the Build button's note.
// -------------------------------------------------------------
export function getQueueWaitMs(state, berthId, now) {
  let total = 0;
  for (const order of getOrders(state, berthId)) {
    if (order.startedAt !== null) {
      total += Math.max(0, order.startedAt + order.durationMs - now);
    } else {
      total += order.durationMs;
    }
  }
  return total;
}


// -------------------------------------------------------------
// getBuildProgressOf(order, now)
// How far along a build is, 0 to 1 (0 while it's still queued).
// -------------------------------------------------------------
export function getBuildProgressOf(order, now) {
  if (order.startedAt === null) return 0;
  const done = (now - order.startedAt) / order.durationMs;
  return Math.max(0, Math.min(1, done));
}


// -------------------------------------------------------------
// placeOrder(state, shipTypeId, paid, now)
// Adds an order to its berth's queue. shipyard.js has already
// checked it can be built and taken the payment; "paid" records
// what was taken, so a cancel can give it all back.
// Returns the new order.
// -------------------------------------------------------------
export function placeOrder(state, shipTypeId, paid, now) {
  const order = {
    id: "order-" + state.nextOrderNumber,
    type: shipTypeId,
    berth: getBerthFor(shipTypeId),
    paid: paid,
    durationMs: getBuildMs(shipTypeId),
    startedAt: null,
  };
  state.nextOrderNumber += 1;
  state.builds.push(order);

  // An empty berth starts on it straight away.
  startNextBuild(state, order.berth, now);
  return order;
}


// -------------------------------------------------------------
// startNextBuild(state, berthId, time)
// If this berth isn't building anything, starts the first order
// in its queue at "time". Does nothing if it's busy or empty.
// -------------------------------------------------------------
export function startNextBuild(state, berthId, time) {
  if (getBuilding(state, berthId)) {
    return;   // busy: the queue waits its turn
  }
  const next = getOrders(state, berthId)[0];
  if (next) {
    next.startedAt = time;
  }
}


// -------------------------------------------------------------
// cancelBuild(state, orderId, now)
// Takes an order off the slipway and refunds everything it paid
// (Dan, 5 Nov: full refund, queued or mid-build). If it was being
// built, the next order in the queue starts now.
// Returns the cancelled order, or null if there was no such order.
// -------------------------------------------------------------
export function cancelBuild(state, orderId, now) {
  const order = state.builds.find((o) => o.id === orderId);
  if (!order) {
    return null;
  }

  // Give back exactly what was paid.
  state.credits += order.paid.credits;
  for (const [itemId, tonnes] of Object.entries(order.paid.goods)) {
    state.inventory[itemId] = (state.inventory[itemId] || 0) + tonnes;
  }

  // Remove it, and let the berth move on to the next one.
  state.builds = state.builds.filter((o) => o !== order);
  startNextBuild(state, order.berth, now);
  return order;
}


// -------------------------------------------------------------
// getNextBuildEvent(state, now)
// The earliest build due to finish at or before "now", as
// { order, time }, or null if none is due yet. jobs.js calls this
// alongside the ships' own events.
// -------------------------------------------------------------
export function getNextBuildEvent(state, now) {
  let best = null;
  for (const order of state.builds) {
    if (order.startedAt === null) continue;   // still queued
    const time = order.startedAt + order.durationMs;
    if (time <= now && (best === null || time < best.time)) {
      best = { order, time };
    }
  }
  return best;
}


// -------------------------------------------------------------
// finishBuild(state, order, time)
// A build is done: the hull joins the fleet, docked at Anvil and
// awaiting orders, and the berth starts on the next one in its
// queue at the same moment (no time lost between builds).
// Returns a result for the log, like the other events in jobs.js.
// -------------------------------------------------------------
export function finishBuild(state, order, time) {
  state.builds = state.builds.filter((o) => o !== order);
  const ship = launchShip(state, order.type);
  startNextBuild(state, order.berth, time);

  return {
    kind: "built",
    shipId: ship.id,
    typeId: order.type,
    trips: 1,
    xpGained: 0,
    newLevels: [],
  };
}


// -------------------------------------------------------------
// launchShip(state, shipTypeId)
// Adds a finished hull to the fleet. No payment here: that was
// taken when the order was placed (or by buyShipInstantly in the
// tests). Returns the new ship.
// -------------------------------------------------------------
export function launchShip(state, shipTypeId) {
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
  } else if (SHIP_TYPES[shipTypeId].role === "mining") {
    // A barge heads for the first open field its hull can work:
    // the Inner Belt for most, the deep core for a Deep-core barge
    // (it can't work the belts at all).
    ship.destination = getFirstFieldFor(state, shipTypeId);
  } else {
    ship.destination = "inner_belt";     // scouts: replaced when they pick a target
  }

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
