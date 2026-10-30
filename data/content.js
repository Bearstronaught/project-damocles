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
  // Manufactured products, made at the workshop (see
  // WORKSHOP_RECIPES below). Each sells for more than the metal
  // that went into it, and later ones feed ship building.
  hull_plating: {
    name: "Hull plating",
    ...BALANCE.items.hull_plating,
  },
  wiring_coils: {
    name: "Wiring coils",
    ...BALANCE.items.wiring_coils,
  },
  structural_frames: {
    name: "Structural frames",
    ...BALANCE.items.structural_frames,
  },
  cargo_pod: {
    name: "Cargo pods",
    ...BALANCE.items.cargo_pod,
  },
  thruster_assembly: {
    name: "Thruster assemblies",
    ...BALANCE.items.thruster_assembly,
  },
  // Found, not made: your Pathfinder brings it back from the
  // alien wreck and deep scans (see SURVEY_TARGETS below). Worth
  // a lot per tonne; later it will feed Research.
  // Ice from the Ice moon (opens when a scout surveys it). With
  // no habitable planet in the system, water is valued: it sells
  // for more than nickel ore, less than hull plating (Dan, 30 Oct).
  ice: {
    name: "Ice",
    ...BALANCE.items.ice,
  },
  wreck_alloy: {
    name: "Wreck alloy",
    ...BALANCE.items.wreck_alloy,
  },
};


// -------------------------------------------------------------
// SKILLS: activities that level up with XP.
// -------------------------------------------------------------
// How much XP each level needs isn't listed here: it follows
// RuneScape's formula, worked out in js/skills.js. (The balance
// sheet's Levels tab uses the same formula.)
// "perk" names what EVERY level gives (the numbers are in the
// balance sheet; skills.js getLevelPerk adds them up), e.g.
// "drill speed" -> "Every level: +0.5% drill speed".
// -------------------------------------------------------------
// SHIP SPEED ON SCREEN (Dan, 30 Oct)
// -------------------------------------------------------------
// The game works with a speed multiplier (balance sheet: 1 = a
// Prospector, 1.25 = a quarter faster; a trip takes its time ÷
// speed). Screens show it in km/s instead, so ships compare at a
// glance: speed 1 = 120 km/s, so a Prospector flies at 120 km/s,
// an Excavator (0.75) at 90 and a Pathfinder (1.25) at 150. Only
// the words on screen use this; it doesn't change any trip.
export const KM_PER_SECOND_AT_SPEED_1 = 120;


