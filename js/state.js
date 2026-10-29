// =============================================================
// js/state.js
// -------------------------------------------------------------
// GAME STATE: everything the player OWNS or has DONE.
//
// Think of "state" as the save file in memory. Credits, cargo,
// ships and running jobs all live in one plain object. Every
// other file reads or changes this one object, and save.js
// writes it to the browser so it survives closing the tab.
// =============================================================


// The version number of the save format.
// If we ever change the shape of the state (rename something,
// add a new section), we bump this number. save.js then knows
// an old save needs upgrading before it's used.
//   Version 1: credits, cargo, ships, jobs
//   Version 2: added skills (XP) and a ship-number counter
//   Version 3: trips have three phases, timed by ship stats
//   Version 4: command upgrades, and each ship has a destination
//   Version 5: added the Trade skill
//   Version 6: cargo in tonnes - all amounts and credits x10
//   Version 7: added the Refining skill (and refinery jobs)
//   Version 8: one simulation clock (simulatedUpTo, simulatedMs)
//   Version 9: added the Manufacturing skill (and workshop jobs)
//   Version 10: bonded stock (goods set aside, never sold)
//   Version 11: refinery and workshop upgrades, and part-tonnes
export const SAVE_VERSION = 11;


// -------------------------------------------------------------
// createNewGame()
// Builds the starting state for a brand new player.
// -------------------------------------------------------------
export function createNewGame() {
  return {
    version: SAVE_VERSION,

    // Money is shared across the whole empire (design doc:
    // "one shared credit pool").
    credits: 0,

    // What's in storage, in tonnes, by item ID from content.js.
    inventory: {
      iron_ore: 0,
      nickel_ore: 0,
      iron_bar: 0,
      nickel_bar: 0,
      steel: 0,
      hull_plating: 0,
      wiring_coils: 0,
      structural_frames: 0,
      cargo_pod: 0,
      thruster_assembly: 0,
    },

    // The player's fleet. Each ship has its own unique ID
    // ("ship-1"), a "type" that points at SHIP_TYPES, and a
    // "destination": the field it mines when dispatched.
    ships: [
      {
        id: "ship-1",
        name: "Rusty Pick",
        type: "prospector",
        destination: "inner_belt",
      },
    ],

    // BONDED STOCK: tonnes of each item set aside so freighters
    // and the Sell buttons never take them, e.g.
    // { hull_plating: 100 }. Empty = nothing bonded. (bonded.js)
    bonded: {},

    // Refinery and workshop upgrades bought, e.g.
    // { furnace_lining_1: true }. (upgrades.js)
    upgrades: {},

    // Part-tonnes waiting to become whole ones, e.g.
    // { iron_bar: 0.5 }. Scrap recovery and Improved yield make
    // fractions (5% of 30 t = 1.5 t); the hold only shows whole
    // tonnes, so the half waits here until the next one tops it
    // up. See addItemWithCarry below.
    carry: {},

    // How many Fleet command upgrades have been bought.
    // The total command points are worked out from this (command.js).
    commandUpgrades: 0,

    // The number the NEXT ship bought will get ("ship-2").
    nextShipNumber: 2,

    // XP in each skill. Levels are worked out from XP (skills.js).
    skills: {
      mining: { xp: 0 },
      trade: { xp: 0 },
      refining: { xp: 0 },
      manufacturing: { xp: 0 },
    },

    // Jobs that are currently running (empty at the start):
    // ships' trips (see jobs.js), refinery slots (refinery.js)
    // and workshop work orders (workshop.js).
    jobs: [],

    // When the game was last saved, as a timestamp.
    lastSavedAt: Date.now(),

    // How far the game has been PLAYED up to, as a timestamp.
    // simulation.js plays from here to "now" every tick, and on
    // load after time away - see advanceTo().
    simulatedUpTo: Date.now(),

    // The run clock: total time actually played, in ms. Time
    // past the offline cap doesn't count (it isn't played).
    simulatedMs: 0,
  };
}


// -------------------------------------------------------------
// addItem(state, itemId, amount)
// Puts some of an item into storage.
// -------------------------------------------------------------
export function addItem(state, itemId, amount) {
  // If we've never had this item before, start its count at 0.
  if (state.inventory[itemId] === undefined) {
    state.inventory[itemId] = 0;
  }
  state.inventory[itemId] += amount;
}


// -------------------------------------------------------------
// findShip(state, shipId)
// Looks up one of the player's ships by its ID.
// Returns undefined if no ship has that ID.
// -------------------------------------------------------------
export function findShip(state, shipId) {
  return state.ships.find((ship) => ship.id === shipId);
}


// -------------------------------------------------------------
// addItemWithCarry(state, itemId, amount)
// Adds an amount that may not be whole (like 1.5 t), keeping the
// hold in whole tonnes. The whole part goes in the hold now; the
// fraction is saved in state.carry and added to the next amount.
//   1.5 t  ->  1 t into the hold, 0.5 carried
//   1.5 t  ->  0.5 + 1.5 = 2 t into the hold, 0 carried
// Over many batches the player gets exactly the right total.
// Returns the whole tonnes that went into the hold.
// -------------------------------------------------------------
export function addItemWithCarry(state, itemId, amount) {
  const total = (state.carry[itemId] || 0) + amount;
  // Rounding to 6 decimals first stops tiny computer rounding
  // errors (0.1 + 0.2 = 0.30000000000000004) from losing a tonne.
  const whole = Math.floor(Math.round(total * 1e6) / 1e6);
  const left = total - whole;
  if (left > 1e-9) {
    state.carry[itemId] = left;
  } else {
    delete state.carry[itemId];
  }
  if (whole > 0) {
    addItem(state, itemId, whole);
  }
  return whole;
}
