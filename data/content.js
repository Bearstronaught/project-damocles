// =============================================================
// data/content.js
// -------------------------------------------------------------
// GAME CONTENT: the "things" that exist in the game.
//
// This file holds DATA only - no game logic. Ships, places,
// items and skills are described here, and the rest of the code
// reads them.
//
// WORDS live here; NUMBERS live in the balance sheet.
//   - Names, descriptions and pictures are written below.
//   - Every number (prices, hull stats, trip times, XP rates,
//     unlock levels...) comes from data/balance.js, which the
//     Export tab of the Project Damocles balance sheet writes.
//     To change a number, change it in the sheet and export it;
//     don't edit balance.js by hand.
//
// The "..." in "...BALANCE.ships.prospector" is JavaScript's
// "spread": it copies every number from that part of the
// balance file into the object here, as if typed out in full.
// =============================================================

import { BALANCE } from "./balance.js";


// -------------------------------------------------------------
// ITEMS: anything that can sit in the cargo hold.
// -------------------------------------------------------------
// All cargo is measured in TONNES (t). The screen shows big
// amounts as kilotonnes (kt) and megatonnes (Mt) automatically.
// Each item is listed under a short ID (like "iron_ore").
// The code always uses the ID; the "name" is only for display.
// Items show in the cargo hold in the order they're listed here.
// From the balance sheet (Items tab):
//   sellPrice  what the HOME dock pays per tonne (instant sale)
//   hubPrice   what the MERCHANT HUB pays per tonne (more, but a
//              freighter has to fly it there)
export const ITEMS = {
  iron_ore: {
    name: "Iron ore",         // what the player sees
    ...BALANCE.items.iron_ore,
  },
  nickel_ore: {
    name: "Nickel ore",
    ...BALANCE.items.nickel_ore,
  },
  // Refined metals, made at the refinery (see RECIPES below)
  iron_bar: {
    name: "Iron bars",
    ...BALANCE.items.iron_bar,
  },
  nickel_bar: {
    name: "Nickel bars",
    ...BALANCE.items.nickel_bar,
  },
  steel: {
    name: "Steel",
    ...BALANCE.items.steel,
  },
};


