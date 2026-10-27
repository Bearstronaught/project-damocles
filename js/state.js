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
export const SAVE_VERSION = 2;


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

    // What's in storage, counted by item ID from content.js.
    inventory: {
      iron_ore: 0,
    },

    // The player's fleet. Each ship has its own unique ID
    // ("ship-1") and a "type" that points at SHIP_TYPES.
    ships: [
      {
        id: "ship-1",
        name: "Rusty Pick",
        type: "prospector",
      },
    ],

    // The number the NEXT ship bought will get ("ship-2").
    nextShipNumber: 2,

    // XP in each skill. Levels are worked out from XP (skills.js).
    skills: {
      mining: { xp: 0 },
    },

    // Jobs that are currently running (empty at the start).
    // See jobs.js for what a job looks like.
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
