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
// All cargo is measured in TONNES (t). The screen shows big
// amounts as kilotonnes (kt) and megatonnes (Mt) automatically.
// Each item is listed under a short ID (like "iron_ore").
// The code always uses the ID; the "name" is only for display.
// Items show in the cargo hold in the order they're listed here.
//   sellPrice  what the HOME dock pays per tonne (instant sale)
//   hubPrice   what the MERCHANT HUB pays per tonne (about 60%
//              more, but a freighter has to fly it there)
export const ITEMS = {
  iron_ore: {
    name: "Iron ore",         // what the player sees
    sellPrice: 5,             // credits paid per tonne at home
    hubPrice: 8,
  },
  nickel_ore: {
    name: "Nickel ore",
    sellPrice: 12,
    hubPrice: 19,
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
  trade: {
    name: "Trade",
    description: "Sell goods for credits. Selling at home is instant; hauling to the merchant hub pays more and earns bonus XP. Levels unlock freighters.",
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
//                     (2 = doubles: 20,000 -> 40,000 -> 80,000 ...)
//   maxUpgrades       how many upgrades can be bought in total
export const COMMAND = {
  startPoints: 4,
  pointsPerUpgrade: 2,
  firstUpgradeCost: 20000,
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
// role says what kind of work the ship does:
//   "mining"   flies to asteroid fields and brings ore home
//   "freight"  hauls ore from home to the merchant hub and sells it
//
// The three working stats decide how long a mining trip takes:
//   cargoCapacity  tonnes of ore the hold carries home per trip
//   miningRate     tonnes mined per minute at the field
//                  (mining time = cargo / rate, so a big hold
//                  with a slow drill spends longer at the rock)
//   speed          how fast the drive is, as a multiplier:
//                  1.0 = normal, 0.75 = takes a third longer
// (Freighters have no drill, so no miningRate. Their
//  cargoCapacity is how much ore they haul per trip.)
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
    role: "mining",
    description: "Small, quick and cheap to run. Your first barge, and a cheap way to grow the fleet early on.",
    cargoCapacity: 120,
    miningRate: 120,
    speed: 1.0,
    size: "small",
    skill: "mining",
    unlockLevel: 1,
    cost: 8000,               // about half an hour of mining with one Prospector
    art: "hull_prospector",
  },
  excavator: {
    name: "Excavator-class barge",
    role: "mining",
    description: "Heavy hauler with twin drill heads. Slow to get there, but brings back four times the ore.",
    // 480 t at 240 t/min: earns about 25% more than two Prospectors
    // on the same 2 command points, so it's a real upgrade (28 Oct).
    cargoCapacity: 480,
    miningRate: 240,
    speed: 0.75,
    size: "medium",
    skill: "mining",
    unlockLevel: 10,
    cost: 30000,
    art: "hull_excavator",
  },
  courier: {
    name: "Courier-class freighter",
    role: "freight",
    description: "Small, quick freighter. Hauls ore to the merchant hub for better prices and bonus Trade XP.",
    cargoCapacity: 600,
    speed: 1.0,
    size: "small",
    skill: "trade",
    unlockLevel: 3,
    cost: 25000,
    art: "hull_courier",
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
//   tonnesPerXp   1 Mining XP for every this-many tonnes brought
//                 home (10 = 1 XP per 10 t, so a 120 t hold = 12 XP).
//                 Written this way round so the maths stays exact.
//   unlockLevel   Mining level needed to send ships there
// Fields show on screen in the order they're listed here.
export const FIELDS = {
  inner_belt: {
    name: "Inner Belt",
    description: "Iron-rich rubble close to home.",
    yields: "iron_ore",
    travelSeconds: 45,
    tonnesPerXp: 10,          // halved 28 Oct: early levels came too fast
    unlockLevel: 1,
  },
  outer_belt: {
    name: "Outer Belt",
    description: "Sparse nickel rock on the edge of the system. Twice the flight, much better pay.",
    yields: "nickel_ore",
    travelSeconds: 90,
    tonnesPerXp: 5,           // double the Inner Belt's XP
    unlockLevel: 5,
  },
};


// -------------------------------------------------------------
// TRADE: how selling earns Trade XP.
// -------------------------------------------------------------
//   creditsPerXp           every this-many credits earned from a
//                          sale gives 1 Trade XP (100 = 1 XP per
//                          100 cr). XP can be a fraction: 250 cr = 2.5 XP.
//   hubTonnesPerBonusXp    1 extra XP for every this-many tonnes
//                          delivered to the merchant hub, on top of
//                          the sale XP, as a reward for the trip.
export const TRADE = {
  creditsPerXp: 100,
  hubTonnesPerBonusXp: 10,
};

// HOME: the player's starting station, where barges unload and
// where ore sells instantly. Change the name here and it changes
// everywhere in the game. ("Home dock" is a placeholder until the
// lore names it.)
export const HOME = {
  name: "Anvil Station",
};

// THE MERCHANT HUB: where freighters sell for better prices.
// The name is a placeholder until the lore names it.
//   travelSeconds  one way, for a ship with speed 1.0
//   tradeSeconds   time spent docked at the hub, selling
export const HUB = {
  name: "Merchant hub",
  description: "A busy trading post a few minutes' flight from home. Pays well for ore you bring in.",
  travelSeconds: 180,
  tradeSeconds: 30,
};

// HAUL MODES: how a freighter decides when to leave home.
//   full      waits until it can fill its whole hold
//   constant  leaves as soon as there's any ore, with whatever
//             is there (it still waits if the hold is empty -
//             flying to the hub with nothing to sell is pointless)
export const HAUL_MODES = {
  full: { name: "Full loads" },
  constant: { name: "Constant runs" },
};


// -------------------------------------------------------------
// GAME RULES: general numbers that aren't tied to one thing.
// -------------------------------------------------------------
export const RULES = {
  offlineCapHours: 24,        // most time away that counts (design doc: 24h)
  autosaveSeconds: 5,         // how often the game saves itself
  maxLevel: 99,               // highest skill level, as in RuneScape
};
