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
// Every number in here is a STARTING POINT for balance, and
// yours to change. Later on, this will be exported from the
// balance spreadsheet.
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
// How much XP each level needs isn't listed here: it follows
// RuneScape's formula, worked out in js/skills.js.
export const SKILLS = {
  mining: {
    name: "Mining",
    description: "Send barges to asteroid fields to bring back ore. Levels unlock better mining ships.",
  },
};


// -------------------------------------------------------------
// SHIP TYPES: the kinds of ship that can exist.
// -------------------------------------------------------------
// A ship TYPE is like a blueprint. Each actual ship the player
// owns (in state.js) points at one of these by its ID.
//
// The three working stats decide how long a mining trip takes:
//   cargoCapacity  units of ore the hold carries home per trip
//   miningRate     units mined per minute at the field
//                  (mining time = cargo / rate, so a big hold
//                  with a slow drill spends longer at the rock)
//   speed          how fast the drive is, as a multiplier:
//                  1.0 = normal, 0.75 = takes a third longer
//
// And the shipyard details:
//   skill          which skill this ship belongs to
//   unlockLevel    the skill level needed to buy one
//   cost           price in credits (null = not for sale)
//   art            which drawing to use (see js/art.js)
export const SHIP_TYPES = {
  prospector: {
    name: "Prospector-class barge",
    description: "Small, quick and cheap to run. Your first barge.",
    cargoCapacity: 12,
    miningRate: 12,
    speed: 1.0,
    skill: "mining",
    unlockLevel: 1,
    cost: null,               // your starting ship; not sold
    art: "hull_prospector",
  },
  excavator: {
    name: "Excavator-class barge",
    description: "Heavy hauler with twin drill heads. Slow to get there, but brings back over three times the ore.",
    cargoCapacity: 40,
    miningRate: 20,
    speed: 0.75,
    skill: "mining",
    unlockLevel: 2,
    cost: 3000,
    art: "hull_excavator",
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
    travelSeconds: 45,        // one way, for a ship with speed 1.0
    xpPerUnit: 2,             // Mining XP earned per unit of ore brought home
  },
};


// -------------------------------------------------------------
// GAME RULES: general numbers that aren't tied to one thing.
// -------------------------------------------------------------
export const RULES = {
  offlineCapHours: 24,        // most time away that counts (design doc: 24h)
  autosaveSeconds: 5,         // how often the game saves itself
  maxLevel: 99,               // highest skill level, as in RuneScape
};
