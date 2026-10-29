// =============================================================
// tests/logic-tests.js
// -------------------------------------------------------------
// AUTOMATED CHECKS for the game rules (no browser needed).
//
// Each test sets up a situation, runs some game code, and then
// "asserts" what should be true. If any assert is wrong, the
// test fails and tells us which one.
//
// How to run (needs Node.js installed):
//     node tests/logic-tests.js
//
// We pass a made-up "now" time into the functions, so we can
// jump forward minutes or days instantly instead of waiting.
//
// Most tests read their numbers (trip length, ore per trip,
// prices) from the game data instead of typing them in. That
// way, changing the balance in content.js doesn't break them -
// they check the RULES, not today's numbers.
// =============================================================

import assert from "node:assert/strict";
import { SHIP_TYPES, ITEMS, COMMAND, FIELDS, HULL_SIZES } from "../data/content.js";
import { BALANCE } from "../data/balance.js";
import { createNewGame, SAVE_VERSION } from "../js/state.js";
import { getMiningXpShare, startMiningJob, startHaulJob, getJobForShip, processJobs, cancelJob, recallJob, resumeJob, getJobProgress, getJobPhase, getTripPlan, getHaulPlan, loadCargo } from "../js/jobs.js";
import { sellAll, sellEverything, getCargoValue, sellAtHub, getTradeXp, getPrice } from "../js/trade.js";
import { parseSave, applyOfflineProgress, exportSave, importSave } from "../js/save.js";
import { XP_TABLE, getLevelForXp, getLevel, getLevelProgress, addXp, isShipTypeUnlocked, MAX_LEVEL } from "../js/skills.js";
import { canBuyShip, buyShip, canSellShip, sellShip, getSellValue, renameShip, getShipPrice } from "../js/shipyard.js";
import { getCommandCapacity, getCommandUsed, getNextUpgradeCost, buyUpgrade } from "../js/command.js";
import { isFieldUnlocked } from "../js/skills.js";
import { getRoleGroups, describeGroup, getShipActivity } from "../js/fleet-groups.js";
import { setRecipe, getRefineJob, isRefineryOpen, getSlotCount, getBatchMs, isRecipeUnlocked, getRecipeUnlocksAtLevel, getSlotUnlocksAtLevel } from "../js/refinery.js";
import { RECIPES, REFINERY } from "../data/content.js";

const SECOND = 1000;                 // milliseconds in a second
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const START = 1_000_000_000_000;     // a fixed pretend "start" time

// The two ships' trips to the Inner Belt, straight from the data.
const PROSPECTOR = getTripPlan("prospector", "inner_belt");
const EXCAVATOR = getTripPlan("excavator", "inner_belt");
const TRIP = PROSPECTOR.durationMs;  // one Prospector round trip

let passed = 0;
let failed = 0;

// A tiny helper: runs one test and prints PASS or FAIL.
function test(name, testFunction) {
  try {
    testFunction();
    console.log("PASS  " + name);
    passed++;
  } catch (error) {
    console.log("FAIL  " + name);
    console.log("      " + error.message);
    failed++;
  }
}

// A game at Mining level 10 (Excavator unlocked) with some money,
// for shipyard tests.
function gameAtLevel10(credits) {
  const state = createNewGame();
  state.skills.mining.xp = XP_TABLE[10];
  state.credits = credits;
  return state;
}


// =============================================================
// THE NEW PACING (today's starting numbers)
// These DO check exact numbers, on purpose: they record the
// balance as it stands. If you change content.js, update them.
// =============================================================

test("Prospector trip: 45s out, 1m mining, 45s back = 2m 30s, 120 t ore, 12 XP", () => {
  assert.equal(PROSPECTOR.outboundMs, 45 * SECOND);
  assert.equal(PROSPECTOR.miningMs, 60 * SECOND);
  assert.equal(PROSPECTOR.returnMs, 45 * SECOND);
  assert.equal(PROSPECTOR.durationMs, 150 * SECOND);
  assert.equal(PROSPECTOR.orePerTrip, 120);
  assert.equal(PROSPECTOR.xpPerTrip, 12);
});

test("Excavator trip: 1m out (slower drive), 2m mining, 1m back = 4m, 480 t ore", () => {
  assert.equal(EXCAVATOR.outboundMs, 60 * SECOND);
  assert.equal(EXCAVATOR.miningMs, 120 * SECOND);
  assert.equal(EXCAVATOR.durationMs, 240 * SECOND);
  assert.equal(EXCAVATOR.orePerTrip, 480);
});

test("Excavator earns 2.5x a Prospector per hour", () => {
  const perHour = (plan) => plan.orePerTrip * (HOUR / plan.durationMs);
  const ratio = perHour(EXCAVATOR) / perHour(PROSPECTOR);
  assert.ok(ratio > 2.4 && ratio < 2.6, "ratio was " + ratio.toFixed(2));
});

test("On the same 2 command points, an Excavator beats two Prospectors", () => {
  // Otherwise there's no reason to trade up at Mining 10.
  const perHour = (plan) => plan.orePerTrip * (HOUR / plan.durationMs);
  assert.equal(SHIP_TYPES.excavator.size, "medium");    // 2 command points
  assert.ok(perHour(EXCAVATOR) > 1.2 * 2 * perHour(PROSPECTOR));
});

test("Buying an Excavator takes over 2 hours of Prospector mining", () => {
  const creditsPerHour = PROSPECTOR.orePerTrip * ITEMS.iron_ore.sellPrice * (HOUR / TRIP);
  const hours = SHIP_TYPES.excavator.cost / creditsPerHour;
  assert.ok(hours > 2, "only " + hours.toFixed(1) + " hours");
});


// =============================================================
// TRIPS AND PHASES
// =============================================================

test("A new game starts with no credits, no ore, one idle ship", () => {
  const state = createNewGame();
  assert.equal(state.credits, 0);
  assert.equal(state.inventory.iron_ore, 0);
  assert.equal(state.ships.length, 1);
  assert.equal(state.jobs.length, 0);
});

test("Nothing is mined until the ship gets home", () => {
  const state = createNewGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  processJobs(state, START + TRIP - 1);
  assert.equal(state.inventory.iron_ore, 0);
});

test("One finished trip brings back a full hold", () => {
  const state = createNewGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  processJobs(state, START + TRIP);
  assert.equal(state.inventory.iron_ore, PROSPECTOR.orePerTrip);
});

test("Phases run in order: outbound, then mining, then returning", () => {
  const state = createNewGame();
  const job = startMiningJob(state, "ship-1", "inner_belt", START);
  assert.equal(getJobPhase(job, START + 10 * SECOND).phase, "outbound");
  assert.equal(getJobPhase(job, START + PROSPECTOR.outboundMs + 1).phase, "mining");
  assert.equal(getJobPhase(job, START + TRIP - 1).phase, "returning");
});

test("Phase fills: halfway through mining = outbound full, mining half, return empty", () => {
  const state = createNewGame();
  const job = startMiningJob(state, "ship-1", "inner_belt", START);
  const halfwayMining = START + PROSPECTOR.outboundMs + PROSPECTOR.miningMs / 2;
  const phase = getJobPhase(job, halfwayMining);
  assert.deepEqual(phase.fills, [1, 0.5, 0]);
  assert.equal(phase.msLeftInPhase, PROSPECTOR.miningMs / 2);
});

test("Leftover time carries into the next trip (2.5 trips = 2 paid, next trip halfway)", () => {
  const state = createNewGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  processJobs(state, START + TRIP * 2.5);
  assert.equal(state.inventory.iron_ore, PROSPECTOR.orePerTrip * 2);
  assert.equal(state.jobs.length, 1);
  assert.equal(getJobProgress(state.jobs[0], START + TRIP * 2.5), 0.5);
});

test("Ticking often gives the same result as one big jump", () => {
  // This is what makes offline progress fair: 4 small checks a
  // second for an hour must equal one check after an hour.
  const ticking = createNewGame();
  const jumping = createNewGame();
  startMiningJob(ticking, "ship-1", "inner_belt", START);
  startMiningJob(jumping, "ship-1", "inner_belt", START);

  for (let t = 0; t <= HOUR; t += 250) {
    processJobs(ticking, START + t);
  }
  processJobs(jumping, START + HOUR);

  assert.equal(ticking.inventory.iron_ore, jumping.inventory.iron_ore);
  assert.equal(ticking.skills.mining.xp, jumping.skills.mining.xp);
  assert.equal(ticking.inventory.iron_ore, PROSPECTOR.orePerTrip * Math.floor(HOUR / TRIP));
});

test("A ship can't be sent on two jobs at once", () => {
  const state = createNewGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  const second = startMiningJob(state, "ship-1", "inner_belt", START);
  assert.equal(second, null);
  assert.equal(state.jobs.length, 1);
});

test("Recalling a ship cancels its job and loses the partial trip", () => {
  const state = createNewGame();
  const job = startMiningJob(state, "ship-1", "inner_belt", START);
  cancelJob(state, job.id);
  processJobs(state, START + TRIP * 3);
  assert.equal(state.jobs.length, 0);
  assert.equal(state.inventory.iron_ore, 0);
});

test("A clock set backwards doesn't take ore away", () => {
  const state = createNewGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  processJobs(state, START - 100 * SECOND);
  assert.equal(state.inventory.iron_ore, 0);
  assert.equal(state.jobs[0].startedAt, START);
});


// =============================================================
// TRADE
// =============================================================

