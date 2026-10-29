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
export const SAVE_VERSION = 7;


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
    },

    // Jobs that are currently running (empty at the start):
    // ships' trips (see jobs.js) and refinery slots (refinery.js).
    jobs: [],

    // When the game was last saved, as a timestamp.
    // Used to work out how long the player was away.
    lastSavedAt: Date.now(),
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
