// =============================================================
// data/content.js
// -------------------------------------------------------------
// GAME CONTENT: the "things" that exist in the game.
//
// This file holds DATA only - no game logic. Ships, places,
// items and skills are described here, and the rest of the code
// reads them. That means you can change a number here (say, how
// much ore sells for) without touching any other file.
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
// SKILLS: activities that level up with XP.
// -------------------------------------------------------------
export const SKILLS = {
  mining: {
    name: "Mining",
    description: "Send barges to asteroid fields to bring back ore. Levels unlock better mining ships.",
  },
};

// XP_TABLE: how much TOTAL XP you need to REACH each level.
// Read it as "level 2 needs 100 XP, level 3 needs 250 XP" etc.
// The first entry (position 0) is unused, so the position in
// the list matches the level number. The last level listed is
// the highest you can reach for now.
export const XP_TABLE = [
  null,   // (no level 0)
  0,      // level 1 - where everyone starts
  100,    // level 2
  250,    // level 3
  450,    // level 4
  700,    // level 5
  1000,   // level 6
  1400,   // level 7
  1900,   // level 8
  2500,   // level 9
  3200,   // level 10
];


// -------------------------------------------------------------
// SHIP TYPES: the kinds of ship that can exist.
// -------------------------------------------------------------
// A ship TYPE is like a blueprint. Each actual ship the player
// owns (in state.js) points at one of these by its ID.
//
//   skill        which skill this ship belongs to
//   unlockLevel  the skill level needed to buy one
//   cost         price in credits (null = not for sale)
export const SHIP_TYPES = {
  prospector: {
    name: "Prospector-class barge",
    cargoCapacity: 10,        // units of ore brought back per trip
    skill: "mining",
    unlockLevel: 1,
    cost: null,               // your starting ship; not sold
  },
  excavator: {
    name: "Excavator-class barge",
    cargoCapacity: 25,
    skill: "mining",
    unlockLevel: 2,
    cost: 750,
  },
};

// Names given to newly bought ships, used in order.
// (If we run out, ships get numbered names instead.)
export const SHIP_NAMES = [
  "Second Wind",
  "Lucky Strike",
  "Grit and Gravel",
  "Ore Else",
  "Deep Pockets",
  "Slow Burn",
];


// -------------------------------------------------------------
// MINING FIELDS: places a ship can be sent to mine.
// -------------------------------------------------------------
export const FIELDS = {
  inner_belt: {
    name: "Inner Belt",
    yields: "iron_ore",       // which item (from ITEMS) it produces
    tripSeconds: 20,          // a full round trip: fly out, mine, fly back
    xpPerTrip: 10,            // Mining XP earned for each finished trip
  },
};


// -------------------------------------------------------------
// GAME RULES: general numbers that aren't tied to one thing.
// -------------------------------------------------------------
export const RULES = {
  offlineCapHours: 24,        // most time away that counts (design doc: 24h)
  autosaveSeconds: 5,         // how often the game saves itself
};