test("Selling all ore pays the market price and empties the hold", () => {
  const state = createNewGame();
  state.inventory.iron_ore = 30;
  const sale = sellAll(state, "iron_ore");
  assert.equal(sale.credits, 30 * ITEMS.iron_ore.sellPrice);
  assert.equal(state.credits, sale.credits);
  assert.equal(state.inventory.iron_ore, 0);
});

test("Selling with an empty hold earns nothing, not even XP", () => {
  const state = createNewGame();
  assert.deepEqual(sellAll(state, "iron_ore"), { credits: 0, xp: 0, newLevels: [] });
  assert.equal(state.credits, 0);
  assert.equal(state.skills.trade.xp, 0);
});

test("The hub pays about 60% more than home for each ore", () => {
  assert.equal(getPrice("iron_ore", "home"), 5);
  assert.equal(getPrice("iron_ore", "hub"), 8);
  assert.equal(getPrice("nickel_ore", "home"), 12);
  assert.equal(getPrice("nickel_ore", "hub"), 19);
});

test("Selling at home earns 1 Trade XP per 100 cr (120 t iron = 600 cr = 6 XP)", () => {
  const state = createNewGame();
  state.inventory.iron_ore = 120;
  const sale = sellAll(state, "iron_ore");
  assert.equal(sale.xp, 6);
  assert.equal(state.skills.trade.xp, 6);
  assert.equal(state.skills.mining.xp, 0);          // Mining XP untouched
});

test("Trade XP can be a fraction: 120 t nickel = 1,440 cr = 14.4 XP", () => {
  const state = createNewGame();
  state.inventory.nickel_ore = 120;
  assert.equal(sellAll(state, "nickel_ore").xp, 14.4);
});

test("A big home sale reports the Trade levels it reached", () => {
  const state = createNewGame();
  state.inventory.iron_ore = 4000;                  // 20,000 cr = 200 XP
  const sale = sellAll(state, "iron_ore");
  assert.equal(getLevel(state, "trade"), 3);        // level 3 starts at 174 XP
  assert.deepEqual(sale.newLevels, [2, 3]);
});

test("Selling at the hub: 600 t iron pays 4,800 cr and 108 XP (48 sale + 60 bonus)", () => {
  const state = createNewGame();
  const sale = sellAtHub(state, { iron_ore: 600 });
  assert.equal(sale.credits, 4800);
  assert.equal(sale.tonnes, 600);
  assert.equal(sale.xp, 108);
  assert.equal(state.credits, 4800);
  assert.equal(state.skills.trade.xp, 108);
});

test("The hub takes mixed cargo and doesn't touch the home hold", () => {
  const state = createNewGame();
  state.inventory.iron_ore = 990;                    // stays at home
  const sale = sellAtHub(state, { nickel_ore: 200, iron_ore: 400 });
  assert.equal(sale.credits, 200 * 19 + 400 * 8);    // 3,800 + 3,200 = 7,000
  assert.equal(sale.xp, getTradeXp(7000, 600));    // 70 + 60 = 130
  assert.equal(state.inventory.iron_ore, 990);
});

test("Hauling 600 t iron earns over 3x the Trade XP of selling it at home", () => {
  const homeXp = getTradeXp(600 * ITEMS.iron_ore.sellPrice);       // 30
  const hubXp = getTradeXp(600 * ITEMS.iron_ore.hubPrice, 600);    // 108
  assert.ok(hubXp > homeXp * 3, `${hubXp} vs ${homeXp}`);
});

test("Trade 3 takes roughly an hour of one Prospector selling at home", () => {
  const xpPerHour = getTradeXp(PROSPECTOR.orePerTrip * ITEMS.iron_ore.sellPrice) * (HOUR / TRIP);
  const hours = XP_TABLE[3] / xpPerHour;
  assert.ok(hours > 1 && hours < 1.5, hours.toFixed(2) + " hours");
});


// =============================================================
// SAVING AND OFFLINE PROGRESS
// =============================================================

test("A save turned into text and back is identical", () => {
  const state = createNewGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  state.credits = 1234;
  const loaded = parseSave(JSON.stringify(state));
  assert.deepEqual(loaded, state);
});

test("A broken save is rejected safely instead of crashing", () => {
  assert.equal(parseSave("this is not a save {{{"), null);
});

test("Offline: 1 hour away pays every trip that fitted (24 trips)", () => {
  const state = createNewGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  state.lastSavedAt = START;
  const report = applyOfflineProgress(state, START + 1 * HOUR);
  assert.equal(state.inventory.iron_ore, 24 * PROSPECTOR.orePerTrip);
  assert.equal(report.secondsAway, 3600);
  assert.equal(report.secondsCounted, 3600);
});

test("Offline: 3 days away only counts the 24 hour cap", () => {
  const state = createNewGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  state.lastSavedAt = START;
  const now = START + 72 * HOUR;
  const report = applyOfflineProgress(state, now);

  const tripsIn24h = Math.floor(24 * HOUR / TRIP);
  assert.equal(state.inventory.iron_ore, tripsIn24h * PROSPECTOR.orePerTrip);
  assert.equal(report.secondsCounted, 24 * 3600);

  // The ship carries on from "now", not with 48 hours of backlog.
  processJobs(state, now);
  assert.equal(state.inventory.iron_ore, tripsIn24h * PROSPECTOR.orePerTrip);
});


// =============================================================
// SKILLS AND THE RUNESCAPE XP CURVE
// =============================================================

test("XP table matches RuneScape: L2 83, L10 1,154, L50 101,333, L92 6,517,253, L99 13,034,431", () => {
  assert.equal(XP_TABLE[2], 83);
  assert.equal(XP_TABLE[10], 1154);
  assert.equal(XP_TABLE[50], 101333);
  assert.equal(XP_TABLE[92], 6517253);
  assert.equal(XP_TABLE[99], 13034431);
  assert.equal(MAX_LEVEL, 99);
});

test("XP turns into the right level at the edges (82 = L1, 83 = L2)", () => {
  assert.equal(getLevelForXp(0), 1);
  assert.equal(getLevelForXp(82), 1);
  assert.equal(getLevelForXp(83), 2);
  assert.equal(getLevelForXp(1153), 9);
  assert.equal(getLevelForXp(1154), 10);
  assert.equal(getLevelForXp(999_999_999), 99);
});

test("Each trip earns XP for every unit of ore brought home", () => {
  const state = createNewGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  processJobs(state, START + TRIP * 2);
  assert.equal(state.skills.mining.xp, PROSPECTOR.xpPerTrip * 2);
});

test("Mining level 2 arrives on the 7th Prospector trip (17m 30s)", () => {
  const state = createNewGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  processJobs(state, START + TRIP * 6);
  assert.equal(getLevel(state, "mining"), 1);    // 72 XP after 6 trips
  const results = processJobs(state, START + TRIP * 7);
  assert.equal(getLevel(state, "mining"), 2);    // 84 XP after 7
  assert.deepEqual(results[0].newLevels, [2]);
});

test("A big XP jump reports every level passed, not just the last", () => {
  const state = createNewGame();
  const newLevels = addXp(state, "mining", XP_TABLE[4]);   // straight to level 4
  assert.deepEqual(newLevels, [2, 3, 4]);
});

test("XP bar maths: halfway between level 2 and 3 fills half the bar", () => {
  const state = createNewGame();
  state.skills.mining.xp = (XP_TABLE[2] + XP_TABLE[3]) / 2;
  const progress = getLevelProgress(state, "mining");
  assert.equal(progress.level, 2);
  assert.equal(progress.fraction, 0.5);
});

test("At level 99 the XP bar is full and says so", () => {
  const state = createNewGame();
  state.skills.mining.xp = XP_TABLE[99];
  const progress = getLevelProgress(state, "mining");
  assert.equal(progress.isMax, true);
  assert.equal(progress.fraction, 1);
});


// =============================================================
// SHIPYARD
// =============================================================

test("The Excavator is locked at Mining level 9", () => {
  const state = createNewGame();
  state.skills.mining.xp = XP_TABLE[10] - 1;   // 1 XP short of level 10
  state.credits = 1_000_000;
  assert.equal(isShipTypeUnlocked(state, "excavator"), false);
  assert.deepEqual(canBuyShip(state, "excavator"), { ok: false, reason: "Locked" });
  assert.equal(buyShip(state, "excavator"), null);
  assert.equal(state.credits, 1_000_000);   // no money taken
});

test("Unlocked but 1 cr short: can't buy, and the reason says why", () => {
  const state = gameAtLevel10(SHIP_TYPES.excavator.cost - 1);
  assert.deepEqual(canBuyShip(state, "excavator"), { ok: false, reason: "Not enough credits" });
});

test("Buying an Excavator takes its price and adds 'Second Wind' as ship-2", () => {
  const cost = SHIP_TYPES.excavator.cost;
  const state = gameAtLevel10(cost + 2500);
  const ship = buyShip(state, "excavator");
  assert.equal(state.credits, 2500);
  assert.equal(state.ships.length, 2);
  assert.equal(ship.id, "ship-2");
  assert.equal(ship.name, "Second Wind");
  assert.equal(state.nextShipNumber, 3);
});

test("A second Prospector can be bought from the start, for 8,000 cr", () => {
  const state = createNewGame();
  state.credits = 8000;
  const ship = buyShip(state, "prospector");
  assert.ok(ship);
  assert.equal(ship.type, "prospector");
  assert.equal(state.credits, 0);
  assert.equal(state.ships.length, 2);
});

