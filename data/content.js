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
// Items show in the cargo hold in the order they're listed here.
export const ITEMS = {
  iron_ore: {
    name: "Iron ore",         // what the player sees
    sellPrice: 5,             // credits paid for ONE unit
  },
  nickel_ore: {
    name: "Nickel ore",
    sellPrice: 12,
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
    description: "Send barges to asteroid fields to bring back ore. Levels unlock better mining ships and richer fields.",
  },
};


// -------------------------------------------------------------
// HULL SIZES and COMMAND POINTS
// -------------------------------------------------------------
// Every ship takes up command points depending on its size.
// The player can only command so many points at once (see
// COMMAND below). Bigger hulls cost more points but do more
// work per point, which nudges players towards them.
// (Large and capital hulls don't exist yet; their numbers are
// placeholders.)
export const HULL_SIZES = {
  small:   { name: "Small",   commandPoints: 1 },
  medium:  { name: "Medium",  commandPoints: 2 },
  large:   { name: "Large",   commandPoints: 4 },
  capital: { name: "Capital", commandPoints: 8 },
};

// COMMAND: how much the player can command, and how it grows.
//   startPoints       points a new player has
//   pointsPerUpgrade  points each Fleet command upgrade adds
//   firstUpgradeCost  price of the first upgrade (credits)
//   costMultiplier    each upgrade costs this many times the last
//                     (2 = doubles: 2,000 -> 4,000 -> 8,000 ...)
//   maxUpgrades       how many upgrades can be bought in total
export const COMMAND = {
  startPoints: 4,
  pointsPerUpgrade: 2,
  firstUpgradeCost: 2000,
  costMultiplier: 2,
  maxUpgrades: 10,
};

// SELLING: an idle ship sells for this share of its price.
export const SELL_RATE = 0.5;


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
//   size           hull size, from HULL_SIZES (sets command points)
//   skill          which skill this ship belongs to
//   unlockLevel    the skill level needed to buy one
//   cost           price in credits (null = not for sale)
//   resale         what it sells for, if it has no shop price
//                  (otherwise it sells for cost x SELL_RATE)
//   art            which picture to use (see js/art.js)
export const SHIP_TYPES = {
  prospector: {
    name: "Prospector-class barge",
    description: "Small, quick and cheap to run. Your first barge.",
    cargoCapacity: 12,
    miningRate: 12,
    speed: 1.0,
    size: "small",
    skill: "mining",
    unlockLevel: 1,
    cost: null,               // your starting ship; not sold at the yard
    resale: 250,              // ...but a scrapyard will take it
    art: "hull_prospector",
  },
  excavator: {
    name: "Excavator-class barge",
    description: "Heavy hauler with twin drill heads. Slow to get there, but brings back over three times the ore.",
    cargoCapacity: 40,
    miningRate: 20,
    speed: 0.75,
    size: "medium",
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
//   yields        which item (from ITEMS) it produces
//   travelSeconds one way, for a ship with speed 1.0
//   xpPerUnit     Mining XP earned per unit of ore brought home
//   unlockLevel   Mining level needed to send ships there
// Fields show on screen in the order they're listed here.
export const FIELDS = {
  inner_belt: {
    name: "Inner Belt",
    description: "Iron-rich rubble close to home.",
    yields: "iron_ore",
    travelSeconds: 45,
    xpPerUnit: 2,
    unlockLevel: 1,
  },
  outer_belt: {
    name: "Outer Belt",
    description: "Sparse nickel rock on the edge of the system. Twice the flight, much better pay.",
    yields: "nickel_ore",
    travelSeconds: 90,
    xpPerUnit: 4,
    unlockLevel: 5,
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