// -------------------------------------------------------------
// SKILLS: activities that level up with XP.
// -------------------------------------------------------------
// How much XP each level needs isn't listed here: it follows
// RuneScape's formula, worked out in js/skills.js. (The balance
// sheet's Levels tab uses the same formula.)
export const SKILLS = {
  mining: {
    name: "Mining",
    description: "Send barges to asteroid fields to bring back ore. Levels unlock better mining ships and richer fields.",
  },
  trade: {
    name: "Trade",
    description: "Sell goods for credits. Selling at home is instant; hauling to the merchant hub pays more and earns bonus XP. Levels unlock freighters.",
  },
  refining: {
    name: "Refining",
    description: "Smelt ore into metal at the Anvil Station refinery, which opens at a Mining milestone. Metal sells for more than the ore it came from. Levels unlock recipes, extra refinery slots and faster batches.",
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
// From the balance sheet (Settings tab): commandPoints.
export const HULL_SIZES = {
  small:   { name: "Small",   ...BALANCE.hullSizes.small },
  medium:  { name: "Medium",  ...BALANCE.hullSizes.medium },
  large:   { name: "Large",   ...BALANCE.hullSizes.large },
  capital: { name: "Capital", ...BALANCE.hullSizes.capital },
};

// COMMAND: how much the player can command, and how it grows.
// All numbers, so it comes straight from the balance sheet
// (Settings tab):
//   startPoints       points a new player has
//   pointsPerUpgrade  points each Fleet command upgrade adds
//   firstUpgradeCost  price of the first upgrade (credits)
//   costMultiplier    each upgrade costs this many times the last
//                     (2 = doubles: 80,000 -> 160,000 -> 320,000 ...)
//   maxUpgrades       how many upgrades can be bought in total
export const COMMAND = BALANCE.command;

// SELLING: an idle ship sells for this share of its price.
export const SELL_RATE = BALANCE.sellRate;

// SHIP PRICES GROW: each ship of a type costs this many times the
// last one (1.6 = 60% more), counting the ships of that type you
// own right now. Selling one makes the next one cheaper again.
export const SHIP_PRICE_GROWTH = BALANCE.shipPriceGrowth;

// FLEET XP: a bigger mining fleet earns more Mining XP, but each
// extra ship adds less than the last. The whole fleet earns
// (ships working) ^ FLEET_XP_EXPONENT times one ship's XP:
//   with 0.6:  1 ship = 1x,  4 ships = 2.3x,  12 ships = 4.4x
// Credits are NOT affected - only XP. Smaller = slower levels.
export const FLEET_XP_EXPONENT = BALANCE.fleetXpExponent;


// -------------------------------------------------------------
// ROLES: the jobs ships do. The Command screen groups ship
// cards under one heading per role, in the order listed here.
// When a new kind of ship arrives (scouts, warships...), add
// its role here and it gets its own group automatically.
// -------------------------------------------------------------
export const ROLES = {
  mining: { name: "Mining" },
  freight: { name: "Freight" },
};


// -------------------------------------------------------------
// SHIP TYPES: the kinds of ship that can exist.
// -------------------------------------------------------------
// A ship TYPE is like a blueprint. Each actual ship the player
// owns (in state.js) points at one of these by its ID.
//
// Written here:
//   name, description   what the player reads
//   art                 which picture to use (see js/art.js)
//
// From the balance sheet (Ships tab):
//   role           what kind of work the ship does:
//                  "mining"  flies to asteroid fields, brings ore home
//                  "freight" hauls ore to the merchant hub and sells it
//   size           hull size, from HULL_SIZES (sets command points)
//   skill          which skill unlocks this ship
//   unlockLevel    the skill level needed to buy one
//   cost           base price in credits: what the first one costs
//                  when you own none (null = not for sale). Each one
//                  you own makes the next dearer (SHIP_PRICE_GROWTH).
//   cargoCapacity  tonnes of ore the hold carries per trip
//   miningRate     tonnes mined per minute at the field
//                  (mining time = cargo / rate). Freighters have none.
//   speed          how fast the drive is, as a multiplier:
//                  1.0 = normal, 0.75 = takes a third longer
//   (resale        what it sells for if it has no shop price.
//                  No ship uses this at the moment.)
export const SHIP_TYPES = {
  prospector: {
    name: "Prospector-class barge",
    description: "Small, quick and cheap to run. Your first barge, and a cheap way to grow the fleet early on.",
    art: "hull_prospector",
    ...BALANCE.ships.prospector,
  },
  excavator: {
    name: "Excavator-class barge",
    description: "Heavy hauler with twin drill heads. Slow to get there, but brings back four times the ore.",
    art: "hull_excavator",
    ...BALANCE.ships.excavator,
  },
  courier: {
    name: "Courier-class freighter",
    description: "Small, quick freighter. Hauls ore to the merchant hub for better prices and bonus Trade XP.",
    art: "hull_courier",
    ...BALANCE.ships.courier,
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
// Fields show on screen in the order they're listed here.
// From the balance sheet (Fields tab):
//   yields        which item (from ITEMS) it produces
//   travelSeconds one way, for a ship with speed 1.0
//   tonnesPerXp   1 Mining XP for every this-many tonnes brought
//                 home (10 = 1 XP per 10 t, so a 120 t hold = 12 XP).
//   unlockLevel   Mining level needed to send ships there
export const FIELDS = {
  inner_belt: {
    name: "Inner Belt",
    description: "Iron-rich rubble close to home.",
    ...BALANCE.fields.inner_belt,
  },
  outer_belt: {
    name: "Outer Belt",
    description: "Sparse nickel rock on the edge of the system. Twice the flight, much better pay.",
    ...BALANCE.fields.outer_belt,
  },
};


// -------------------------------------------------------------
// RECIPES: what the refinery can make.
// -------------------------------------------------------------
// Each recipe is listed under the ID of the item it makes.
// The refinery has a few SLOTS; each slot runs one recipe over
// and over, taking ore from the home hold for every batch.
//
// Written here: the name the player sees.
// From the balance sheet (Recipes tab):
//   unlockLevel   Refining level needed to use it
//   inputs        what one batch takes from the hold, in tonnes,
//                 e.g. { iron_ore: 60, nickel_ore: 30 }
//   output        the item one batch makes
//   outputAmount  how many tonnes of it
//   seconds       how long one batch takes at Refining level 1
//   xp            Refining XP for each finished batch
export const RECIPES = {
  iron_bar: {
    name: "Iron bars",
    ...BALANCE.recipes.iron_bar,
  },
  nickel_bar: {
    name: "Nickel bars",
    ...BALANCE.recipes.nickel_bar,
  },
  steel: {
    name: "Steel",
    ...BALANCE.recipes.steel,
  },
};

// THE REFINERY: slots and speed. From the balance sheet
// (Settings tab):
//   slotLevels     the Refining level each slot unlocks at,
//                  e.g. [1, 10, 25] = slot 1 from the start,
//                  slot 2 at level 10, slot 3 at level 25
//   speedPerLevel  each level above 1 makes batches this much
//                  faster (0.005 = 0.5% per level)
//   openAtMiningLevel  the refinery is closed until the player
//                  reaches this MINING level, so early on ore has
//                  to be sold
export const REFINERY = BALANCE.refinery;


// -------------------------------------------------------------
// TRADE: how selling earns Trade XP.
// -------------------------------------------------------------
// From the balance sheet (Settings tab):
//   creditsPerXp           every this-many credits earned from a
//                          sale gives 1 Trade XP (100 = 1 XP per
//                          100 cr). XP can be a fraction: 250 cr = 2.5 XP.
//   hubTonnesPerBonusXp    1 extra XP for every this-many tonnes
//                          delivered to the merchant hub, on top of
//                          the sale XP, as a reward for the trip.
export const TRADE = BALANCE.trade;

// HOME: the player's starting station, where barges unload and
// where ore sells instantly. Change the name here and it changes
// everywhere in the game.
export const HOME = {
  name: "Anvil Station",
};

// THE MERCHANT HUB: where freighters sell for better prices.
// The name is a placeholder until the lore names it.
// From the balance sheet (Settings tab):
//   travelSeconds  one way, for a ship with speed 1.0
//   tradeSeconds   time spent docked at the hub, selling
export const HUB = {
  name: "Merchant hub",
  description: "A busy trading post a few minutes' flight from home. Pays well for ore you bring in.",
  ...BALANCE.hub,
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
  ...BALANCE.rules,           // offlineCapHours, from the balance sheet
  autosaveSeconds: 5,         // how often the game saves itself
  maxLevel: 99,               // highest skill level, as in RuneScape
};