test("Four Prospectors fill the 4 starting command points", () => {
  const state = createNewGame();
  state.credits = 1_000_000;                         // plenty, so only points can stop us
  buyShip(state, "prospector");
  buyShip(state, "prospector");
  buyShip(state, "prospector");
  const before = state.credits;
  assert.deepEqual(canBuyShip(state, "prospector"), { ok: false, reason: "Not enough command points" });
  assert.equal(buyShip(state, "prospector"), null);
  assert.equal(state.credits, before);               // the 5th wasn't charged
});

test("A second Prospector takes about half an hour of mining to afford", () => {
  // Dan's change (28 Oct): an hour felt too long. The second one
  // (owning the starter) costs 8,000 cr; at 14,400 cr an hour
  // that's about 33 minutes. Later ones cost more (29 Oct).
  const creditsPerHour = PROSPECTOR.orePerTrip * ITEMS.iron_ore.sellPrice * (HOUR / TRIP);
  const hours = getShipPrice(createNewGame(), "prospector") / creditsPerHour;
  assert.ok(hours > 0.4 && hours < 0.75, hours.toFixed(2) + " hours");
});

test("Two ships with different trip lengths each pay out on their own timer", () => {
  const state = gameAtLevel10(SHIP_TYPES.excavator.cost);
  buyShip(state, "excavator");
  startMiningJob(state, "ship-1", "inner_belt", START);
  startMiningJob(state, "ship-2", "inner_belt", START);

  // After one Excavator trip (4m): the Prospector (2m 30s) has done 1 trip.
  processJobs(state, START + EXCAVATOR.durationMs);
  assert.equal(state.inventory.iron_ore, PROSPECTOR.orePerTrip + EXCAVATOR.orePerTrip);
});


// =============================================================
// SAVE UPGRADES
// =============================================================

test("A version 1 save (first commit) upgrades all the way to the latest version", () => {
  // Exactly what the first commit's game saved.
  const oldSave = {
    version: 1,
    credits: 50,
    inventory: { iron_ore: 10 },
    ships: [{ id: "ship-1", name: "Rusty Pick", type: "prospector" }],
    jobs: [],
    lastSavedAt: START,
  };
  const state = parseSave(JSON.stringify(oldSave));
  assert.equal(state.version, SAVE_VERSION);
  assert.equal(state.credits, 500);                // x10 for tonnes, nothing lost
  assert.equal(state.inventory.iron_ore, 100);
  assert.deepEqual(state.skills, { mining: { xp: 0 }, trade: { xp: 0 }, refining: { xp: 0 } });
  assert.equal(state.nextShipNumber, 2);
});

test("A version 2 save's old 20s trip is re-timed to the new three-phase trip", () => {
  // What the second build saved while a ship was mining.
  const oldSave = {
    version: 2,
    credits: 0,
    inventory: { iron_ore: 0 },
    nextShipNumber: 2,
    skills: { mining: { xp: 120 } },
    ships: [{ id: "ship-1", name: "Rusty Pick", type: "prospector" }],
    jobs: [{ id: "job-a", type: "mining", shipId: "ship-1", fieldId: "inner_belt",
             startedAt: START, durationMs: 20000, repeat: true }],
    lastSavedAt: START,
  };
  const state = parseSave(JSON.stringify(oldSave));
  const job = state.jobs[0];
  assert.equal(state.version, SAVE_VERSION);
  assert.equal(job.durationMs, PROSPECTOR.durationMs);
  assert.equal(job.outboundMs, PROSPECTOR.outboundMs);
  assert.equal(job.miningMs, PROSPECTOR.miningMs);
  assert.equal(state.skills.mining.xp, 120);       // XP kept
});



// =============================================================
// COMMAND CAPACITY
// =============================================================

test("A new game has 4 command points, 1 used by the Prospector", () => {
  const state = createNewGame();
  assert.equal(getCommandCapacity(state), COMMAND.startPoints);
  assert.equal(getCommandCapacity(state), 4);
  assert.equal(getCommandUsed(state), 1);
});

test("An Excavator uses 2 points: Prospector + 1 Excavator = 3 of 4", () => {
  const state = gameAtLevel10(SHIP_TYPES.excavator.cost);
  buyShip(state, "excavator");
  assert.equal(getCommandUsed(state), 3);
});

test("A second Excavator is blocked by command, even with the money", () => {
  const state = gameAtLevel10(SHIP_TYPES.excavator.cost * 2);
  buyShip(state, "excavator");
  assert.deepEqual(canBuyShip(state, "excavator"), { ok: false, reason: "Not enough command points" });
  assert.equal(buyShip(state, "excavator"), null);
  assert.equal(state.credits, SHIP_TYPES.excavator.cost);   // no money taken
});

test("Command upgrades: +2 points each, priced 80,000 then 160,000 then 320,000", () => {
  // Four times the old prices (Dan, 29 Oct), still doubling.
  const state = createNewGame();
  state.credits = 80000 + 160000 + 320000;
  assert.equal(getNextUpgradeCost(state), 80000);
  buyUpgrade(state);
  assert.equal(getNextUpgradeCost(state), 160000);
  buyUpgrade(state);
  assert.equal(getNextUpgradeCost(state), 320000);
  buyUpgrade(state);
  assert.equal(getCommandCapacity(state), 4 + 3 * 2);
  assert.equal(state.credits, 0);
});

test("An upgrade you can't afford does nothing", () => {
  const state = createNewGame();
  state.credits = 1999;
  assert.equal(buyUpgrade(state), 0);
  assert.equal(state.credits, 1999);
  assert.equal(state.commandUpgrades, 0);
});

test("After the last upgrade there are no more to buy", () => {
  const state = createNewGame();
  state.commandUpgrades = COMMAND.maxUpgrades;
  assert.equal(getNextUpgradeCost(state), null);
  state.credits = 1e12;
  assert.equal(buyUpgrade(state), 0);
});

test("Expanding command makes room for the second Excavator", () => {
  // First Excavator 60,000 + upgrade 80,000 + second Excavator 96,000
  const state = gameAtLevel10(60000 + 80000 + 96000);
  buyShip(state, "excavator");
  buyUpgrade(state);
  assert.ok(buyShip(state, "excavator"));
  assert.equal(getCommandUsed(state), 5);
  assert.equal(getCommandCapacity(state), 6);
});


// =============================================================
// SHIP PRICES RISE WITH EACH ONE YOU OWN (Dan, 29 Oct)
// =============================================================

test("Each Prospector costs 60% more than the last: 8,000, 12,800, 20,480", () => {
  const state = createNewGame();                     // owns the starter
  state.credits = 1_000_000;
  assert.equal(getShipPrice(state, "prospector"), 8000);
  buyShip(state, "prospector");
  assert.equal(getShipPrice(state, "prospector"), 12800);
  buyShip(state, "prospector");
  assert.equal(getShipPrice(state, "prospector"), 20480);
  // What was taken matches the prices shown: 8,000 + 12,800
  assert.equal(state.credits, 1_000_000 - 8000 - 12800);
});

test("Each ship type has its own price ladder", () => {
  const state = gameAtLevel10(1_000_000);
  buyShip(state, "prospector");
  buyShip(state, "prospector");
  // Owning 3 Prospectors doesn't make the first Excavator dearer
  assert.equal(getShipPrice(state, "excavator"), SHIP_TYPES.excavator.cost);
});

test("Selling a ship makes the next one of that type cheaper again", () => {
  const state = createNewGame();
  state.credits = 1_000_000;
  buyShip(state, "prospector");                      // ship-2
  buyShip(state, "prospector");                      // ship-3
  assert.equal(getShipPrice(state, "prospector"), 20480);
  sellShip(state, "ship-3");
  assert.equal(getShipPrice(state, "prospector"), 12800);
});

test("Buying a ship and selling it straight back loses half the price", () => {
  const state = gameAtLevel10(1_000_000);
  buyShip(state, "excavator");                       // pays 60,000
  const price = getShipPrice(state, "excavator");    // the 2nd costs 96,000
  buyUpgrade(state);                                 // room for the 2nd
  const before = state.credits;
  const ship = buyShip(state, "excavator");
  sellShip(state, ship.id);
  assert.equal(before - state.credits, price / 2);
});


// =============================================================
// FLEET XP: EACH EXTRA SHIP EARNS A LITTLE LESS XP (Dan, 29 Oct)
// =============================================================

// A game with this many Prospectors, all out mining the Inner Belt
function fleetMining(ships) {
  const state = createNewGame();
  state.credits = 1e9;
  state.commandUpgrades = COMMAND.maxUpgrades;      // room for a big fleet
  for (let i = 1; i < ships; i++) buyShip(state, "prospector");
  for (const ship of state.ships) startMiningJob(state, ship.id, "inner_belt", START);
  return state;
}

test("XP share per ship: 1 ship 100%, 2 ships 76%, 4 ships 57%, 12 ships 37%", () => {
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.005, actual.toFixed(3));
  close(getMiningXpShare(fleetMining(1)), 1);
  close(getMiningXpShare(fleetMining(2)), 0.758);
  close(getMiningXpShare(fleetMining(4)), 0.574);
  close(getMiningXpShare(fleetMining(12)), 0.370);
});

test("A docked ship doesn't count: only ships out mining share the XP", () => {
  const state = createNewGame();
  state.credits = 1e9;
  buyShip(state, "prospector");                     // ship-2 stays docked
  startMiningJob(state, "ship-1", "inner_belt", START);
  assert.equal(getMiningXpShare(state), 1);
});