export const SKILLS = {
  mining: {
    name: "Mining",
    description: "Send barges to asteroid fields to bring back ore. Levels unlock better mining ships, richer fields and ship components, and every level makes your drills a little faster.",
    perk: "drill speed",
  },
  trade: {
    name: "Trade",
    description: "Haul goods to markets for better prices. Trade XP comes from freighters: tonnes delivered times the distance flown. Selling at home is instant but earns no XP. Levels unlock bigger freighters and freighter components, and every level adds to what the hub pays.",
    perk: "hub prices",
  },
  refining: {
    name: "Refining",
    description: "Smelt ore into metal at the Anvil Station refinery, which opens at a Mining milestone. Metal sells for more than the ore it came from. Levels unlock recipes and extra refinery slots, and every level makes batches a little faster.",
    perk: "refinery speed",
  },
  manufacturing: {
    name: "Manufacturing",
    description: "Turn metal into components and assemblies at the Anvil Station workshop, which opens at a Refining milestone. Queue work orders: each runs a set number of batches, then the slot goes idle. Products sell for more than their metal. Levels unlock recipes, workshop slots and longer queues, and every level makes batches a little faster.",
    perk: "workshop speed",
  },
  exploration: {
    name: "Exploration",
    description: "Send scouts to survey the home system. Each survey target is a one-off trip that brings back a find: credits, goods, or another piece of the alien wreck's story. When the targets run out, scouts run deep scans for XP and the odd find. Your first scout, the Pathfinder, goes on sale once you've sold your first ore. Levels unlock new targets, and every level makes scans a little faster.",
    perk: "scan speed",
  },
  diplomacy: {
    name: "Diplomacy",
    description: "Deal with the factions that post on the contracts board. Diplomacy XP comes from finishing contracts (bigger contracts, more XP). Levels add slots to the board, so more contracts are on offer at once. How well a faction thinks of you is your reputation with them, kept separately on the Contracts tab.",
    perk: null,
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
  scout: { name: "Scouting" },
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
//
// Written here, optional:
//   unlockAfter    a milestone that must happen before the ship
//                  can be bought, on top of the skill level, e.g.
//                  "firstSale" = the player has sold ore once
//                  (see MILESTONES below)
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
  pathfinder: {
    name: "Pathfinder-class scout",
    description: "Light, fast and nosy. Flies out to survey targets in the home system and brings back whatever it finds. Carries no cargo of its own.",
    art: "hull_pathfinder",
    unlockAfter: "firstSale",
    ...BALANCE.ships.pathfinder,
  },
};

// -------------------------------------------------------------
// MILESTONES: one-off things the player has done, used to
// unlock something that isn't tied to a skill level.
// -------------------------------------------------------------
// "says" is how the Shipyard and Skills screens describe what's
// still needed.
export const MILESTONES = {
  firstSale: { says: "Sell your first ore to unlock" },
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
  // Opened by a survey, not a Mining level: "survey" names the
  // survey target (SURVEY_TARGETS) that has to be done first.
  ice_moon: {
    name: "Ice moon",
    description: "Thick ice under a thin crust, a long flight out. Water is scarce in a system with nowhere to live, so it sells well.",
    ...BALANCE.fields.ice_moon,
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
// WORKSHOP RECIPES: what the workshop can make (Manufacturing).
// -------------------------------------------------------------
// Laid out exactly like the refinery's RECIPES above, but they
// run as WORK ORDERS instead of on repeat: the player queues
// "make 20 batches of hull plating", the slot works through it,
// and then stops (see js/workshop.js).
// Manufacturing keeps tonnage: 30 t of bars makes 30 t of plating.
//
// Written here: the name the player sees.
// From the balance sheet (Workshop tab): unlockLevel (a
// Manufacturing level), inputs, output, outputAmount, seconds
// (at Manufacturing level 1) and xp (Manufacturing XP per batch).
export const WORKSHOP_RECIPES = {
  hull_plating: {
    name: "Hull plating",
    ...BALANCE.workshopRecipes.hull_plating,
  },
  wiring_coils: {
    name: "Wiring coils",
    ...BALANCE.workshopRecipes.wiring_coils,
  },
  structural_frames: {
    name: "Structural frames",
    ...BALANCE.workshopRecipes.structural_frames,
  },
  cargo_pod: {
    name: "Cargo pods",
    ...BALANCE.workshopRecipes.cargo_pod,
  },
  thruster_assembly: {
    name: "Thruster assemblies",
    ...BALANCE.workshopRecipes.thruster_assembly,
  },
};

// THE WORKSHOP: slots, queues and speed. From the balance sheet
// (Settings tab):
//   openAtRefiningLevel  the workshop is closed until the player
//                        reaches this REFINING level
//   slotLevels           the Manufacturing level each slot unlocks
//                        at, e.g. [1, 12, 35]
//   baseQueue            how many orders each slot can hold to start
//   queueLevels          each of these Manufacturing levels adds
//                        one more queued order per slot, e.g. [8, 25]
//                        takes the queue from 3 to 4, then 5
//   maxOrderBatches      the most batches one order can ask for
//   speedPerLevel        each level above 1 makes batches this much
//                        faster (0.005 = 0.5% per level)
//   standingPerSlot      with the Control centre, how many standing
//                        orders each slot can hold
export const WORKSHOP = BALANCE.workshop;


// -------------------------------------------------------------
// UPGRADES: bought on the Industry tab with products + credits.
// -------------------------------------------------------------
// Written here: the name and a short description of the effect.
// From the balance sheet (Upgrades tab):
//   building  "refinery" or "workshop" (where it shows)
//   skill     which skill's level unlocks it
//   level     the level needed
//   requires  an upgrade that must be owned first (null = none),
//             e.g. Furnace lining II needs Furnace lining I
//   costs     goods taken from the hold, e.g. { hull_plating: 20 }
//             (bonded goods count: they're kept for this)
//   credits   credits it costs too
//   effect    what it changes (js/upgrades.js adds them up):
//     refineSpeed    refinery batches this much faster (0.1 = 10%)
//     refineYield    this much more metal per refinery batch
//     refineSlot     extra refinery slots
//     workshopSpeed  workshop batches this much faster
//     workshopScrap  this share of a workshop batch's metal back
//     orderSize      this many more batches allowed in one order
//     smartQueue     a blocked work order can be skipped
//     standingOrders the Control centre: standing orders unlocked
//   value     how much of the effect (see above)
export const UPGRADES = {
  furnace_lining_1: {
    name: "Furnace lining I",
    description: "Refinery batches 10% faster.",
    ...BALANCE.upgrades.furnace_lining_1,
  },
  improved_yield_1: {
    name: "Improved yield I",
    description: "Each refinery batch makes 10% more metal.",
    ...BALANCE.upgrades.improved_yield_1,
  },
  furnace_lining_2: {
    name: "Furnace lining II",
    description: "Refinery batches another 10% faster.",
    ...BALANCE.upgrades.furnace_lining_2,
  },
  improved_yield_2: {
    name: "Improved yield II",
    description: "Each refinery batch makes another 10% more metal.",
    ...BALANCE.upgrades.improved_yield_2,
  },
  furnace_lining_3: {
    name: "Furnace lining III",
    description: "Refinery batches another 10% faster.",
    ...BALANCE.upgrades.furnace_lining_3,
  },
  refinery_slot_4: {
    name: "Refinery slot 4",
    description: "A fourth refinery slot.",
    ...BALANCE.upgrades.refinery_slot_4,
  },
  precision_tooling_1: {
    name: "Precision tooling I",
    description: "Workshop batches 10% faster.",
    ...BALANCE.upgrades.precision_tooling_1,
  },
  scrap_recovery_1: {
    name: "Scrap recovery I",
    description: "5% of the metal in each workshop batch comes back to the hold.",
    ...BALANCE.upgrades.scrap_recovery_1,
  },
  smart_queue: {
    name: "Smart queue",
    description: "An order waiting for metal no longer holds up the queue: the next order with metal runs instead.",
    ...BALANCE.upgrades.smart_queue,
  },
  bigger_orders_1: {
    name: "Bigger work orders I",
    description: "One order can hold 20 more batches.",
    ...BALANCE.upgrades.bigger_orders_1,
  },
  precision_tooling_2: {
    name: "Precision tooling II",
    description: "Workshop batches another 10% faster.",
    ...BALANCE.upgrades.precision_tooling_2,
  },
  scrap_recovery_2: {
    name: "Scrap recovery II",
    description: "Another 5% of each workshop batch's metal comes back.",
    ...BALANCE.upgrades.scrap_recovery_2,
  },
  bigger_orders_2: {
    name: "Bigger work orders II",
    description: "One order can hold another 20 batches.",
    ...BALANCE.upgrades.bigger_orders_2,
  },
  precision_tooling_3: {
    name: "Precision tooling III",
    description: "Workshop batches another 10% faster.",
    ...BALANCE.upgrades.precision_tooling_3,
  },  control_centre: {
    name: "Control centre",
    description: "Unlocks standing orders: each workshop slot can keep a product topped up to a set amount whenever it has no work orders to run.",
    ...BALANCE.upgrades.control_centre,
  },
};


// -------------------------------------------------------------
// SURVEY TARGETS: places in the home system a scout can survey.
// -------------------------------------------------------------
// Each target is surveyed ONCE: the scout flies out, scans it,
// flies home, and brings back its find. They show (and scouts
// work through them) in the order listed here.
//
// Written here (names and lore are placeholders for Dan's lore):
//   name        what the player sees
//   description what the Exploration screen says before it's surveyed
//   find        what the log and Exploration screen say was found
//   lore        one line of story, shown once it's surveyed
//
// From the balance sheet (Exploration tab):
//   unlockLevel    Exploration level needed
//   requires       a target that must be surveyed first (null = none);
//                  the wreck's stages go in order
//   travelSeconds  one way, for a ship with speed 1.0
//   scanSeconds    how long the scan takes at Exploration level 1
//   xp             Exploration XP for finishing the survey
//   credits        credits found (0 = none)
//   item, tonnes   goods found, put straight into the home hold
//                  (item null = none)
const TARGET_WORDS = {
  inner_belt_survey: {
    name: "Inner Belt survey",
    description: "Chart the rubble your barges already mine. Someone must have been here before you.",
    find: "an abandoned prospector's cache",
    lore: "The cache belonged to the outfit that held this contract before you. Their last log entry just says \"Not worth it.\"",
  },
  outer_belt_survey: {
    name: "Outer Belt survey",
    description: "A long sweep of the sparse rock on the system's edge.",
    find: "a pocket of high-grade nickel, which your barges strip on their next pass",
    lore: "The sensors keep snagging on something big and cold in the far side of the belt. It isn't rock.",
  },
  wreck_1: {
    name: "The wreck: first pass",
    description: "Something big and cold is drifting in the Outer Belt. Get a closer look.",
    find: "fragments of an alloy nobody can identify",
    lore: "A hull, kilometres long, older than the station. No markings anyone recognises, and no sign it was ever meant to be found.",
  },
  ice_moon: {
    name: "Ice moon",
    description: "A frozen moon circling the gas giant. Worth a look for anything a mining outfit can use.",
    find: "an old fuel depot's unclaimed balance",
    lore: "Thick ice under a thin crust, and nobody's claim on it. With no habitable world in the system, every tonne of water is worth hauling. Your barges can mine it now.",
  },
  wreck_2: {
    name: "The wreck: hull breach",
    description: "There's a gap in the wreck's hull. Send the scout in, carefully.",
    find: "more of the alloy, cut from the breach",
    lore: "The breach wasn't made by a collision. Something cut its way OUT.",
  },
  silent_relay: {
    name: "Silent relay",
    description: "An old comms relay that stopped answering years ago.",
    find: "a forgotten maintenance fund, still claimable",
    lore: "The relay's logs mention belt independents trading a few systems away. Nobody has heard from them since the lanes went quiet.",
  },
  wreck_3: {
    name: "The wreck: inner chambers",
    description: "Past the breach, the wreck opens up into chambers nobody has seen.",
    find: "a large haul of alloy from the inner chambers",
    lore: "The chambers hold equipment arranged around empty spaces, as if its crew were never quite solid.",
  },
  system_edge: {
    name: "System edge",
    description: "The furthest your drives can take you. The scout looks outward.",
    find: "survey data the belt independents will pay for",
    lore: "Other stars, close enough to name, far too far to reach. Something on the wreck says that doesn't have to be true.",
  },
  wreck_4: {
    name: "The wreck: the sealed core",
    description: "At the wreck's heart, a sealed chamber is still drawing power.",
    find: "the last of the loose alloy around the core",
    lore: "The core is sealed and still warm. Whatever is inside moves mass in ways physics says it shouldn't. You can't open it. Yet.",
  },
};

export const SURVEY_TARGETS = {};
for (const [id, numbers] of Object.entries(BALANCE.surveyTargets)) {
  SURVEY_TARGETS[id] = { ...TARGET_WORDS[id], ...numbers };
}

// DEEP SCAN: what a scout does when there are no targets left.
// It never runs out: each run earns XP, and some bring back a
// small find. From the balance sheet (Exploration tab):
//   unlockLevel, travelSeconds, scanSeconds, xp   as for targets
//   findChance    share of runs that find something (0.3 = 30%)
//   alloyShare    of those finds, the share that are wreck alloy
//                 (alloyTonnes of it); the rest are credits,
//                 between creditsMin and creditsMax
// Which runs find something is decided by a dice roll that's
// fixed for each save (see exploration.js), so an hour away
// always gives the same finds as an hour played.
export const DEEP_SCAN = {
  name: "Deep scan",
  description: "A long, slow scan of the whole system from its quiet edge. Never runs out, earns steady XP, and now and then picks something up.",
  ...BALANCE.exploration.deepScan,
};

// EXPLORATION settings (balance sheet, Settings tab):
//   scanSpeedPerLevel   each Exploration level above 1 makes the
//                       scan part of a trip this much faster
export const EXPLORATION = {
  scanSpeedPerLevel: BALANCE.exploration.scanSpeedPerLevel,
};


// -------------------------------------------------------------
// CONTRACTS: jobs posted by the belt independents (contracts.js).
// -------------------------------------------------------------
// The board holds a few contracts at a time. They never fail or
// expire; a finished or discarded one is replaced after a while.
//
// Each KIND is one way of earning a contract's pay. New kinds
// (ship orders, escorts, ...) are added here, in the balance
// sheet, and as one small rule in contracts.js.
//
// Written here:
//   title        the card's heading
//   text         what the client wants. {client}, {amount},
//                {item}, {field} and {target} are filled in.
//   doneText     how the finished contract reads in the log
//
// From the balance sheet (Contracts tab):
//   kind       how it's done:
//                deliver   hand goods over from the hold
//                mine      bring home ore from one field (you keep it)
//                refine    make metal at the refinery (you keep it)
//                survey    survey one target
//                deepScan  run some deep scans
//   goods      what it can ask for: "ore" (from fields you can mine),
//              "metal" (refinery recipes you have), "product"
//              (workshop recipes you have), or "none"
//   weight     how often it comes up, against the others (4 is
//              twice as often as 2). Kinds the player can't do
//              yet are never posted.
//   amount     a typical size at the first reputation tier: tonnes,
//              surveys or deep scans. Each contract is between 75%
//              and 125% of it, times the tier's size.
//   pay        deliver/charter/toll: times the goods' home price per
//              tonne (1.5 = half as much again as selling it; a
//              toll's 0.5 is for smelting only, the ore is theirs).
//              survey: credits per Exploration level of the target,
//              plus 4 levels' worth. deepScan: credits per scan.
//   reputation what it earns with the faction that posted it
//   xp         the Diplomacy XP it earns, times the tier's size
const CONTRACT_WORDS = {
  ore_requisition: {
    title: "Ore requisition",
    text: "{client} needs {amount} of {item}. Hand it over from your hold.",
  },
  metal_requisition: {
    title: "Metal requisition",
    text: "{client} needs {amount} of {item} for repairs. Hand it over from your hold.",
  },
  parts_order: {
    title: "Parts order",
    text: "{client} is building something and needs {amount} of {item}.",
  },
  mining_charter: {
    title: "Mining charter",
    text: "{client} has a buyer but no barge. Lend them one of your mining ships to work the {field}: its hauls are theirs until {amount} of {item} is handed over.",
  },
  toll_smelting: {
    title: "Toll smelting",
    text: "{client} has ore but no furnace. Lend them a refinery slot to smelt {amount} of {item} from their ore; the metal is theirs, and none of your ore is used.",
  },
  survey_request: {
    title: "Survey request",
    text: "{client} will pay for a survey of {target}. Your scouts will get to it; this pays when it's done.",
  },
  deep_scan_contract: {
    title: "Deep scan contract",
    text: "{client} wants fresh scan data: run {amount} deep scans.",
  },
};

export const CONTRACT_KINDS = {};
for (const [id, numbers] of Object.entries(BALANCE.contractKinds)) {
  CONTRACT_KINDS[id] = { ...CONTRACT_WORDS[id], ...numbers };
}

// Who posts them: one picked for each contract. Placeholders for
// Dan's lore; all belt independents for now.
export const CONTRACT_CLIENTS = [
  "A belt co-op",
  "The Kessler hauling crew",
  "A station repair gang",
  "An ice-miner family",
  "The Drift Market",
  "A prospector's widow",
  "The Lantern Dock collective",
];

// THE FACTIONS that post contracts (Factions in the design doc).
// Each has its own reputation, and its own box on the Contracts
// screen. Only the belt independents so far; a new faction is a
// new entry here (the first one listed is the board's default).
export const CONTRACT_FACTIONS = {
  independents: {
    name: "Belt independents",
    description: "Self-reliant miners and traders scattered through the belt. They don't trust outsiders, but they pay for work done.",
  },
};

// REPUTATION TIERS, the same ladder with every faction. Earning reputation
// moves you up; each tier makes their contracts bigger (size),
// and pay grows with size. From the balance sheet: from (the
// reputation it starts at) and size. Names written here.
const TIER_NAMES = ["Unknown", "Known", "Trusted", "Valued", "Partner"];
export const REPUTATION_TIERS = BALANCE.reputationTiers.map((tier, index) => ({
  name: TIER_NAMES[index],
  ...tier,
}));

// THE BOARD (balance sheet, Contracts tab):
//   openAtMiningLevel   the belt independents start posting at
//                       this Mining level
//   slots               how many contracts are on the board at the
//                       start, shared by every faction
//   slotLevels          each of these Diplomacy levels adds a slot
//   refillMinutes       a finished or discarded contract is replaced
//                       this long after
//   surveyLevelsAhead   a survey request can be for a target up to
//                       this many Exploration levels above yours
export const CONTRACTS = BALANCE.contracts;


// -------------------------------------------------------------
// TRADE: how freighters earn Trade XP (Dan, 29 Oct).
// -------------------------------------------------------------
// Trade XP comes from hauling, measured like real freight:
// tonnes delivered x distance flown. What the cargo is worth
// doesn't matter, so better prices and metals don't speed up
// Trade levels. Selling at the home dock earns no Trade XP.
// From the balance sheet (Settings tab):
//   tonneMinutesPerXp   1 Trade XP for every this-many "tonne-
//                       minutes": tonnes x one-way flight minutes
//                       at drive speed 1.00x. With 15, 600 t to
//                       the hub (3 minutes away) = 600 x 3 / 15
//                       = 120 XP before the fleet share.
// Longer routes give more XP per trip but fewer trips per hour,
// so XP per hour doesn't depend on which station you pick.
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
// (Time docked at the hub is unloading time: see each hull
// size's loadingRate in HULL_SIZES.)
export const HUB = {
  name: "Merchant hub",
  description: "A busy trading post a few minutes' flight from home. Pays well for ore you bring in.",
  ...BALANCE.hub,
};

// LEVEL PERKS for Mining and Trade (balance sheet, Settings tab).
// Refining and Manufacturing have theirs in REFINERY and WORKSHOP
// (speedPerLevel). Each counts from level 1, so level 1 = +0%.
//   miningDrillPerLevel    every mining ship drills this much faster
//   tradeHubPricePerLevel  every hub sale pays this much more
export const LEVEL_PERKS = BALANCE.levelPerks;

// SHIP PARTS: the parts ship upgrades improve. "stat" is
// the ship stat the part's bonus adds to (see ship-upgrades.js).
export const SHIP_PARTS = {
  drill: { name: "Drill",      stat: "miningRate",    says: "mining rate" },
  hold:  { name: "Cargo hold", stat: "cargoCapacity", says: "cargo" },
  drive: { name: "Drive",      stat: "speed",         says: "speed" },
  // Scouts only: a better sensor array scans faster
  sensors: { name: "Sensor array", stat: "scanRate",   says: "scan speed" },
};

// SHIP UPGRADES: grades Mk I to Mk III of each part, per hull
// TYPE (one purchase fits every ship of that type, now and later).
// Numbers from the balance sheet's Ship upgrades tab:
//   hull, part, grade (1-3), skill + level needed, credits,
//   costs (products, {} for none), bonus (0.15 = +15%)
// The name is built here, e.g. "Prospector drill Mk II".
const GRADE_NAMES = { 1: "Mk I", 2: "Mk II", 3: "Mk III" };
export const SHIP_UPGRADES = {};
for (const [id, upgrade] of Object.entries(BALANCE.shipUpgrades)) {
  SHIP_UPGRADES[id] = {
    ...upgrade,
    gradeName: GRADE_NAMES[upgrade.grade],
  };
}

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
