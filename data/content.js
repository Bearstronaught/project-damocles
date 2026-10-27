// =============================================================
// data/content.js
// -------------------------------------------------------------
// GAME CONTENT: the "things" that exist in the game.
//
// This file holds DATA only - no game logic. Ships, places and
// items are described here, and the rest of the code reads them.
// That means you can change a number here (say, how much ore
// sells for) without touching any other file.
//
// Later on, this will be exported from the balance spreadsheet.
// =============================================================


// -------------------------------------------------------------
// ITEMS: anything that can sit in the cargo hold.
// -------------------------------------------------------------
// Each item is listed under a short ID (like "iron_ore").
// The code always uses the ID; the "name" is only for display.
export const ITEMS = {
  iron_ore: {
    name: "Iron ore",         // what the player sees
    sellPrice: 5,             // credits paid for ONE unit
  },
};


// -------------------------------------------------------------
// SHIP TYPES: the kinds of ship that can exist.
// -------------------------------------------------------------
// A ship TYPE is like a blueprint. Each actual ship the player
// owns (in state.js) points at one of these by its ID.
export const SHIP_TYPES = {
  prospector: {
    name: "Prospector-class barge",
    cargoCapacity: 10,        // units of ore brought back per trip
  },
};


// -------------------------------------------------------------
// MINING FIELDS: places a ship can be sent to mine.
// -------------------------------------------------------------
export const FIELDS = {
  inner_belt: {
    name: "Inner Belt",
    yields: "iron_ore",       // which item (from ITEMS) it produces
    tripSeconds: 20,          // a full round trip: fly out, mine, fly back
  },
};


// -------------------------------------------------------------
// GAME RULES: general numbers that aren't tied to one thing.
// -------------------------------------------------------------
export const RULES = {
  offlineCapHours: 24,        // most time away that counts (design doc: 24h)
  autosaveSeconds: 5,         // how often the game saves itself
};