test("Four Prospectors: same ore as before, but each trip earns 57% of its XP", () => {
  const state = fleetMining(4);
  processJobs(state, START + TRIP);                 // one trip each
  assert.equal(state.inventory.iron_ore, 4 * PROSPECTOR.orePerTrip);      // ore (and so credits) untouched
  const expected = 4 * PROSPECTOR.xpPerTrip * 4 ** (BALANCE.fleetXpExponent - 1);
  assert.ok(Math.abs(state.skills.mining.xp - expected) < 1e-9, state.skills.mining.xp + " vs " + expected);
});

test("A bigger fleet still earns more XP in total, just not in proportion", () => {
  const xpAfterAnHour = (ships) => {
    const state = fleetMining(ships);
    processJobs(state, START + HOUR);
    return state.skills.mining.xp;
  };
  const one = xpAfterAnHour(1);
  const four = xpAfterAnHour(4);
  assert.ok(four > one * 2 && four < one * 2.5, (four / one).toFixed(2) + "x");
});

test("Fleet XP: ticking for 2 hours equals one 2-hour jump", () => {
  const ticking = fleetMining(6);
  const jumping = fleetMining(6);
  for (let t = 0; t <= 2 * HOUR; t += 250) processJobs(ticking, START + t);
  processJobs(jumping, START + 2 * HOUR);
  assert.equal(ticking.skills.mining.xp, jumping.skills.mining.xp);
});


// =============================================================
// SELLING SHIPS
// =============================================================

test("A ship sells for half of what it would cost to buy back", () => {
  const state = gameAtLevel10(1_000_000);
  // Only the starter Prospector: buying it back (owning 0) costs 5,000
  assert.equal(getSellValue(state, "prospector"), 2500);
  buyShip(state, "prospector");
  // Owning 2: buying one back (owning 1) costs 8,000
  assert.equal(getSellValue(state, "prospector"), 4000);
  buyShip(state, "excavator");
  // One Excavator: buying it back costs 60,000
  assert.equal(getSellValue(state, "excavator"), 30000);
});

test("Selling a docked ship pays out and frees its command points", () => {
  const state = gameAtLevel10(SHIP_TYPES.excavator.cost);
  buyShip(state, "excavator");
  const earned = sellShip(state, "ship-2");
  assert.equal(earned, SHIP_TYPES.excavator.cost / 2);
  assert.equal(state.credits, SHIP_TYPES.excavator.cost / 2);
  assert.equal(state.ships.length, 1);
  assert.equal(getCommandUsed(state), 1);
});

test("A ship can't be sold mid-trip", () => {
  const state = gameAtLevel10(SHIP_TYPES.excavator.cost);
  buyShip(state, "excavator");
  startMiningJob(state, "ship-2", "inner_belt", START);
  assert.deepEqual(canSellShip(state, "ship-2"), { ok: false, reason: "Ship is busy" });
  assert.equal(sellShip(state, "ship-2"), 0);
  assert.equal(state.ships.length, 2);
});

test("Your last ship can't be sold", () => {
  const state = createNewGame();
  assert.deepEqual(canSellShip(state, "ship-1"), { ok: false, reason: "Last ship" });
  assert.equal(sellShip(state, "ship-1"), 0);
});

test("Ship IDs are never reused after a sale", () => {
  const state = gameAtLevel10(SHIP_TYPES.excavator.cost * 2);
  buyShip(state, "excavator");             // ship-2
  sellShip(state, "ship-2");
  const next = buyShip(state, "excavator");
  assert.equal(next.id, "ship-3");
});


// =============================================================
// THE OUTER BELT
// =============================================================

test("The Outer Belt is locked until Mining level 5", () => {
  const state = createNewGame();
  state.skills.mining.xp = XP_TABLE[5] - 1;
  assert.equal(isFieldUnlocked(state, "outer_belt"), false);
  assert.equal(startMiningJob(state, "ship-1", "outer_belt", START), null);
  state.skills.mining.xp = XP_TABLE[5];
  assert.equal(isFieldUnlocked(state, "outer_belt"), true);
});

test("Prospector to the Outer Belt: 1m 30s each way, 1m mining = 4m trip", () => {
  const plan = getTripPlan("prospector", "outer_belt");
  assert.equal(plan.outboundMs, 90 * SECOND);
  assert.equal(plan.miningMs, 60 * SECOND);
  assert.equal(plan.durationMs, 240 * SECOND);
  assert.equal(plan.xpPerTrip, 24);                 // 120 t ÷ 5
});

test("An Outer Belt trip brings home nickel ore, not iron", () => {
  const state = createNewGame();
  state.skills.mining.xp = XP_TABLE[5];
  startMiningJob(state, "ship-1", "outer_belt", START);
  processJobs(state, START + 240 * SECOND);
  assert.equal(state.inventory.nickel_ore, 120);
  assert.equal(state.inventory.iron_ore, 0);
});

test("The Outer Belt pays more per hour than the Inner Belt for both ships", () => {
  const crPerHour = (typeId, fieldId, itemId) => {
    const plan = getTripPlan(typeId, fieldId);
    return plan.orePerTrip * ITEMS[itemId].sellPrice * (HOUR / plan.durationMs);
  };
  for (const typeId of ["prospector", "excavator"]) {
    assert.ok(crPerHour(typeId, "outer_belt", "nickel_ore") > crPerHour(typeId, "inner_belt", "iron_ore"), typeId);
  }
});

test("Selling everything sells every item and adds it all up", () => {
  const state = createNewGame();
  state.inventory.iron_ore = 10;
  state.inventory.nickel_ore = 10;
  const expected = 10 * ITEMS.iron_ore.sellPrice + 10 * ITEMS.nickel_ore.sellPrice;
  assert.equal(getCargoValue(state), expected);
  assert.equal(getCargoValue(state, "hub"), 10 * 8 + 10 * 19);
  const sale = sellEverything(state);
  assert.equal(sale.credits, expected);
  assert.equal(sale.xp, expected / 100);
  assert.equal(state.credits, expected);
  assert.equal(getCargoValue(state), 0);
});

test("A version 3 save gains command upgrades and destinations, keeping its ships", () => {
  // A build-3 player who bought two cheap Excavators earlier:
  // 1 + 2 + 2 = 5 points, over the new cap of 4.
  const oldSave = {
    version: 3,
    credits: 0,
    inventory: { iron_ore: 5 },
    nextShipNumber: 4,
    skills: { mining: { xp: 500 } },
    ships: [
      { id: "ship-1", name: "Rusty Pick", type: "prospector" },
      { id: "ship-2", name: "Second Wind", type: "excavator" },
      { id: "ship-3", name: "Lucky Strike", type: "excavator" },
    ],
    jobs: [],
    lastSavedAt: START,
  };
  const state = parseSave(JSON.stringify(oldSave));
  assert.equal(state.version, SAVE_VERSION);
  assert.equal(state.commandUpgrades, 0);
  assert.ok(state.ships.every((ship) => ship.destination === "inner_belt"));
  assert.equal(state.ships.length, 3);                  // nobody loses a ship...
  assert.equal(getCommandUsed(state), 5);
  assert.equal(canBuyShip(state, "excavator").ok, false);   // ...but can't buy more
});

test("A version 4 save gains the Trade skill at 0 XP, keeping its Mining XP", () => {
  const oldSave = {
    version: 4,
    credits: 1200,
    inventory: { iron_ore: 30, nickel_ore: 0 },
    nextShipNumber: 2,
    commandUpgrades: 0,
    skills: { mining: { xp: 900 } },
    ships: [{ id: "ship-1", name: "Rusty Pick", type: "prospector", destination: "inner_belt" }],
    jobs: [],
    lastSavedAt: START,
  };
  const state = parseSave(JSON.stringify(oldSave));
  assert.equal(state.version, SAVE_VERSION);
  assert.deepEqual(state.skills, { mining: { xp: 900 }, trade: { xp: 0 }, refining: { xp: 0 } });
  assert.equal(state.credits, 12000);              // x10 at version 6
});

// =============================================================
// HAULING (the Courier)
// =============================================================

const HAUL = getHaulPlan("courier");   // one Courier hub run

// A game at Trade 3 that owns a Courier as ship-2, docked.
function gameWithCourier(mode = "full") {
  const state = createNewGame();
  state.skills.trade.xp = XP_TABLE[3];
  state.credits = SHIP_TYPES.courier.cost;
  const courier = buyShip(state, "courier");
  courier.haulMode = mode;
  return state;
}

test("The Courier is locked until Trade 3, then costs 50,000 cr", () => {
  const state = createNewGame();
  state.credits = 1_000_000;
  state.skills.trade.xp = XP_TABLE[3] - 1;
  assert.deepEqual(canBuyShip(state, "courier"), { ok: false, reason: "Locked" });
  state.skills.trade.xp = XP_TABLE[3];
  const ship = buyShip(state, "courier");
  assert.equal(state.credits, 1_000_000 - 50000);
  assert.equal(ship.haulMode, "full");           // starts on full loads
  assert.equal(ship.destination, undefined);     // freighters don't mine
});

test("Hub run: 3m out, 30s trading, 3m back = 6m 30s, 600 t hold", () => {
  assert.equal(HAUL.outboundMs, 180 * SECOND);
  assert.equal(HAUL.tradeMs, 30 * SECOND);
  assert.equal(HAUL.durationMs, 390 * SECOND);
  assert.equal(HAUL.capacity, 600);
});

test("A Courier can't mine, and a barge can't haul", () => {
  const state = gameWithCourier();
  assert.equal(startMiningJob(state, "ship-2", "inner_belt", START), null);
  assert.equal(startHaulJob(state, "ship-1", START), null);
});

test("Full loads: with 599 t the Courier waits; at 600 t it leaves", () => {
  const state = gameWithCourier("full");
  state.inventory.iron_ore = 599;
  const job = startHaulJob(state, "ship-2", START);
  assert.equal(job.status, "waiting");
  assert.equal(state.inventory.iron_ore, 599);   // nothing loaded

  state.inventory.iron_ore = 600;
  processJobs(state, START + SECOND);
  assert.equal(job.status, "travelling");
  assert.deepEqual(job.cargo, { iron_ore: 600 });
  assert.equal(state.inventory.iron_ore, 0);
});

test("Loading takes the most valuable ore first (nickel before iron)", () => {
  const state = createNewGame();
  state.inventory.iron_ore = 1000;
  state.inventory.nickel_ore = 250;
  const cargo = loadCargo(state, 600, "full");
  assert.deepEqual(cargo, { nickel_ore: 250, iron_ore: 350 });
  assert.equal(state.inventory.nickel_ore, 0);
  assert.equal(state.inventory.iron_ore, 650);
});

test("Constant runs: leaves with whatever there is (50 t)", () => {
  const state = gameWithCourier("constant");
  state.inventory.iron_ore = 50;
  const job = startHaulJob(state, "ship-2", START);
  assert.equal(job.status, "travelling");
  assert.deepEqual(job.cargo, { iron_ore: 50 });
});

test("Constant runs still wait when the hold is empty", () => {
  const state = gameWithCourier("constant");
  const job = startHaulJob(state, "ship-2", START);
  assert.equal(job.status, "waiting");
});

test("Paid at the END of trading: 4,800 cr and 108 Trade XP for 600 t iron", () => {
  const state = gameWithCourier();
  state.inventory.iron_ore = 600;
  startHaulJob(state, "ship-2", START);
  const tradeXpBefore = state.skills.trade.xp;

  processJobs(state, START + HAUL.outboundMs + HAUL.tradeMs - 1);
  assert.equal(state.credits, 0);                // still selling

  const results = processJobs(state, START + HAUL.outboundMs + HAUL.tradeMs);
  assert.equal(state.credits, 4800);
  assert.equal(state.skills.trade.xp - tradeXpBefore, 108);
  assert.equal(results[0].kind, "haul");
  assert.deepEqual(results[0].cargo, { iron_ore: 600 });
});

test("Phases read outbound, trading, returning, then waiting at home", () => {
  const state = gameWithCourier();
  state.inventory.iron_ore = 600;
  const job = startHaulJob(state, "ship-2", START);
  assert.equal(getJobPhase(job, START + 1).phase, "outbound");
  assert.equal(getJobPhase(job, START + HAUL.outboundMs + 1).phase, "trading");
  assert.equal(getJobPhase(job, START + HAUL.outboundMs + HAUL.tradeMs + 1).phase, "returning");

  processJobs(state, START + HAUL.durationMs);   // docks, hold empty
  assert.equal(job.status, "waiting");
  assert.equal(getJobPhase(job, START + HAUL.durationMs).phase, "waiting");
  assert.equal(getJobProgress(job, START + HAUL.durationMs), 0);
});

test("Back home, it reloads and leaves straight away if ore is waiting", () => {
  const state = gameWithCourier();
  state.inventory.iron_ore = 1200;               // two loads
  const job = startHaulJob(state, "ship-2", START);
  processJobs(state, START + HAUL.durationMs);
  assert.equal(job.status, "travelling");
  assert.equal(job.startedAt, START + HAUL.durationMs);
  assert.equal(state.inventory.iron_ore, 0);
});

test("Recall before selling puts the cargo back in the home hold", () => {
  const state = gameWithCourier();
  state.inventory.iron_ore = 600;
  const job = startHaulJob(state, "ship-2", START);
  cancelJob(state, job.id);
  assert.equal(state.inventory.iron_ore, 600);
  assert.equal(state.jobs.length, 0);
});

test("Recall after selling keeps the money and returns nothing", () => {
  const state = gameWithCourier();
  state.inventory.iron_ore = 600;
  const job = startHaulJob(state, "ship-2", START);
  processJobs(state, START + HAUL.outboundMs + HAUL.tradeMs);   // sold
  cancelJob(state, job.id);
  assert.equal(state.credits, 4800);
  assert.equal(state.inventory.iron_ore, 0);
});

test("Switching a waiting Courier to constant runs sends it off", () => {
  const state = gameWithCourier("full");
  state.inventory.iron_ore = 100;
  const job = startHaulJob(state, "ship-2", START);
  assert.equal(job.status, "waiting");
  state.ships[1].haulMode = "constant";
  processJobs(state, START + SECOND);
  assert.equal(job.status, "travelling");
  assert.deepEqual(job.cargo, { iron_ore: 100 });
});

test("Two Couriers waiting for ore: the one bought first loads first", () => {
  const state = gameWithCourier("full");
  state.credits = getShipPrice(state, "courier");
  buyShip(state, "courier");                     // ship-3
  const first = startHaulJob(state, "ship-2", START);
  const second = startHaulJob(state, "ship-3", START);
  state.inventory.iron_ore = 600;                // only one load
  processJobs(state, START + SECOND);
  assert.equal(first.status, "travelling");
  assert.equal(second.status, "waiting");
});

test("In time order: a full-load Courier leaves on the 5th Prospector trip", () => {
  // One Prospector brings 120 t iron every 2m 30s, so the 600 t
  // for a full load are home after exactly 5 trips (12m 30s).
  const state = gameWithCourier("full");
  startMiningJob(state, "ship-1", "inner_belt", START);
  const haul = startHaulJob(state, "ship-2", START);

  processJobs(state, START + TRIP * 5 - 1);
  assert.equal(haul.status, "waiting");

  // One jump to a minute after that: it must have left at
  // 12m 30s exactly, not at the end of the jump.
  processJobs(state, START + TRIP * 5 + MINUTE);
  assert.equal(haul.startedAt, START + TRIP * 5);

  // One jump to 30 minutes: by then it has sold, come home
  // (19m), waited, and left again with the next 600 t -
  // ready on the 10th Prospector trip, at 25m exactly.
  processJobs(state, START + 30 * MINUTE);
  assert.equal(haul.startedAt, START + TRIP * 10);
});

test("Barges + Courier: ticking for 2 hours equals one 2-hour jump", () => {
  // The big one: this is what makes offline hauling fair.
  const setup = () => {
    const state = gameWithCourier("full");
    state.credits = 1_000_000;
    buyShip(state, "prospector");                // ship-3
    buyShip(state, "prospector");                // ship-4
    state.credits = 0;                           // count only what's earned
    startMiningJob(state, "ship-1", "inner_belt", START);
    startMiningJob(state, "ship-3", "inner_belt", START + 7 * SECOND);
    startMiningJob(state, "ship-4", "inner_belt", START + 61 * SECOND);
    startHaulJob(state, "ship-2", START);
    return state;
  };
  const ticking = setup();
  const jumping = setup();

  for (let t = 0; t <= 2 * HOUR; t += 250) {
    processJobs(ticking, START + t);
  }
  processJobs(jumping, START + 2 * HOUR);

  assert.equal(ticking.credits, jumping.credits);
  assert.equal(ticking.inventory.iron_ore, jumping.inventory.iron_ore);
  assert.equal(ticking.skills.trade.xp, jumping.skills.trade.xp);
  assert.equal(ticking.skills.mining.xp, jumping.skills.mining.xp);
  assert.deepEqual(ticking.jobs, jumping.jobs);
  assert.ok(jumping.credits > 0, "the Courier should have sold something");
});

test("Offline: an hour away with a barge and a Courier sells at the hub", () => {
  const state = gameWithCourier("full");
  startMiningJob(state, "ship-1", "inner_belt", START);
  startHaulJob(state, "ship-2", START);
  state.lastSavedAt = START;
  const report = applyOfflineProgress(state, START + HOUR);
  const haul = report.results.find((r) => r.kind === "haul");
  // 24 Prospector trips = 2,880 t iron. Full loads leave at 12m 30s,
  // 25m, 37m 30s and 50m. Each sells 3m 30s after leaving, so
  // the 4th sells at 53m 30s - inside the hour. 4 x 600 = 2,400 t.
  assert.equal(haul.tonnes, 2400);
  assert.equal(haul.credits, 2400 * 8);
  assert.equal(haul.trips, 4);
  assert.equal(state.inventory.iron_ore, 2880 - 2400);  // 480 t still at home
});

test("With 3 Prospectors, a Courier earns more than a 4th Prospector would", () => {
  // Same command point, two ways to spend it.
  const ironPerHour = 3 * PROSPECTOR.orePerTrip * (HOUR / TRIP);    // 864
  const courierGain = ironPerHour * (ITEMS.iron_ore.hubPrice - ITEMS.iron_ore.sellPrice);
  const fourthProspector = PROSPECTOR.orePerTrip * (HOUR / TRIP) * ITEMS.iron_ore.sellPrice;
  const runsNeeded = ironPerHour / HAUL.capacity;                    // 14.4 per hour
  const runsPossible = HOUR / HAUL.durationMs;                        // 9.2 per hour
  assert.ok(courierGain > fourthProspector, `${courierGain} vs ${fourthProspector}`);
  // ...but one Courier can't keep up with 3 Prospectors' ore
  // alone, so a second Courier (or a Hauler) has a real job too.
  assert.ok(runsNeeded > runsPossible);
});

test("A version 5 save moves to tonnes: credits and ore x10, XP unchanged", () => {
  const oldSave = {
    version: 5,
    credits: 2600,
    inventory: { iron_ore: 30, nickel_ore: 4 },
    nextShipNumber: 3,
    commandUpgrades: 0,
    skills: { mining: { xp: 900 }, trade: { xp: 180 } },
    ships: [
      { id: "ship-1", name: "Rusty Pick", type: "prospector", destination: "inner_belt" },
      { id: "ship-2", name: "Second Wind", type: "courier", haulMode: "full" },
    ],
    // A Courier caught mid-run with 60 old units on board
    jobs: [{ id: "job-x", type: "haul", shipId: "ship-2", status: "travelling",
             startedAt: START, outboundMs: 180000, tradeMs: 30000, returnMs: 180000,
             durationMs: 390000, cargo: { nickel_ore: 20, iron_ore: 40 }, sold: false, repeat: true }],
    lastSavedAt: START,
  };
  const state = parseSave(JSON.stringify(oldSave));
  assert.equal(state.version, SAVE_VERSION);
  assert.equal(state.credits, 26000);
  assert.deepEqual(state.inventory, { iron_ore: 300, nickel_ore: 40 });
  assert.deepEqual(state.jobs[0].cargo, { nickel_ore: 200, iron_ore: 400 });
  assert.deepEqual(state.skills, { mining: { xp: 900 }, trade: { xp: 180 }, refining: { xp: 0 } });
});

test("A bogus 'version 5' save with no inventory is refused, not a crash", () => {
  assert.equal(importSave('{"version": 5, "credits": 1}').ok, false);
});


// =============================================================
// SAVE EXPORT AND IMPORT
// =============================================================

// A game with a bit of everything in it, to export.
function busyGame() {
  const state = gameWithCourier("constant");
  state.inventory.iron_ore = 370;
  state.skills.mining.xp = 1234.5;
  startMiningJob(state, "ship-1", "inner_belt", START);
  return state;
}

test("Export makes one line starting DAMOCLES:", () => {
  const text = exportSave(busyGame());
  assert.ok(text.startsWith("DAMOCLES:"));
  assert.ok(!text.includes("\n"));
});

test("Export then import gives back the same game", () => {
  const original = busyGame();
  const text = exportSave(original);
  const result = importSave(text);
  assert.equal(result.ok, true);
  assert.deepEqual(result.state, original);
});

test("Spaces and line breaks around a pasted save are ignored", () => {
  const text = exportSave(busyGame());
  assert.equal(importSave("  \n" + text + "\n  ").ok, true);
});

test("An empty paste is refused with a helpful reason", () => {
  assert.deepEqual(importSave("   "), { ok: false, reason: "Paste a save first." });
});

test("Random text is refused", () => {
  const result = importSave("hello commander");
  assert.equal(result.ok, false);
  assert.match(result.reason, /doesn't look like/);
});

test("A save cut short while copying is refused as damaged", () => {
  const text = exportSave(busyGame());
  const result = importSave(text.slice(0, text.length - 40));
  assert.equal(result.ok, false);
  assert.match(result.reason, /damaged/);
});

test("JSON that isn't a save (no ships, no credits) is refused", () => {
  const result = importSave('{"version": 5, "hello": "world"}');
  assert.equal(result.ok, false);
});

test("A save from a newer version of the game is refused", () => {
  const future = busyGame();
  future.version = 99;
  const result = importSave("DAMOCLES:" + btoa(JSON.stringify(future)));
  assert.equal(result.ok, false);
  assert.match(result.reason, /newer version/);
});

test("Plain JSON from the browser's own storage imports too", () => {
  const state = busyGame();
  assert.equal(importSave(JSON.stringify(state)).ok, true);
});

test("An old version 1 save imports and upgrades to the latest version", () => {
  const oldSave = {
    version: 1, credits: 50, inventory: { iron_ore: 10 },
    ships: [{ id: "ship-1", name: "Rusty Pick", type: "prospector" }],
    jobs: [], lastSavedAt: START,
  };
  const result = importSave("DAMOCLES:" + btoa(JSON.stringify(oldSave)));
  assert.equal(result.ok, true);
  assert.equal(result.state.version, SAVE_VERSION);
  assert.equal(result.state.credits, 500);
});

test("Importing never changes the game it came from", () => {
  const original = busyGame();
  const text = exportSave(original);
  const copy = importSave(text).state;
  copy.credits = 999_999;
  assert.notEqual(original.credits, 999_999);
});

// =============================================================
// RENAMING SHIPS
// =============================================================

test("A ship can be renamed", () => {
  const state = createNewGame();
  const result = renameShip(state, "ship-1", "Ore Else");
  assert.deepEqual(result, { ok: true, oldName: "Rusty Pick", name: "Ore Else" });
  assert.equal(state.ships[0].name, "Ore Else");
});

test("Extra spaces are tidied: '  Lucky    Strike ' becomes 'Lucky Strike'", () => {
  const state = createNewGame();
  renameShip(state, "ship-1", "  Lucky    Strike ");
  assert.equal(state.ships[0].name, "Lucky Strike");
});

test("An empty (or all-spaces) name is refused", () => {
  const state = createNewGame();
  assert.equal(renameShip(state, "ship-1", "    ").ok, false);
  assert.equal(state.ships[0].name, "Rusty Pick");
});

test("Names over 24 characters are refused; exactly 24 is fine", () => {
  const state = createNewGame();
  assert.equal(renameShip(state, "ship-1", "A".repeat(25)).ok, false);
  assert.equal(renameShip(state, "ship-1", "A".repeat(24)).ok, true);
});

test("Two ships can't share a name (capitals don't count as different)", () => {
  const state = createNewGame();
  state.credits = getShipPrice(state, "prospector");
  buyShip(state, "prospector");                       // "Second Wind"
  const result = renameShip(state, "ship-1", "SECOND WIND");
  assert.equal(result.ok, false);
  assert.match(result.reason, /already has that name/);
});

test("Re-typing a ship's own name in different capitals is allowed", () => {
  const state = createNewGame();
  assert.equal(renameShip(state, "ship-1", "RUSTY PICK").ok, true);
});

test("A renamed ship keeps its name through export and import", () => {
  const state = createNewGame();
  renameShip(state, "ship-1", "Grit & <Gravel>");
  const back = importSave(exportSave(state)).state;
  assert.equal(back.ships[0].name, "Grit & <Gravel>");
});

// =============================================================
// RECALL ("come home") AND RESUME
// A Prospector trip: 45s out, 60s mining, 45s back (150s), 120 t.
// =============================================================

test("Recall while flying out: turns back, docks after the same time, no ore", () => {
  const state = createNewGame();
  const job = startMiningJob(state, "ship-1", "inner_belt", START);
  const recall = recallJob(state, job.id, START + 30 * SECOND);
  assert.equal(recall.mode, "turnback");
  assert.equal(recall.docksInMs, 30 * SECOND);       // flew out 30s, flies back 30s

  processJobs(state, START + 60 * SECOND - 1);
  assert.equal(state.jobs.length, 1);                // still on its way home
  const results = processJobs(state, START + 60 * SECOND);
  assert.equal(state.jobs.length, 0);                // docked and standing by
  assert.equal(state.inventory.iron_ore, 0);
  assert.equal(results[0].kind, "docked");
});

test("Recall halfway through mining: leaves with half a hold (60 t)", () => {
  const state = createNewGame();
  const job = startMiningJob(state, "ship-1", "inner_belt", START);
  const recall = recallJob(state, job.id, START + 75 * SECOND);   // 30s into 60s mining
  assert.equal(recall.mode, "leftEarly");
  assert.equal(recall.amount, 60);
  assert.equal(recall.docksInMs, 45 * SECOND);       // the normal flight home

  processJobs(state, START + 120 * SECOND);
  assert.equal(state.inventory.iron_ore, 60);
  assert.equal(state.skills.mining.xp, 6);           // 60 t ÷ 10
  assert.equal(state.jobs.length, 0);
});

test("Recall on the way home: full hold at the normal time, then stays docked", () => {
  const state = createNewGame();
  const job = startMiningJob(state, "ship-1", "inner_belt", START);
  const recall = recallJob(state, job.id, START + 120 * SECOND);
  assert.equal(recall.mode, "finishing");

  processJobs(state, START + 150 * SECOND - 1);
  assert.equal(state.inventory.iron_ore, 0);         // not home yet - no shortcut
  processJobs(state, START + HOUR);
  assert.equal(state.inventory.iron_ore, 120);       // one trip only
  assert.equal(state.jobs.length, 0);
});

test("No exploit: recalling never gets ore home sooner than waiting", () => {
  // Try recalling at every second of a trip. However it's timed,
  // nothing may arrive before the trip's normal end.
  for (let t = 0; t <= 150; t++) {
    const state = createNewGame();
    const job = startMiningJob(state, "ship-1", "inner_belt", START);
    recallJob(state, job.id, START + t * SECOND);
    // Before the normal end of the trip, a recall may have brought
    // home a PART load, but never a full one.
    processJobs(state, START + 150 * SECOND - 1);
    assert.ok(state.inventory.iron_ore < 120, `recalled at ${t}s: full hold arrived early`);
    // ...and never more ore than a normal trip
    processJobs(state, START + HOUR);
    assert.ok(state.inventory.iron_ore <= 120);
  }
});

test("No exploit: a Courier recalled after selling still flies the 3 minutes home", () => {
  const state = gameWithCourier();
  state.inventory.iron_ore = 1200;                   // enough for two loads
  const job = startHaulJob(state, "ship-2", START);
  processJobs(state, START + HAUL.outboundMs + HAUL.tradeMs);   // sold
  const recall = recallJob(state, job.id, START + HAUL.outboundMs + HAUL.tradeMs);
  assert.equal(recall.docksInMs, HAUL.returnMs);     // 3 minutes, not instant

  // Can't be sent out again until it actually docks.
  assert.equal(startHaulJob(state, "ship-2", START + HAUL.outboundMs + HAUL.tradeMs), null);
  processJobs(state, START + HAUL.durationMs);
  assert.equal(state.jobs.length, 0);                // docked, standing by
  assert.equal(state.inventory.iron_ore, 600);       // second load untouched
});

test("Courier recalled on the way out: no sale, cargo back only when it docks", () => {
  const state = gameWithCourier();
  state.inventory.iron_ore = 600;
  const job = startHaulJob(state, "ship-2", START);
  recallJob(state, job.id, START + 60 * SECOND);     // 1 minute out
  processJobs(state, START + 2 * MINUTE - 1);
  assert.equal(state.inventory.iron_ore, 0);         // still on board, flying back
  processJobs(state, START + 2 * MINUTE);
  assert.equal(state.inventory.iron_ore, 600);       // unloaded at home
  assert.equal(state.credits, 0);
  assert.equal(state.jobs.length, 0);
});

test("Courier recalled while selling: finishes the sale, then flies home", () => {
  const state = gameWithCourier();
  state.inventory.iron_ore = 600;
  const job = startHaulJob(state, "ship-2", START);
  recallJob(state, job.id, START + HAUL.outboundMs + 10 * SECOND);
  processJobs(state, START + HAUL.durationMs);
  assert.equal(state.credits, 4800);
  assert.equal(state.jobs.length, 0);
});

test("Courier waiting at the dock stands down straight away", () => {
  const state = gameWithCourier();
  const job = startHaulJob(state, "ship-2", START);  // nothing to load: waiting
  assert.equal(recallJob(state, job.id, START + SECOND).mode, "stoodDown");
  assert.equal(state.jobs.length, 0);
});

test("Resume after turning back: heads out again, losing only the time spent", () => {
  const state = createNewGame();
  const job = startMiningJob(state, "ship-1", "inner_belt", START);
  recallJob(state, job.id, START + 30 * SECOND);     // turn back at 30s out
  resumeJob(state, job.id, START + 40 * SECOND);     // 10s later: 20s out
  // It's 20s out, so the trip ends 130s from now... i.e. 20s late.
  processJobs(state, START + 170 * SECOND - 1);
  assert.equal(state.inventory.iron_ore, 0);
  processJobs(state, START + 170 * SECOND);
  assert.equal(state.inventory.iron_ore, 120);       // a full, normal trip
  assert.equal(state.jobs.length, 1);                // and it keeps working
});

test("Resume after leaving the field early: part-load home, then normal trips", () => {
  const state = createNewGame();
  const job = startMiningJob(state, "ship-1", "inner_belt", START);
  recallJob(state, job.id, START + 75 * SECOND);     // 60 t, docks at 120s
  resumeJob(state, job.id, START + 80 * SECOND);
  processJobs(state, START + 120 * SECOND);
  assert.equal(state.inventory.iron_ore, 60);
  assert.equal(job.durationMs, 150 * SECOND);        // next trip is normal again
  processJobs(state, START + 270 * SECOND);
  assert.equal(state.inventory.iron_ore, 180);       // + one full trip
});

test("Resume while finishing: nothing lost, keeps repeating", () => {
  const state = createNewGame();
  const job = startMiningJob(state, "ship-1", "inner_belt", START);
  recallJob(state, job.id, START + 120 * SECOND);
  resumeJob(state, job.id, START + 125 * SECOND);
  processJobs(state, START + 300 * SECOND);
  assert.equal(state.inventory.iron_ore, 240);       // exactly as if never recalled
});

test("Recalling twice does nothing the second time", () => {
  const state = createNewGame();
  const job = startMiningJob(state, "ship-1", "inner_belt", START);
  recallJob(state, job.id, START + 30 * SECOND);
  assert.equal(recallJob(state, job.id, START + 31 * SECOND), null);
});

test("Recall right as it leaves: docks at once with nothing", () => {
  const state = createNewGame();
  const job = startMiningJob(state, "ship-1", "inner_belt", START);
  recallJob(state, job.id, START);
  assert.equal(getJobProgress(job, START), 1);       // no dividing by zero
  processJobs(state, START);
  assert.equal(state.jobs.length, 0);
});

test("A recalled ship's trip survives a save and time away", () => {
  const state = createNewGame();
  const job = startMiningJob(state, "ship-1", "inner_belt", START);
  recallJob(state, job.id, START + 75 * SECOND);
  state.lastSavedAt = START + 75 * SECOND;
  const loaded = importSave(exportSave(state)).state;
  loaded.lastSavedAt = START + 75 * SECOND;          // (export stamps "now")
  applyOfflineProgress(loaded, START + HOUR);
  assert.equal(loaded.inventory.iron_ore, 60);       // just the part-load
  assert.equal(loaded.jobs.length, 0);
});

// =============================================================
// ROLE GROUPS on the Command screen (js/fleet-groups.js)
// The heading summaries must say exactly what each group's
// ships are doing, because a collapsed group only shows that.
// =============================================================

// A game with three Prospectors and a Courier (ship-4), for
// the group tests. Built by buying, so it uses the real rules.
function gameWithMixedFleet() {
  const state = gameWithCourier();          // ship-1 Prospector, ship-2 Courier
  state.credits = 100_000;
  buyShip(state, "prospector");             // ship-3
  return state;
}

test("A new game has one group: Mining, 1 ship docked", () => {
  const state = createNewGame();
  const groups = getRoleGroups(state, START);
  assert.equal(groups.length, 1);           // no empty Freight heading
  assert.equal(groups[0].name, "Mining");
  assert.equal(describeGroup(groups[0]), "1 ship · 1 docked");
});

test("Ships are sorted into Mining then Freight, in the order they were bought", () => {
  const state = gameWithMixedFleet();
  const groups = getRoleGroups(state, START);
  assert.deepEqual(groups.map((g) => g.roleId), ["mining", "freight"]);
  assert.deepEqual(groups[0].ships.map((s) => s.id), ["ship-1", "ship-3"]);
  assert.deepEqual(groups[1].ships.map((s) => s.id), ["ship-2"]);
});

test("Summary matches the design doc example: 3 ships, 2 working, 1 docked", () => {
  const state = createNewGame();
  state.credits = 100_000;
  buyShip(state, "prospector");
  buyShip(state, "prospector");
  startMiningJob(state, "ship-1", "inner_belt", START);
  startMiningJob(state, "ship-2", "inner_belt", START);
  const [mining] = getRoleGroups(state, START + SECOND);
  assert.equal(describeGroup(mining), "3 ships · 2 working, 1 docked");
});

test("Each activity is told apart: working, heading home, waiting, docked", () => {
  const state = gameWithMixedFleet();
  startMiningJob(state, "ship-1", "inner_belt", START);
  const recalled = startMiningJob(state, "ship-3", "inner_belt", START);
  recallJob(state, recalled.id, START + 10 * SECOND);
  startHaulJob(state, "ship-2", START);     // empty hold: waits for ore

  const now = START + 20 * SECOND;
  assert.equal(getShipActivity(state, state.ships[0], now), "working");
  assert.equal(getShipActivity(state, state.ships[2], now), "recalled");
  assert.equal(getShipActivity(state, state.ships[1], now), "waiting");

  const [mining, freight] = getRoleGroups(state, now);
  assert.equal(describeGroup(mining), "2 ships · 1 working, 1 heading home");
  assert.equal(describeGroup(freight), "1 ship · 1 waiting for ore");
});

test("Mining repeats, so a ship stays 'working' until recalled and docked", () => {
  const state = createNewGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  processJobs(state, START + TRIP);          // one trip done: it heads straight out again
  assert.equal(describeGroup(getRoleGroups(state, START + TRIP)[0]), "1 ship · 1 working");

  recallJob(state, state.jobs[0].id, START + TRIP + SECOND);
  processJobs(state, START + 2 * TRIP);      // long enough to fly home
  assert.equal(describeGroup(getRoleGroups(state, START + 2 * TRIP)[0]), "1 ship · 1 docked");
});

test("Selling the only freighter removes the Freight group", () => {
  const state = gameWithMixedFleet();
  sellShip(state, "ship-2");
  assert.deepEqual(getRoleGroups(state, START).map((g) => g.roleId), ["mining"]);
});

// =============================================================
// THE BALANCE FILE (data/balance.js, written by the sheet)
// Numbers come from the balance sheet; words from content.js.
// These check the two files still fit together, so a ship added
// to one but not the other is caught here, not mid-game.
// =============================================================

// The IDs in an object, sorted so the order doesn't matter.
const idsOf = (object) => Object.keys(object).sort();

test("content.js and balance.js list the same items, ships, fields and hull sizes", () => {
  assert.deepEqual(idsOf(ITEMS), idsOf(BALANCE.items));
  assert.deepEqual(idsOf(SHIP_TYPES), idsOf(BALANCE.ships));
  assert.deepEqual(idsOf(FIELDS), idsOf(BALANCE.fields));
  assert.deepEqual(idsOf(HULL_SIZES), idsOf(BALANCE.hullSizes));
  assert.deepEqual(idsOf(RECIPES), idsOf(BALANCE.recipes));
});

test("Every ship has the numbers it needs (and barges have a drill)", () => {
  for (const [typeId, ship] of Object.entries(SHIP_TYPES)) {
    for (const key of ["size", "skill", "unlockLevel", "cargoCapacity", "speed"]) {
      assert.ok(ship[key] !== undefined, `${typeId} is missing ${key}`);
    }
    assert.ok(HULL_SIZES[ship.size], `${typeId} has an unknown hull size "${ship.size}"`);
    if (ship.role === "mining") {
      assert.ok(ship.miningRate > 0, `${typeId} is a barge with no mining rate`);
    }
  }
});

test("Every field mines an item that exists", () => {
  for (const [fieldId, field] of Object.entries(FIELDS)) {
    assert.ok(ITEMS[field.yields], `${fieldId} yields unknown item "${field.yields}"`);
  }
});

// =============================================================
// THE REFINERY (js/refinery.js)
// Batches run on the same timeline as the ships, so these use
// processJobs exactly like the mining tests do.
// =============================================================

const IRON_BATCH = RECIPES.iron_bar;                 // 60 t ore -> 30 t bars
const IRON_BATCH_MS = IRON_BATCH.seconds * SECOND;   // at Refining level 1

// A new game that has just reached Mining 8, so the refinery is open.
function gameWithRefinery() {
  const state = createNewGame();
  state.skills.mining.xp = XP_TABLE[REFINERY.openAtMiningLevel];
  return state;
}

// The same, at a chosen Refining level.
function gameAtRefining(level) {
  const state = gameWithRefinery();
  state.skills.refining.xp = XP_TABLE[level];
  return state;
}

test("The refinery is closed until Mining 8: no slots, and recipes can't be set", () => {
  const state = gameWithRefinery();
  state.skills.mining.xp = XP_TABLE[REFINERY.openAtMiningLevel] - 1;   // Mining 7
  assert.equal(isRefineryOpen(state), false);
  assert.equal(getSlotCount(state), 0);
  assert.equal(setRecipe(state, 0, "iron_bar", START), false);
  state.skills.mining.xp += 1;                                       // Mining 8
  assert.equal(isRefineryOpen(state), true);
  assert.equal(getSlotCount(state), 1);
});

test("At Mining 8 the refinery has 1 slot and only the iron bar recipe", () => {
  const state = gameWithRefinery();
  assert.equal(getSlotCount(state), 1);
  assert.equal(isRecipeUnlocked(state, "iron_bar"), true);
  assert.equal(isRecipeUnlocked(state, "nickel_bar"), false);
  assert.equal(isRecipeUnlocked(state, "steel"), false);
});

test("Locked recipes and slots can't be used", () => {
  const state = gameWithRefinery();
  assert.equal(setRecipe(state, 0, "nickel_bar", START), false);   // needs Refining 5
  assert.equal(setRecipe(state, 1, "iron_bar", START), false);     // slot 2 needs Refining 10
  assert.equal(state.jobs.length, 0);
});

test("Slots unlock at Refining 1, 10 and 25; recipes at 1, 5 and 15", () => {
  assert.equal(getSlotCount(gameAtRefining(9)), 1);
  assert.equal(getSlotCount(gameAtRefining(10)), 2);
  assert.equal(getSlotCount(gameAtRefining(25)), 3);
  assert.deepEqual(getSlotUnlocksAtLevel(10), [2]);
  assert.deepEqual(getRecipeUnlocksAtLevel(5), ["nickel_bar"]);
  assert.deepEqual(getRecipeUnlocksAtLevel(15), ["steel"]);
});

test("With no ore, a slot waits; ore arriving starts the batch", () => {
  const state = gameWithRefinery();
  setRecipe(state, 0, "iron_bar", START);
  assert.equal(getRefineJob(state, 0).status, "waiting");

  state.inventory.iron_ore = 60;
  processJobs(state, START + SECOND);
  assert.equal(getRefineJob(state, 0).status, "working");
  assert.equal(state.inventory.iron_ore, 0);           // taken at the start of the batch
});

test("One batch: 60 t iron ore becomes 30 t iron bars and 8 Refining XP after 60s", () => {
  const state = gameWithRefinery();
  state.inventory.iron_ore = 60;
  setRecipe(state, 0, "iron_bar", START);

  processJobs(state, START + IRON_BATCH_MS - 1);       // a moment too soon
  assert.equal(state.inventory.iron_bar, 0);

  processJobs(state, START + IRON_BATCH_MS);
  assert.equal(state.inventory.iron_bar, 30);
  assert.equal(state.skills.refining.xp, 8);
  assert.equal(getRefineJob(state, 0).status, "waiting");   // out of ore now
});

test("Batches run back to back: 150 t ore makes 2 batches in 2 minutes, 30 t left over", () => {
  const state = gameWithRefinery();
  state.inventory.iron_ore = 150;
  setRecipe(state, 0, "iron_bar", START);
  processJobs(state, START + 2 * IRON_BATCH_MS);
  assert.equal(state.inventory.iron_bar, 60);
  assert.equal(state.inventory.iron_ore, 30);
});

test("Stopping mid-batch gives the ore back and earns no XP", () => {
  const state = gameWithRefinery();
  state.inventory.iron_ore = 60;
  setRecipe(state, 0, "iron_bar", START);
  processJobs(state, START + 30 * SECOND);
  setRecipe(state, 0, null, START + 30 * SECOND);
  assert.equal(state.inventory.iron_ore, 60);
  assert.equal(state.inventory.iron_bar, 0);
  assert.equal(state.skills.refining.xp, 0);
  assert.equal(getRefineJob(state, 0), undefined);
});

test("Steel needs both ores: it waits until the nickel arrives", () => {
  const state = gameAtRefining(15);
  state.inventory.iron_ore = 60;
  setRecipe(state, 0, "steel", START);
  assert.equal(getRefineJob(state, 0).status, "waiting");
  state.inventory.nickel_ore = 30;
  processJobs(state, START + SECOND);
  assert.equal(getRefineJob(state, 0).status, "working");
  assert.equal(state.inventory.iron_ore, 0);
  assert.equal(state.inventory.nickel_ore, 0);
});

test("Higher levels are faster: iron bars take 57s at Refining 11 (5% faster)", () => {
  assert.equal(getBatchMs(createNewGame(), "iron_bar"), 60 * SECOND);
  assert.equal(getBatchMs(gameAtRefining(11), "iron_bar"), 57 * SECOND);
});

test("Two slots waiting on the same ore: slot 1 gets first pick", () => {
  const state = gameAtRefining(10);
  setRecipe(state, 1, "iron_bar", START);              // both set up with an empty hold
  setRecipe(state, 0, "iron_bar", START);
  state.inventory.iron_ore = 60;                       // enough for only one batch
  processJobs(state, START + SECOND);
  assert.equal(getRefineJob(state, 0).status, "working");
  assert.equal(getRefineJob(state, 1).status, "waiting");
});

test("The refinery takes its ore before a waiting freighter loads", () => {
  const state = gameWithCourier("full");               // Courier wants 600 t
  state.skills.mining.xp = XP_TABLE[REFINERY.openAtMiningLevel];
  setRecipe(state, 0, "iron_bar", START);
  startHaulJob(state, "ship-2", START);
  state.inventory.iron_ore = 600;
  processJobs(state, START + SECOND);
  assert.equal(getRefineJob(state, 0).status, "working");   // took 60 t first
  assert.equal(getJobForShip(state, "ship-2").status, "waiting");  // 540 t isn't a full load
});

test("Offline: a barge feeds the refinery for an hour, and no ore is lost or made up", () => {
  const state = gameWithRefinery();
  startMiningJob(state, "ship-1", "inner_belt", START);
  setRecipe(state, 0, "iron_bar", START);
  state.lastSavedAt = START;
  applyOfflineProgress(state, START + HOUR);

  // Every tonne mined is either still ore, in the furnace, or became bars (2 t ore -> 1 t bar).
  const mined = 24 * PROSPECTOR.orePerTrip;            // 24 trips in an hour
  const inFurnace = getRefineJob(state, 0).inputs?.iron_ore || 0;
  assert.equal(state.inventory.iron_ore + inFurnace + state.inventory.iron_bar * 2, mined);
  assert.ok(state.inventory.iron_bar >= 1200, "made plenty of bars");
  assert.equal(state.skills.refining.xp, (state.inventory.iron_bar / 30) * 8);
});

test("A batch in the furnace survives saving, and finishes while away", () => {
  const state = gameWithRefinery();
  state.inventory.iron_ore = 60;
  setRecipe(state, 0, "iron_bar", START);
  state.lastSavedAt = START + 10 * SECOND;
  const loaded = importSave(exportSave(state)).state;
  loaded.lastSavedAt = START + 10 * SECOND;            // (export stamps "now")
  applyOfflineProgress(loaded, START + HOUR);
  assert.equal(loaded.inventory.iron_bar, 30);
});

test("Refining and mining results come back separately for the log", () => {
  const state = gameWithRefinery();
  state.inventory.iron_ore = 120;
  setRecipe(state, 0, "iron_bar", START);
  startMiningJob(state, "ship-1", "inner_belt", START);
  const results = processJobs(state, START + TRIP);
  const refine = results.find((r) => r.kind === "refine");
  assert.equal(refine.trips, 2);                       // two batches, added together
  assert.equal(refine.amount, 60);
  assert.ok(results.find((r) => r.kind === "mining"));
});

test("Every recipe uses items that exist", () => {
  for (const [recipeId, recipe] of Object.entries(RECIPES)) {
    assert.ok(ITEMS[recipe.output], `${recipeId} makes unknown item "${recipe.output}"`);
    for (const itemId of Object.keys(recipe.inputs)) {
      assert.ok(ITEMS[itemId], `${recipeId} uses unknown item "${itemId}"`);
    }
  }
});

// -------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);   // tells the computer "something went wrong"
}
