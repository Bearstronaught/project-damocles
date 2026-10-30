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
import { readFileSync, readdirSync } from "node:fs";
import { VERSION } from "../js/version.js";
import { SHIP_TYPES, ITEMS, COMMAND, FIELDS, HULL_SIZES, HUB } from "../data/content.js";
import { BALANCE } from "../data/balance.js";
import { createNewGame, SAVE_VERSION } from "../js/state.js";
import { getMiningXpShare, startMiningJob, startHaulJob, getJobForShip, processJobs, cancelJob, recallJob, resumeJob, getJobProgress, getJobPhase, getTripPlan, getHaulPlan, loadCargo } from "../js/jobs.js";
import { sellAll, sellEverything, getCargoValue, sellAtHub, getTradeXp, getPrice } from "../js/trade.js";
import { parseSave, applyOfflineProgress, exportSave, importSave } from "../js/save.js";
import { advanceTo } from "../js/simulation.js";
import { createClock, gameNow, setSpeed, jumpAhead, SPEEDS } from "../js/clock.js";
import { devSetLevel, devAddCredits, devAddGoods, devSetSpeed, devJumpHour, HOUR_MS } from "../js/playtest.js";
import { getShipStats, getPartGrade, getNextUpgrade, canBuyShipUpgrade, buyShipUpgrade, getHullParts, getUpgradeName, getShipUpgradeUnlocksAtLevel, getShipGrades, getPendingRefits } from "../js/ship-upgrades.js";
import { getMiningDrillPerk, getTradeHubPerk, getLevelPerk } from "../js/skills.js";
import { SHIP_UPGRADES } from "../data/content.js";
import { getShipArt } from "../js/art.js";
import { getBond, getSellable, getBondedInHold, setBond } from "../js/bonded.js";
import { isOwned, getEffect, canBuyIndustryUpgrade, buyIndustryUpgrade, getUpgradeLines } from "../js/upgrades.js";
import { addItemWithCarry } from "../js/state.js";
import { UPGRADES } from "../data/content.js";
import { getMaxSlots, getBatchOutput } from "../js/refinery.js";
import { startScoutJob, getScoutPlan, getTargetStatus, chooseNextTarget, rollFor, isExplorationOpen, DEEP_SCAN_ID } from "../js/exploration.js";
import { SURVEY_TARGETS, DEEP_SCAN, CONTRACT_KINDS, CONTRACTS, CONTRACT_FACTIONS, REPUTATION_TIERS } from "../data/content.js";
import { isBoardOpen, getTier, getReputation, getSubjects, getProgress, canDeliver, deliverContract, discardContract, checkContracts, charterShip, canCharter, getCharter, getContractXp, getSlotCount as getBoardSlotCount } from "../js/contracts.js";
import { getMaxOrderBatches, addStandingOrder, removeStandingOrder, getStandingOrders } from "../js/workshop.js";
import { XP_TABLE, getLevelForXp, getLevel, getLevelProgress, addXp, isShipTypeUnlocked, MAX_LEVEL } from "../js/skills.js";
import { canBuyShip, buyShip, canSellShip, sellShip, getSellValue, renameShip, getShipPrice } from "../js/shipyard.js";
import { getCommandCapacity, getCommandUsed, getNextUpgradeCost, buyUpgrade } from "../js/command.js";
import { isFieldUnlocked } from "../js/skills.js";
import { getRoleGroups, describeGroup, getShipActivity } from "../js/fleet-groups.js";
import { setRecipe, getRefineJob, isRefineryOpen, getSlotCount, getBatchMs, isRecipeUnlocked, getRecipeUnlocksAtLevel, getSlotUnlocksAtLevel } from "../js/refinery.js";
import { RECIPES, REFINERY, WORKSHOP_RECIPES, WORKSHOP } from "../data/content.js";
import { isWorkshopOpen, getWorkshopSlotCount, getQueueLimit, isWorkshopRecipeUnlocked, getWorkshopBatchMs, getWorkshopJob, addOrder, cancelOrder } from "../js/workshop.js";
import { BALANCE as BALANCE_FILE } from "../data/balance.js";

const SECOND = 1000;                 // milliseconds in a second
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const START = 1_000_000_000_000;     // a fixed pretend "start" time

// -------------------------------------------------------------
// newGame()
// A new game for a test. createNewGame gives every save its own
// random seed for deep scan finds (exploration.js), so two new
// games would never be identical; tests that compare two games
// need them to start the same, so they all share one seed here.
// -------------------------------------------------------------
function newGame() {
  const state = createNewGame();
  state.exploration.seed = 12345;
  return state;
}

// The two ships' trips to the Inner Belt, for a brand new player
// (level 1, no upgrades), straight from the data.
const FRESH = newGame();
const PROSPECTOR = getTripPlan(FRESH, "prospector", "inner_belt");
const EXCAVATOR = getTripPlan(FRESH, "excavator", "inner_belt");
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
  const state = newGame();
  state.skills.mining.xp = XP_TABLE[10];
  state.credits = credits;
  return state;
}


// =============================================================
// THE NEW PACING (today's starting numbers)
// These DO check exact numbers, on purpose: they record the
// balance as it stands. If you change content.js, update them.
// =============================================================

test("Prospector trip: 45s out, 1m mining, 45s back, 6s unloading = 2m 36s, 120 t ore, 20 XP", () => {
  assert.equal(PROSPECTOR.outboundMs, 45 * SECOND);
  assert.equal(PROSPECTOR.miningMs, 60 * SECOND);
  assert.equal(PROSPECTOR.returnMs, 45 * SECOND);
  assert.equal(PROSPECTOR.unloadMs, 6 * SECOND);     // 120 t at 20 t/s (small hull)
  assert.equal(PROSPECTOR.durationMs, 156 * SECOND);
  assert.equal(PROSPECTOR.orePerTrip, 120);
  assert.equal(PROSPECTOR.xpPerTrip, 20);           // 120 t ÷ 6 (Dan, 30 Oct: was ÷ 10)
});

test("Excavator trip: 1m out (slower drive), 2m mining, 1m back, 12s unloading = 4m 12s, 480 t ore", () => {
  assert.equal(EXCAVATOR.outboundMs, 60 * SECOND);
  assert.equal(EXCAVATOR.miningMs, 120 * SECOND);
  assert.equal(EXCAVATOR.unloadMs, 12 * SECOND);     // 480 t at 40 t/s (medium hull: bigger doors)
  assert.equal(EXCAVATOR.durationMs, 252 * SECOND);
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
  const state = newGame();
  assert.equal(state.credits, 0);
  assert.equal(state.inventory.iron_ore, 0);
  assert.equal(state.ships.length, 1);
  assert.equal(state.jobs.length, 0);
});

test("Nothing is mined until the ship gets home", () => {
  const state = newGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  processJobs(state, START + TRIP - 1);
  assert.equal(state.inventory.iron_ore, 0);
});

test("One finished trip brings back a full hold", () => {
  const state = newGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  processJobs(state, START + TRIP);
  assert.equal(state.inventory.iron_ore, PROSPECTOR.orePerTrip);
});

test("Phases run in order: outbound, mining, returning, then unloading", () => {
  const state = newGame();
  const job = startMiningJob(state, "ship-1", "inner_belt", START);
  assert.equal(getJobPhase(job, START + 10 * SECOND).phase, "outbound");
  assert.equal(getJobPhase(job, START + PROSPECTOR.outboundMs + 1).phase, "mining");
  assert.equal(getJobPhase(job, START + TRIP - PROSPECTOR.unloadMs - 1).phase, "returning");
  assert.equal(getJobPhase(job, START + TRIP - 1).phase, "unloading");
});

test("Phase fills: halfway through mining = outbound full, mining half, return and unloading empty", () => {
  const state = newGame();
  const job = startMiningJob(state, "ship-1", "inner_belt", START);
  const halfwayMining = START + PROSPECTOR.outboundMs + PROSPECTOR.miningMs / 2;
  const phase = getJobPhase(job, halfwayMining);
  assert.deepEqual(phase.fills, [1, 0.5, 0, 0]);
  assert.equal(phase.msLeftInPhase, PROSPECTOR.miningMs / 2);
});

test("Leftover time carries into the next trip (2.5 trips = 2 paid, next trip halfway)", () => {
  const state = newGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  processJobs(state, START + TRIP * 2.5);
  assert.equal(state.inventory.iron_ore, PROSPECTOR.orePerTrip * 2);
  assert.equal(state.jobs.length, 1);
  assert.equal(getJobProgress(state.jobs[0], START + TRIP * 2.5), 0.5);
});

test("Ticking often gives the same result as one big jump", () => {
  // This is what makes offline progress fair: 4 small checks a
  // second for an hour must equal one check after an hour.
  const ticking = newGame();
  const jumping = newGame();
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
  const state = newGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  const second = startMiningJob(state, "ship-1", "inner_belt", START);
  assert.equal(second, null);
  assert.equal(state.jobs.length, 1);
});

test("Recalling a ship cancels its job and loses the partial trip", () => {
  const state = newGame();
  const job = startMiningJob(state, "ship-1", "inner_belt", START);
  cancelJob(state, job.id);
  processJobs(state, START + TRIP * 3);
  assert.equal(state.jobs.length, 0);
  assert.equal(state.inventory.iron_ore, 0);
});

test("A clock set backwards doesn't take ore away", () => {
  const state = newGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  processJobs(state, START - 100 * SECOND);
  assert.equal(state.inventory.iron_ore, 0);
  assert.equal(state.jobs[0].startedAt, START);
});


// =============================================================
// TRADE
// =============================================================

test("Selling all ore pays the market price and empties the hold", () => {
  const state = newGame();
  state.inventory.iron_ore = 30;
  const sale = sellAll(state, "iron_ore");
  assert.equal(sale.credits, 30 * ITEMS.iron_ore.sellPrice);
  assert.equal(state.credits, sale.credits);
  assert.equal(state.inventory.iron_ore, 0);
});

test("Selling with an empty hold earns nothing, not even XP", () => {
  const state = newGame();
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

test("Selling at home pays credits but earns no Trade XP (Dan, 29 Oct)", () => {
  const state = newGame();
  state.inventory.iron_ore = 120;
  const sale = sellAll(state, "iron_ore");
  assert.equal(sale.credits, 120 * ITEMS.iron_ore.sellPrice);
  assert.equal(sale.xp, 0);
  assert.equal(state.skills.trade.xp, 0);
  assert.equal(state.skills.mining.xp, 0);          // Mining XP untouched
});

test("Trade XP is tonnes x minutes of distance / 15: 600 t, 3 minutes away = 120 XP", () => {
  assert.equal(getTradeXp(600, 180), 120);
  assert.equal(getTradeXp(100, 90), 10);             // 100 t x 1.5 min / 15
});

test("A big home sale never levels Trade", () => {
  const state = newGame();
  state.inventory.iron_ore = 40000;
  const sale = sellAll(state, "iron_ore");
  assert.equal(getLevel(state, "trade"), 1);
  assert.deepEqual(sale.newLevels, []);
});

test("Selling at the hub: 600 t iron pays 4,800 cr and 120 Trade XP", () => {
  const state = newGame();
  const sale = sellAtHub(state, { iron_ore: 600 });
  assert.equal(sale.credits, 4800);
  assert.equal(sale.tonnes, 600);
  assert.equal(sale.xp, 120);
  assert.equal(state.credits, 4800);
  assert.equal(state.skills.trade.xp, 120);
});

test("The hub takes mixed cargo and doesn't touch the home hold", () => {
  const state = newGame();
  state.inventory.iron_ore = 990;                    // stays at home
  const sale = sellAtHub(state, { nickel_ore: 200, iron_ore: 400 });
  assert.equal(sale.credits, 200 * 19 + 400 * 8);    // 3,800 + 3,200 = 7,000
  assert.equal(sale.xp, getTradeXp(600, HUB.travelSeconds));
  assert.equal(state.inventory.iron_ore, 990);
});

test("Cargo value doesn't change Trade XP: 600 t of steel earns the same as 600 t of iron", () => {
  const iron = sellAtHub(newGame(), { iron_ore: 600 });
  const steel = sellAtHub(newGame(), { steel: 600 });
  assert.ok(steel.credits > iron.credits);
  assert.equal(steel.xp, iron.xp);
});

test("A route twice as far gives about the same Trade XP per hour", () => {
  // Double the distance: double the XP per trip, but each trip
  // takes about twice as long (only loading at home and unloading
  // at the hub are fixed: 30 s each for a full Courier).
  const perHour = (travelSeconds) => {
    const run = getHaulPlan(FRESH, "courier");
    const tripSeconds = 2 * travelSeconds + (run.loadMs + run.tradeMs) / 1000;
    return getTradeXp(600, travelSeconds) * (3600 / tripSeconds);
  };
  const ratio = perHour(360) / perHour(180);
  assert.ok(ratio > 1 && ratio < 1.1, ratio.toFixed(3));
});

test("One Courier on the hub run earns about 1,100 Trade XP an hour", () => {
  const plan = getHaulPlan(FRESH, "courier");
  const xpPerHour = getTradeXp(plan.capacity, HUB.travelSeconds) * (HOUR / plan.durationMs);
  assert.ok(xpPerHour > 1000 && xpPerHour < 1200, xpPerHour.toFixed(0));
});


// =============================================================
// SAVING AND OFFLINE PROGRESS
// =============================================================

test("A save turned into text and back is identical", () => {
  const state = newGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  state.credits = 1234;
  const loaded = parseSave(JSON.stringify(state));
  assert.deepEqual(loaded, state);
});

test("A broken save is rejected safely instead of crashing", () => {
  assert.equal(parseSave("this is not a save {{{"), null);
});

test("Offline: 1 hour away pays every trip that fitted (23 trips)", () => {
  // A trip is 2m 36s, so 23 fit in an hour (23.08). Mining levels
  // gained on the way make later trips a little shorter (the drill
  // perk), but not by enough to fit a 24th.
  const state = newGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  state.simulatedUpTo = START;
  const report = applyOfflineProgress(state, START + 1 * HOUR);
  assert.equal(state.inventory.iron_ore, 23 * PROSPECTOR.orePerTrip);
  assert.equal(report.secondsAway, 3600);
  assert.equal(report.secondsCounted, 3600);
});

test("Offline: 3 days away only counts the 24 hour cap", () => {
  const state = newGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  state.simulatedUpTo = START;
  const now = START + 72 * HOUR;
  const report = applyOfflineProgress(state, now);

  // A twin game played for exactly 24 hours: the 3-day one must
  // have earned exactly the same, no more. (Comparing with a twin,
  // not a trip count, keeps this test about the CAP: trip lengths
  // and level perks can change without breaking it.)
  const twin = newGame();
  startMiningJob(twin, "ship-1", "inner_belt", START);
  processJobs(twin, START + 24 * HOUR);
  const in24h = twin.inventory.iron_ore;
  assert.ok(in24h > 0);
  assert.equal(state.inventory.iron_ore, in24h);
  assert.equal(report.secondsCounted, 24 * 3600);

  // The ship carries on from "now", not with 48 hours of backlog.
  processJobs(state, now);
  assert.equal(state.inventory.iron_ore, in24h);
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
  const state = newGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  processJobs(state, START + TRIP * 2);
  assert.equal(state.skills.mining.xp, PROSPECTOR.xpPerTrip * 2);
});

test("Mining level 2 arrives on the 5th Prospector trip (13m)", () => {
  // Level 2 needs 83 XP; a trip earns 20. (Dan, 30 Oct: the first
  // level used to take 7 trips, 18 minutes - too slow a start.)
  const state = newGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  processJobs(state, START + TRIP * 4);
  assert.equal(getLevel(state, "mining"), 1);    // 80 XP after 4 trips
  const results = processJobs(state, START + TRIP * 5);
  assert.equal(getLevel(state, "mining"), 2);    // 100 XP after 5
  assert.deepEqual(results[0].newLevels, [2]);
});

test("A big XP jump reports every level passed, not just the last", () => {
  const state = newGame();
  const newLevels = addXp(state, "mining", XP_TABLE[4]);   // straight to level 4
  assert.deepEqual(newLevels, [2, 3, 4]);
});

test("XP bar maths: halfway between level 2 and 3 fills half the bar", () => {
  const state = newGame();
  state.skills.mining.xp = (XP_TABLE[2] + XP_TABLE[3]) / 2;
  const progress = getLevelProgress(state, "mining");
  assert.equal(progress.level, 2);
  assert.equal(progress.fraction, 0.5);
});

test("At level 99 the XP bar is full and says so", () => {
  const state = newGame();
  state.skills.mining.xp = XP_TABLE[99];
  const progress = getLevelProgress(state, "mining");
  assert.equal(progress.isMax, true);
  assert.equal(progress.fraction, 1);
});


// =============================================================
// SHIPYARD
// =============================================================

test("The Excavator is locked at Mining level 9", () => {
  const state = newGame();
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
  const state = newGame();
  state.credits = 8000;
  const ship = buyShip(state, "prospector");
  assert.ok(ship);
  assert.equal(ship.type, "prospector");
  assert.equal(state.credits, 0);
  assert.equal(state.ships.length, 2);
});

test("Six Prospectors fill the 6 starting command points", () => {
  // (Dan, 30 Oct: 6 starting points, was 4.)
  const state = newGame();
  state.credits = 1_000_000;                         // plenty, so only points can stop us
  for (let i = 0; i < 5; i++) {
    assert.ok(buyShip(state, "prospector"), "Prospector " + (i + 2));
  }
  const before = state.credits;
  assert.deepEqual(canBuyShip(state, "prospector"), { ok: false, reason: "Not enough command points" });
  assert.equal(buyShip(state, "prospector"), null);
  assert.equal(state.credits, before);               // the 7th wasn't charged
});

test("A second Prospector takes about half an hour of mining to afford", () => {
  // Dan's change (28 Oct): an hour felt too long. The second one
  // (owning the starter) costs 8,000 cr; at 14,400 cr an hour
  // that's about 33 minutes. Later ones cost more (29 Oct).
  const creditsPerHour = PROSPECTOR.orePerTrip * ITEMS.iron_ore.sellPrice * (HOUR / TRIP);
  const hours = getShipPrice(newGame(), "prospector") / creditsPerHour;
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
  assert.deepEqual(state.skills, { mining: { xp: 0 }, trade: { xp: 0 }, refining: { xp: 0 }, manufacturing: { xp: 0 }, exploration: { xp: 0 }, diplomacy: { xp: 0 } });
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
  // 120 Mining XP is level 2, so it gets level 2's trip: drills
  // 0.5% faster than level 1 (the Mining perk).
  const level2 = getTripPlan(state, "prospector", "inner_belt");
  assert.equal(getLevel(state, "mining"), 2);
  assert.equal(level2.miningMs, Math.round(PROSPECTOR.miningMs / 1.005));
  assert.equal(state.version, SAVE_VERSION);
  assert.equal(job.durationMs, level2.durationMs);
  assert.equal(job.outboundMs, level2.outboundMs);
  assert.equal(job.miningMs, level2.miningMs);
  assert.equal(state.skills.mining.xp, 120);       // XP kept
});



// =============================================================
// COMMAND CAPACITY
// =============================================================

test("A new game has 6 command points, 1 used by the Prospector", () => {
  const state = newGame();
  assert.equal(getCommandCapacity(state), COMMAND.startPoints);
  assert.equal(getCommandCapacity(state), 6);
  assert.equal(getCommandUsed(state), 1);
});

test("An Excavator uses 2 points: Prospector + 1 Excavator = 3 of 4", () => {
  const state = gameAtLevel10(SHIP_TYPES.excavator.cost);
  buyShip(state, "excavator");
  assert.equal(getCommandUsed(state), 3);
});

test("A third Excavator is blocked by command, even with the money", () => {
  // Prospector 1 + Excavator 2 + Excavator 2 = 5 of 6 points: a third
  // (2 more) doesn't fit. Excavators cost 60,000 then 96,000.
  const state = gameAtLevel10(60000 + 96000 + 500000);
  assert.ok(buyShip(state, "excavator"));
  assert.ok(buyShip(state, "excavator"));
  assert.deepEqual(canBuyShip(state, "excavator"), { ok: false, reason: "Not enough command points" });
  assert.equal(buyShip(state, "excavator"), null);
  assert.equal(state.credits, 500000);               // no money taken for the third
});

test("Command upgrades: +2 points each, priced 80,000 then 160,000 then 320,000", () => {
  // Four times the old prices (Dan, 29 Oct), still doubling.
  const state = newGame();
  state.credits = 80000 + 160000 + 320000;
  assert.equal(getNextUpgradeCost(state), 80000);
  buyUpgrade(state);
  assert.equal(getNextUpgradeCost(state), 160000);
  buyUpgrade(state);
  assert.equal(getNextUpgradeCost(state), 320000);
  buyUpgrade(state);
  assert.equal(getCommandCapacity(state), 6 + 3 * 2);
  assert.equal(state.credits, 0);
});

test("An upgrade you can't afford does nothing", () => {
  const state = newGame();
  state.credits = 1999;
  assert.equal(buyUpgrade(state), 0);
  assert.equal(state.credits, 1999);
  assert.equal(state.commandUpgrades, 0);
});

test("After the last upgrade there are no more to buy", () => {
  const state = newGame();
  state.commandUpgrades = COMMAND.maxUpgrades;
  assert.equal(getNextUpgradeCost(state), null);
  state.credits = 1e12;
  assert.equal(buyUpgrade(state), 0);
});

test("Expanding command makes room for the third Excavator", () => {
  // Excavators 60,000 + 96,000, upgrade 80,000, third Excavator
  // 153,600 (60,000 x 1.6 x 1.6)
  const state = gameAtLevel10(60000 + 96000 + 80000 + 153600);
  buyShip(state, "excavator");
  buyShip(state, "excavator");
  buyUpgrade(state);
  assert.ok(buyShip(state, "excavator"));
  assert.equal(getCommandUsed(state), 7);
  assert.equal(getCommandCapacity(state), 8);
  assert.equal(state.credits, 0);
});


// =============================================================
// SHIP PRICES RISE WITH EACH ONE YOU OWN (Dan, 29 Oct)
// =============================================================

test("Each Prospector costs 60% more than the last: 8,000, 12,800, 20,480", () => {
  const state = newGame();                     // owns the starter
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
  const state = newGame();
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
  const state = newGame();
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
  const state = newGame();
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
  const state = newGame();
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
  const state = newGame();
  state.skills.mining.xp = XP_TABLE[5] - 1;
  assert.equal(isFieldUnlocked(state, "outer_belt"), false);
  assert.equal(startMiningJob(state, "ship-1", "outer_belt", START), null);
  state.skills.mining.xp = XP_TABLE[5];
  assert.equal(isFieldUnlocked(state, "outer_belt"), true);
});

// =============================================================
// THE ICE MOON (opened by a survey, 30 Oct)
// =============================================================

test("The Ice moon field stays shut until its survey is done, at any Mining level", () => {
  // Why: it's the first field opened by exploring, not by a Mining
  // level, so a high Mining level alone mustn't open it.
  const state = newGame();
  state.skills.mining.xp = XP_TABLE[30];
  assert.equal(isFieldUnlocked(state, "ice_moon"), false);
  assert.equal(startMiningJob(state, "ship-1", "ice_moon", START), null);   // can't send a barge yet
});

test("Surveying the Ice moon opens it for mining, even at Mining 1", () => {
  const state = newGame();
  state.exploration.surveyed.ice_moon = true;
  assert.equal(isFieldUnlocked(state, "ice_moon"), true);
  assert.ok(startMiningJob(state, "ship-1", "ice_moon", START), "a barge can be sent");
});

test("A trip to the Ice moon brings home ice, which sells between nickel ore and hull plating", () => {
  const state = newGame();
  state.exploration.surveyed.ice_moon = true;
  startMiningJob(state, "ship-1", "ice_moon", START);
  const plan = getTripPlan(state, "prospector", "ice_moon");
  processJobs(state, START + plan.durationMs);
  assert.ok(state.inventory.ice > 0, "ice in the hold");
  assert.ok(ITEMS.ice.sellPrice > ITEMS.nickel_ore.sellPrice && ITEMS.ice.sellPrice < ITEMS.hull_plating.sellPrice);
});

test("Prospector to the Outer Belt: 1m 30s each way, 1m mining, 6s unloading = 4m 6s trip", () => {
  const plan = getTripPlan(FRESH, "prospector", "outer_belt");
  assert.equal(plan.outboundMs, 90 * SECOND);
  assert.equal(plan.miningMs, 60 * SECOND);
  assert.equal(plan.durationMs, 246 * SECOND);
  assert.equal(plan.xpPerTrip, 40);                 // 120 t ÷ 3
});

test("An Outer Belt trip brings home nickel ore, not iron", () => {
  const state = newGame();
  state.skills.mining.xp = XP_TABLE[5];
  // Mining 5 drills 2% faster: 60s / 1.02 = 58.8s of mining.
  const plan = getTripPlan(state, "prospector", "outer_belt");
  startMiningJob(state, "ship-1", "outer_belt", START);
  processJobs(state, START + plan.durationMs);
  assert.equal(state.inventory.nickel_ore, 120);
  assert.equal(state.inventory.iron_ore, 0);
});

test("The Outer Belt pays more per hour than the Inner Belt for both ships", () => {
  const crPerHour = (typeId, fieldId, itemId) => {
    const plan = getTripPlan(FRESH, typeId, fieldId);
    return plan.orePerTrip * ITEMS[itemId].sellPrice * (HOUR / plan.durationMs);
  };
  for (const typeId of ["prospector", "excavator"]) {
    assert.ok(crPerHour(typeId, "outer_belt", "nickel_ore") > crPerHour(typeId, "inner_belt", "iron_ore"), typeId);
  }
});

test("Selling everything sells every item and adds it all up", () => {
  const state = newGame();
  state.inventory.iron_ore = 10;
  state.inventory.nickel_ore = 10;
  const expected = 10 * ITEMS.iron_ore.sellPrice + 10 * ITEMS.nickel_ore.sellPrice;
  assert.equal(getCargoValue(state), expected);
  assert.equal(getCargoValue(state, "hub"), 10 * 8 + 10 * 19);
  const sale = sellEverything(state);
  assert.equal(sale.credits, expected);
  assert.equal(sale.xp, 0);                          // home sales earn no XP
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
  assert.deepEqual(state.skills, { mining: { xp: 900 }, trade: { xp: 0 }, refining: { xp: 0 }, manufacturing: { xp: 0 }, exploration: { xp: 0 }, diplomacy: { xp: 0 } });
  assert.equal(state.credits, 12000);              // x10 at version 6
});

// =============================================================
// HAULING (the Courier)
// =============================================================

const HAUL = getHaulPlan(FRESH, "courier");   // one Courier hub run
// When a full Courier is paid: it loads (30s), flies out (3m),
// then unloads and sells at the hub (30s) - 4 minutes in.
const HUB_SALE = HAUL.loadMs + HAUL.outboundMs + HAUL.tradeMs;

// A game at Trade 3 that owns a Courier as ship-2, docked.
function gameWithCourier(mode = "full") {
  const state = newGame();
  state.credits = SHIP_TYPES.courier.cost;       // the Courier is open from Trade 1
  const courier = buyShip(state, "courier");
  courier.haulMode = mode;
  return state;
}

test("The Courier is open from the start (Trade 1) and costs 50,000 cr", () => {
  const state = newGame();
  state.credits = 1_000_000;
  const ship = buyShip(state, "courier");
  assert.equal(state.credits, 1_000_000 - 50000);
  assert.equal(ship.haulMode, "full");           // starts on full loads
  assert.equal(ship.destination, undefined);     // freighters don't mine
});

test("Hub run: 30s loading, 3m out, 30s unloading and selling, 3m back = 7m, 600 t hold", () => {
  assert.equal(HAUL.loadMs, 30 * SECOND);           // 600 t at 20 t/s
  assert.equal(HAUL.outboundMs, 180 * SECOND);
  assert.equal(HAUL.tradeMs, 30 * SECOND);
  assert.equal(HAUL.durationMs, 420 * SECOND);
  assert.equal(HUB_SALE, 240 * SECOND);
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
  const state = newGame();
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

test("Two Couriers flying at once each keep 76% of their Trade XP", () => {
  const state = gameWithCourier("full");
  state.credits = getShipPrice(state, "courier");
  buyShip(state, "courier");                     // ship-3
  state.inventory.iron_ore = 1200;               // a full load each
  startHaulJob(state, "ship-2", START);
  startHaulJob(state, "ship-3", START);
  const before = state.skills.trade.xp;
  processJobs(state, START + HUB_SALE);   // both sell
  const each = getTradeXp(600, HUB.travelSeconds) * 2 ** (BALANCE.fleetXpExponent - 1);
  const gained = state.skills.trade.xp - before;
  assert.ok(Math.abs(gained - 2 * each) < 1e-9, String(gained));
  // Credits are not shared: each Courier is paid its full cargo.
  // (The first sale lifts Trade to level 2, so the second one gets
  // the +0.5% Trade perk: 4,800 + 4,824.)
  assert.equal(state.credits, 4800 + 4824);
});

test("A Courier waiting at home for ore doesn't reduce the flying one's XP", () => {
  const state = gameWithCourier("full");
  state.credits = getShipPrice(state, "courier");
  buyShip(state, "courier");                     // ship-3, will wait: no ore left for it
  state.inventory.iron_ore = 600;
  startHaulJob(state, "ship-2", START);
  startHaulJob(state, "ship-3", START);
  const before = state.skills.trade.xp;
  processJobs(state, START + HUB_SALE);
  assert.equal(state.skills.trade.xp - before, getTradeXp(600, HUB.travelSeconds));
});

test("Paid at the END of trading: 4,800 cr and 120 Trade XP for 600 t iron", () => {
  const state = gameWithCourier();
  state.inventory.iron_ore = 600;
  startHaulJob(state, "ship-2", START);
  const tradeXpBefore = state.skills.trade.xp;

  processJobs(state, START + HUB_SALE - 1);
  assert.equal(state.credits, 0);                // still selling

  const results = processJobs(state, START + HUB_SALE);
  assert.equal(state.credits, 4800);
  assert.equal(state.skills.trade.xp - tradeXpBefore, 120);
  assert.equal(results[0].kind, "haul");
  assert.deepEqual(results[0].cargo, { iron_ore: 600 });
});

test("Phases read loading, outbound, trading, returning, then waiting at home", () => {
  const state = gameWithCourier();
  state.inventory.iron_ore = 600;
  const job = startHaulJob(state, "ship-2", START);
  assert.equal(getJobPhase(job, START + 1).phase, "loading");
  assert.equal(getJobPhase(job, START + HAUL.loadMs + 1).phase, "outbound");
  assert.equal(getJobPhase(job, START + HAUL.loadMs + HAUL.outboundMs + 1).phase, "trading");
  assert.equal(getJobPhase(job, START + HUB_SALE + 1).phase, "returning");

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
  processJobs(state, START + HUB_SALE);   // sold
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
  // One Prospector brings 120 t iron every 2m 36s, so the 600 t
  // for a full load are home after exactly 5 trips (13m).
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
  // (20m), waited, and left again with the next 600 t - ready on
  // the 10th Prospector trip. Each level drills 0.5% faster: the
  // Prospector reaches Mining 2 after trip 5 (100 XP) and Mining 3
  // after trip 9 (180 XP), so trips 6-9 are a little shorter and
  // trip 10 shorter still. That's exactly when the 10th lands.
  const tripAt = (level) => getTripPlan({ ...FRESH, skills: { ...FRESH.skills, mining: { xp: XP_TABLE[level] } } },
                                        "prospector", "inner_belt").durationMs;
  assert.ok(tripAt(3) < tripAt(2) && tripAt(2) < TRIP);
  processJobs(state, START + 30 * MINUTE);
  assert.equal(haul.startedAt, START + TRIP * 5 + tripAt(2) * 4 + tripAt(3));
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
  state.simulatedUpTo = START;
  const report = applyOfflineProgress(state, START + HOUR);
  const haul = report.results.find((r) => r.kind === "haul");
  // 23 Prospector trips = 2,760 t iron. Full loads leave about
  // every 13 minutes (5 trips); each sells 4 minutes after leaving,
  // so the 4th sells at about 56m - inside the hour. 4 x 600 = 2,400 t.
  assert.equal(haul.tonnes, 2400);
  assert.equal(haul.trips, 4);
  assert.equal(state.inventory.iron_ore, 2760 - 2400);  // 360 t still at home
  // Each sale is 4,800 cr at base price, plus the Trade perk for
  // the level BEFORE that sale (120 XP a sale: Trade 1, 2, 3, 4):
  // 4,800 + 4,824 + 4,848 + 4,872 = 19,344 cr.
  assert.equal(haul.credits, 4800 + 4824 + 4848 + 4872);
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
  assert.deepEqual(state.inventory, { iron_ore: 300, nickel_ore: 40, ice: 0 });
  assert.deepEqual(state.jobs[0].cargo, { nickel_ore: 200, iron_ore: 400 });
  assert.deepEqual(state.skills, { mining: { xp: 900 }, trade: { xp: 180 }, refining: { xp: 0 }, manufacturing: { xp: 0 }, exploration: { xp: 0 }, diplomacy: { xp: 0 } });
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
  const state = newGame();
  const result = renameShip(state, "ship-1", "Ore Else");
  assert.deepEqual(result, { ok: true, oldName: "Rusty Pick", name: "Ore Else" });
  assert.equal(state.ships[0].name, "Ore Else");
});

test("Extra spaces are tidied: '  Lucky    Strike ' becomes 'Lucky Strike'", () => {
  const state = newGame();
  renameShip(state, "ship-1", "  Lucky    Strike ");
  assert.equal(state.ships[0].name, "Lucky Strike");
});

test("An empty (or all-spaces) name is refused", () => {
  const state = newGame();
  assert.equal(renameShip(state, "ship-1", "    ").ok, false);
  assert.equal(state.ships[0].name, "Rusty Pick");
});

test("Names over 24 characters are refused; exactly 24 is fine", () => {
  const state = newGame();
  assert.equal(renameShip(state, "ship-1", "A".repeat(25)).ok, false);
  assert.equal(renameShip(state, "ship-1", "A".repeat(24)).ok, true);
});

test("Two ships can't share a name (capitals don't count as different)", () => {
  const state = newGame();
  state.credits = getShipPrice(state, "prospector");
  buyShip(state, "prospector");                       // "Second Wind"
  const result = renameShip(state, "ship-1", "SECOND WIND");
  assert.equal(result.ok, false);
  assert.match(result.reason, /already has that name/);
});

test("Re-typing a ship's own name in different capitals is allowed", () => {
  const state = newGame();
  assert.equal(renameShip(state, "ship-1", "RUSTY PICK").ok, true);
});

test("A renamed ship keeps its name through export and import", () => {
  const state = newGame();
  renameShip(state, "ship-1", "Grit & <Gravel>");
  const back = importSave(exportSave(state)).state;
  assert.equal(back.ships[0].name, "Grit & <Gravel>");
});

// =============================================================
// RECALL ("come home") AND RESUME
// A Prospector trip: 45s out, 60s mining, 45s back (150s), 120 t.
// =============================================================

test("Recall while flying out: turns back, docks after the same time, no ore", () => {
  const state = newGame();
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
  const state = newGame();
  const job = startMiningJob(state, "ship-1", "inner_belt", START);
  const recall = recallJob(state, job.id, START + 75 * SECOND);   // 30s into 60s mining
  assert.equal(recall.mode, "leftEarly");
  assert.equal(recall.amount, 60);
  // The normal flight home, then 3s to unload a half hold
  // (60 t at 20 t/s - a part load is quicker than a full one).
  assert.equal(recall.docksInMs, 48 * SECOND);

  processJobs(state, START + 123 * SECOND - 1);
  assert.equal(state.inventory.iron_ore, 0);         // still unloading
  processJobs(state, START + 123 * SECOND);
  assert.equal(state.inventory.iron_ore, 60);
  assert.equal(state.skills.mining.xp, 10);          // 60 t ÷ 6
  assert.equal(state.jobs.length, 0);
});

test("Recall on the way home: full hold at the normal time, then stays docked", () => {
  const state = newGame();
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
    const state = newGame();
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
  processJobs(state, START + HUB_SALE);   // sold
  const recall = recallJob(state, job.id, START + HUB_SALE);
  assert.equal(recall.docksInMs, HAUL.returnMs);     // 3 minutes, not instant

  // Can't be sent out again until it actually docks.
  assert.equal(startHaulJob(state, "ship-2", START + HUB_SALE), null);
  processJobs(state, START + HAUL.durationMs);
  assert.equal(state.jobs.length, 0);                // docked, standing by
  assert.equal(state.inventory.iron_ore, 600);       // second load untouched
});

test("Courier recalled on the way out: no sale, cargo back only when it docks", () => {
  const state = gameWithCourier();
  state.inventory.iron_ore = 600;
  const job = startHaulJob(state, "ship-2", START);
  // Loaded (30s), then 1 minute out: it turns round, and takes
  // 1 minute to get back.
  recallJob(state, job.id, START + HAUL.loadMs + MINUTE);
  processJobs(state, START + HAUL.loadMs + 2 * MINUTE - 1);
  assert.equal(state.inventory.iron_ore, 0);         // still on board, flying back
  processJobs(state, START + HAUL.loadMs + 2 * MINUTE);
  assert.equal(state.inventory.iron_ore, 600);       // unloaded at home
  assert.equal(state.credits, 0);
  assert.equal(state.jobs.length, 0);
});

test("Courier recalled while selling: finishes the sale, then flies home", () => {
  const state = gameWithCourier();
  state.inventory.iron_ore = 600;
  const job = startHaulJob(state, "ship-2", START);
  recallJob(state, job.id, START + HAUL.loadMs + HAUL.outboundMs + 10 * SECOND);
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
  const state = newGame();
  const job = startMiningJob(state, "ship-1", "inner_belt", START);
  recallJob(state, job.id, START + 30 * SECOND);     // turn back at 30s out
  resumeJob(state, job.id, START + 40 * SECOND);     // 10s later: 20s out
  // It's 20s out, so the 156s trip ends 136s from now (at 176s)...
  // i.e. 20s late: the time spent heading home.
  processJobs(state, START + 176 * SECOND - 1);
  assert.equal(state.inventory.iron_ore, 0);
  processJobs(state, START + 176 * SECOND);
  assert.equal(state.inventory.iron_ore, 120);       // a full, normal trip
  assert.equal(state.jobs.length, 1);                // and it keeps working
});

test("Resume after leaving the field early: part-load home, then normal trips", () => {
  const state = newGame();
  const job = startMiningJob(state, "ship-1", "inner_belt", START);
  recallJob(state, job.id, START + 75 * SECOND);     // 60 t, docks at 123s
  resumeJob(state, job.id, START + 80 * SECOND);
  processJobs(state, START + 123 * SECOND);
  assert.equal(state.inventory.iron_ore, 60);
  assert.equal(job.durationMs, 156 * SECOND);        // next trip is normal again
  processJobs(state, START + 279 * SECOND);
  assert.equal(state.inventory.iron_ore, 180);       // + one full trip
});

test("Resume while finishing: nothing lost, keeps repeating", () => {
  const state = newGame();
  const job = startMiningJob(state, "ship-1", "inner_belt", START);
  recallJob(state, job.id, START + 120 * SECOND);
  resumeJob(state, job.id, START + 125 * SECOND);
  processJobs(state, START + 2 * TRIP);
  assert.equal(state.inventory.iron_ore, 240);       // exactly as if never recalled
});

test("Recalling twice does nothing the second time", () => {
  const state = newGame();
  const job = startMiningJob(state, "ship-1", "inner_belt", START);
  recallJob(state, job.id, START + 30 * SECOND);
  assert.equal(recallJob(state, job.id, START + 31 * SECOND), null);
});

test("Recall right as it leaves: docks at once with nothing", () => {
  const state = newGame();
  const job = startMiningJob(state, "ship-1", "inner_belt", START);
  recallJob(state, job.id, START);
  assert.equal(getJobProgress(job, START), 1);       // no dividing by zero
  processJobs(state, START);
  assert.equal(state.jobs.length, 0);
});

test("A recalled ship's trip survives a save and time away", () => {
  const state = newGame();
  const job = startMiningJob(state, "ship-1", "inner_belt", START);
  recallJob(state, job.id, START + 75 * SECOND);
  state.simulatedUpTo = START + 75 * SECOND;
  const loaded = importSave(exportSave(state)).state;
  // (the export carries simulatedUpTo with it, so time away counts from there)
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
  const state = newGame();
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
  const state = newGame();
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
  const state = newGame();
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
  const state = newGame();
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
  assert.equal(getBatchMs(newGame(), "iron_bar"), 60 * SECOND);
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
  const xpBefore = state.skills.mining.xp;
  startMiningJob(state, "ship-1", "inner_belt", START);
  setRecipe(state, 0, "iron_bar", START);
  state.simulatedUpTo = START;
  applyOfflineProgress(state, START + HOUR);

  // Every tonne mined is either still ore, in the furnace, or became bars (2 t ore -> 1 t bar).
  // A lone ship earns 1 XP per 10 t of iron, so its XP says exactly how much it mined.
  const mined = (state.skills.mining.xp - xpBefore) * FIELDS.inner_belt.tonnesPerXp;
  assert.equal(mined, 23 * PROSPECTOR.orePerTrip);     // 23 trips in an hour
  const inFurnace = getRefineJob(state, 0).inputs?.iron_ore || 0;
  assert.equal(state.inventory.iron_ore + inFurnace + state.inventory.iron_bar * 2, mined);
  assert.ok(state.inventory.iron_bar >= 1200, "made plenty of bars");
  assert.equal(state.skills.refining.xp, (state.inventory.iron_bar / 30) * 8);
});

test("A batch in the furnace survives saving, and finishes while away", () => {
  const state = gameWithRefinery();
  state.inventory.iron_ore = 60;
  setRecipe(state, 0, "iron_bar", START);
  state.simulatedUpTo = START + 10 * SECOND;
  const loaded = importSave(exportSave(state)).state;
  // (the export carries simulatedUpTo with it, so time away counts from there)
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


// =============================================================
// THE SIMULATION ENGINE (js/simulation.js)
// The design doc's test: "an hour away must give the same
// result as an hour played". These play a busy economy - barges
// on both fields, two freighters, two refinery slots, fleet XP
// sharing, a Refining level-up part way - in different ways and
// compare EVERY number in the save, not just a few.
// =============================================================

// A busy mid-game empire, everything running from START.
function busyEmpire() {
  const state = newGame();
  state.simulatedUpTo = START;
  state.clock = createClock(START);              // game clock starts at START too
  state.lastSavedAt = 0;                         // (differs per run, so ignored)
  state.skills.mining.xp = XP_TABLE[12];         // both fields and the refinery open
  state.skills.refining.xp = XP_TABLE[14];       // reaches 15 during the run
  state.credits = 10_000_000;
  state.commandUpgrades = 5;
  buyShip(state, "prospector");                  // ship-2
  buyShip(state, "excavator");                   // ship-3
  buyShip(state, "courier").haulMode = "constant";   // ship-4
  buyShip(state, "courier").haulMode = "full";       // ship-5
  startMiningJob(state, "ship-1", "inner_belt", START);
  startMiningJob(state, "ship-2", "outer_belt", START);
  startMiningJob(state, "ship-3", "inner_belt", START);
  startHaulJob(state, "ship-4", START);
  startHaulJob(state, "ship-5", START);
  setRecipe(state, 0, "iron_bar", START);
  setRecipe(state, 1, "nickel_bar", START);
  // Two scouts: they share out the survey targets, then run deep
  // scans (whose dice rolls must also match however it's played).
  state.milestones.firstSale = true;
  buyShip(state, "pathfinder");                  // ship-6
  buyShip(state, "pathfinder");                  // ship-7
  startScoutJob(state, "ship-6", "inner_belt_survey", START);
  startScoutJob(state, "ship-7", "ice_moon", START);   // locked: refused...
  startScoutJob(state, "ship-7", "deep_scan", START);  // ...so it deep scans
  return state;
}

test("Engine: 6 hours of 250 ms ticks, random ticks and one big jump end identical", () => {
  // 1. One jump, like coming back after 6 hours.
  const jumped = busyEmpire();
  advanceTo(jumped, START + 6 * HOUR);

  // 2. Ticking 4 times a second, like playing for 6 hours.
  const ticked = busyEmpire();
  for (let t = 250; t <= 6 * HOUR; t += 250) {
    advanceTo(ticked, START + t);
  }

  // 3. Uneven gaps from 0 to 20 minutes, like a player who keeps
  //    popping in and out. A fixed "seed" makes the same gaps
  //    every run, so a failure can be repeated.
  let seed = 42;
  const randomFraction = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const random = busyEmpire();
  for (let t = 0; t < 6 * HOUR; ) {
    t = Math.min(6 * HOUR, t + Math.floor(randomFraction() * 20 * MINUTE));
    advanceTo(random, START + t);
  }

  // Something actually happened (so we're not comparing empty games)...
  assert.ok(jumped.skills.trade.xp > 0 && jumped.skills.refining.xp > XP_TABLE[15]);
  assert.ok(jumped.exploration.deepScans > 10 && jumped.exploration.deepFinds > 0);
  assert.equal(Object.keys(jumped.exploration.surveyed).length, 9);   // every target done
  // ...and every credit, tonne, XP point and job timer matches.
  assert.deepEqual(ticked, jumped);
  assert.deepEqual(random, jumped);
});

test("Engine: a laptop asleep for 3 days with the game open only counts 24 hours", () => {
  // Before simulation.js, live play had no cap, so this earned
  // all 3 days while closing the game earned 24 hours.
  const awake = newGame();
  const closed = newGame();
  for (const state of [awake, closed]) {
    startMiningJob(state, "ship-1", "inner_belt", START);
    state.simulatedUpTo = START;
  }
  advanceTo(awake, START + 72 * HOUR);              // the game loop waking up
  applyOfflineProgress(closed, START + 72 * HOUR);  // loading after time away

  // A twin played for exactly 24 hours is what both should match.
  const twin = newGame();
  startMiningJob(twin, "ship-1", "inner_belt", START);
  processJobs(twin, START + 24 * HOUR);
  assert.equal(awake.inventory.iron_ore, twin.inventory.iron_ore);
  assert.equal(awake.inventory.iron_ore, closed.inventory.iron_ore);
});

test("Engine: the clock set back an hour awards nothing, and ships don't freeze", () => {
  const state = newGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  state.simulatedUpTo = START;

  advanceTo(state, START + TRIP / 2);                   // half a trip in
  const report = advanceTo(state, START + TRIP / 2 - HOUR);   // clock jumps back 1 hour
  assert.equal(report.secondsCounted, 0);
  assert.equal(state.inventory.iron_ore, 0);

  // Half a trip later (by the new clock) the ship docks, as it
  // would have done anyway. Without the slide it would sit
  // frozen for a whole hour.
  advanceTo(state, START + TRIP - HOUR);
  assert.equal(state.inventory.iron_ore, PROSPECTOR.orePerTrip);
});

test("Engine: playing to the same moment twice earns nothing the second time", () => {
  const state = newGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  state.simulatedUpTo = START;
  advanceTo(state, START + HOUR);
  const ore = state.inventory.iron_ore;
  advanceTo(state, START + HOUR);
  assert.equal(state.inventory.iron_ore, ore);
});

test("Engine: the run clock counts only time actually played (3 days away = 24 hours)", () => {
  const state = newGame();
  state.simulatedUpTo = START;
  advanceTo(state, START + 2 * HOUR);
  advanceTo(state, START + 2 * HOUR + 72 * HOUR);
  assert.equal(state.simulatedMs, 26 * HOUR);
});

test("A version 7 save gains the simulation clock, starting from when it was saved", () => {
  const oldSave = {
    version: 7, credits: 100, inventory: { iron_ore: 0 }, commandUpgrades: 0, nextShipNumber: 2,
    ships: [{ id: "ship-1", name: "Rusty Pick", type: "prospector", destination: "inner_belt" }],
    skills: { mining: { xp: 0 }, trade: { xp: 0 }, refining: { xp: 0 } },
    jobs: [], lastSavedAt: START,
  };
  const state = parseSave(JSON.stringify(oldSave));
  assert.equal(state.version, SAVE_VERSION);
  assert.equal(state.simulatedUpTo, START);
  assert.equal(state.simulatedMs, 0);
});


// =============================================================
// THE WORKSHOP (js/workshop.js) - Manufacturing and work orders
// Like the refinery tests, these run through processJobs and
// advanceTo, so they test the real timeline, offline included.
// =============================================================

const PLATING = WORKSHOP_RECIPES.hull_plating;          // 30 t iron bars -> 30 t plating
const PLATING_MS = PLATING.seconds * SECOND;            // at Manufacturing level 1

// A game with the workshop open (Refining 8) at a chosen
// Manufacturing level, with the clock set to START.
function gameWithWorkshop(manufacturingLevel = 1) {
  const state = newGame();
  state.skills.mining.xp = XP_TABLE[REFINERY.openAtMiningLevel];
  state.skills.refining.xp = XP_TABLE[WORKSHOP.openAtRefiningLevel];
  state.skills.manufacturing.xp = XP_TABLE[manufacturingLevel];
  state.simulatedUpTo = START;
  return state;
}

test("The workshop is closed until Refining 8, and says so when asked for an order", () => {
  const state = gameWithWorkshop();
  state.skills.refining.xp = XP_TABLE[WORKSHOP.openAtRefiningLevel] - 1;   // Refining 7
  assert.equal(isWorkshopOpen(state), false);
  assert.equal(getWorkshopSlotCount(state), 0);
  const result = addOrder(state, 0, "hull_plating", 5, START);
  assert.equal(result.ok, false);
  assert.match(result.reason, /Refining 8/);
  assert.equal(state.jobs.length, 0);
});

test("At Refining 8: 1 workshop slot, 3 orders per queue, only hull plating unlocked", () => {
  const state = gameWithWorkshop(1);
  assert.equal(isWorkshopOpen(state), true);
  assert.equal(getWorkshopSlotCount(state), 1);
  assert.equal(getQueueLimit(state), 3);
  assert.equal(isWorkshopRecipeUnlocked(state, "hull_plating"), true);
  assert.equal(isWorkshopRecipeUnlocked(state, "wiring_coils"), false);
});

test("Slots arrive at Manufacturing 12 and 35; queues grow at 8 and 25", () => {
  assert.equal(getWorkshopSlotCount(gameWithWorkshop(11)), 1);
  assert.equal(getWorkshopSlotCount(gameWithWorkshop(12)), 2);
  assert.equal(getWorkshopSlotCount(gameWithWorkshop(35)), 3);
  assert.equal(getQueueLimit(gameWithWorkshop(7)), 3);
  assert.equal(getQueueLimit(gameWithWorkshop(8)), 4);
  assert.equal(getQueueLimit(gameWithWorkshop(25)), 5);
});

test("An order of 3 plating: 90 t of bars in, 90 t of plating out, 36 XP, then the slot goes idle", () => {
  const state = gameWithWorkshop();
  state.inventory.iron_bar = 200;
  assert.equal(addOrder(state, 0, "hull_plating", 3, START).ok, true);
  assert.equal(state.inventory.iron_bar, 170);              // the first batch took its bars at once

  advanceTo(state, START + PLATING_MS * 3 - 1);             // just short of the third batch
  assert.equal(state.inventory.hull_plating, 60);
  advanceTo(state, START + PLATING_MS * 3);
  assert.equal(state.inventory.hull_plating, 90);           // tonnage kept: 90 t in, 90 t out
  assert.equal(state.inventory.iron_bar, 110);
  assert.equal(state.skills.manufacturing.xp, XP_TABLE[1] + 3 * PLATING.xp);
  assert.equal(getWorkshopJob(state, 0), undefined);        // idle: the order is done

  advanceTo(state, START + HOUR);                           // and it stays idle
  assert.equal(state.inventory.iron_bar, 110);
});

test("A 20-batch plating order takes 30 minutes at Manufacturing 1", () => {
  assert.equal(getWorkshopBatchMs(gameWithWorkshop(1), "hull_plating") * 20, 30 * MINUTE);
});

test("Orders run in the order they were queued", () => {
  const state = gameWithWorkshop(5);                        // wiring coils open
  state.inventory.iron_bar = 30;
  state.inventory.nickel_bar = 30;
  addOrder(state, 0, "wiring_coils", 1, START);
  addOrder(state, 0, "hull_plating", 1, START);
  const coilsMs = getWorkshopBatchMs(state, "wiring_coils");
  advanceTo(state, START + coilsMs);
  assert.equal(state.inventory.wiring_coils, 30);           // the first order finished first
  assert.equal(state.inventory.hull_plating || 0, 0);       // the second has only just started
  assert.equal(getWorkshopJob(state, 0).orders[0].recipeId, "hull_plating");
});

test("An order waits for metal, then starts the moment the refinery makes it", () => {
  const state = gameWithWorkshop();
  state.inventory.iron_ore = 60;                            // enough for one refinery batch
  setRecipe(state, 0, "iron_bar", START);                   // 60 t ore -> 30 t bars
  addOrder(state, 0, "hull_plating", 1, START);
  assert.equal(getWorkshopJob(state, 0).status, "waiting"); // no bars yet

  const smeltMs = getBatchMs(state, "iron_bar");
  advanceTo(state, START + smeltMs);                        // bars arrive...
  assert.equal(getWorkshopJob(state, 0).status, "working"); // ...and go straight in
  assert.equal(getWorkshopJob(state, 0).startedAt, START + smeltMs);
  advanceTo(state, START + smeltMs + PLATING_MS);
  assert.equal(state.inventory.hull_plating, 30);
});

test("Orders are refused when the queue is full, the size is wrong, or the recipe is locked", () => {
  const state = gameWithWorkshop();
  for (let i = 0; i < 3; i++) {
    assert.equal(addOrder(state, 0, "hull_plating", 1, START).ok, true);
  }
  assert.match(addOrder(state, 0, "hull_plating", 1, START).reason, /full/);
  const fresh = gameWithWorkshop();
  for (const bad of [0, WORKSHOP.maxOrderBatches + 1, 2.5]) {
    assert.match(addOrder(fresh, 0, "hull_plating", bad, START).reason, /1 to 20/);
  }
  assert.match(addOrder(fresh, 0, "wiring_coils", 5, START).reason, /Manufacturing 5/);
  assert.match(addOrder(fresh, 1, "hull_plating", 5, START).reason, /slot/);
  assert.equal(fresh.jobs.length, 0);                       // nothing half-made by a refusal
});

test("Cancelling the current order mid-batch hands the metal back; finished batches stay", () => {
  const state = gameWithWorkshop();
  state.inventory.iron_bar = 90;
  addOrder(state, 0, "hull_plating", 5, START);
  advanceTo(state, START + PLATING_MS + 10 * SECOND);       // one batch done, the second underway
  assert.equal(state.inventory.iron_bar, 30);               // 60 t taken so far
  assert.equal(cancelOrder(state, 0, 0, START + PLATING_MS + 10 * SECOND), true);
  assert.equal(state.inventory.iron_bar, 60);               // the running batch's 30 t came back
  assert.equal(state.inventory.hull_plating, 30);           // the finished batch is kept
  assert.equal(getWorkshopJob(state, 0), undefined);        // nothing else queued: idle
});

test("Cancelling a queued order leaves the current one running", () => {
  const state = gameWithWorkshop();
  state.inventory.iron_bar = 300;
  addOrder(state, 0, "hull_plating", 2, START);
  addOrder(state, 0, "hull_plating", 4, START);
  cancelOrder(state, 0, 1, START + SECOND);
  const job = getWorkshopJob(state, 0);
  assert.equal(job.orders.length, 1);
  assert.equal(job.status, "working");
  assert.equal(job.startedAt, START);                       // the running batch wasn't restarted
});

test("Offline: a queue of 3 orders drains while away, then the slot sits idle", () => {
  const state = gameWithWorkshop();
  state.inventory.iron_bar = 1000;
  for (let i = 0; i < 3; i++) addOrder(state, 0, "hull_plating", 10, START);
  const report = applyOfflineProgress(state, START + 8 * HOUR);   // an evening away
  const made = report.results.find((r) => r.kind === "workshop");
  assert.equal(made.trips, 30);                             // 3 orders x 10 batches
  assert.equal(made.ordersFinished, 3);
  assert.equal(made.slotIdle, true);
  assert.equal(state.inventory.hull_plating, 900);
  assert.equal(state.inventory.iron_bar, 100);              // untouched once the queue ran out
  assert.equal(getWorkshopJob(state, 0), undefined);
});

test("The workshop gets metal before a freighter does", () => {
  const state = gameWithWorkshop();
  state.credits = SHIP_TYPES.courier.cost;
  buyShip(state, "courier").haulMode = "constant";          // would take anything in the hold
  startHaulJob(state, "ship-2", START);                     // nothing to haul yet: waits
  addOrder(state, 0, "hull_plating", 1, START);             // waits for bars too
  state.inventory.iron_bar = 30;                            // 30 t of bars appear...
  advanceTo(state, START + SECOND);
  assert.equal(getWorkshopJob(state, 0).status, "working"); // ...and the workshop took them
  assert.equal(state.jobs.find((j) => j.type === "haul").status, "waiting");
});

test("Every workshop recipe keeps tonnage: tonnes in = tonnes out", () => {
  for (const [id, recipe] of Object.entries(WORKSHOP_RECIPES)) {
    const tonnesIn = Object.values(recipe.inputs).reduce((sum, t) => sum + t, 0);
    assert.equal(tonnesIn, recipe.outputAmount, id);
  }
});

test("Every product sells for more than the metal that goes into it", () => {
  for (const [id, recipe] of Object.entries(WORKSHOP_RECIPES)) {
    const inputValue = Object.entries(recipe.inputs).reduce((sum, [item, t]) => sum + t * ITEMS[item].sellPrice, 0);
    assert.ok(recipe.outputAmount * ITEMS[recipe.output].sellPrice > inputValue, id);
  }
});

test("Every workshop recipe uses items that exist, and content.js lists the same recipes as the balance sheet", () => {
  for (const [id, recipe] of Object.entries(WORKSHOP_RECIPES)) {
    assert.ok(ITEMS[recipe.output], `${id} makes unknown item "${recipe.output}"`);
    for (const itemId of Object.keys(recipe.inputs)) {
      assert.ok(ITEMS[itemId], `${id} uses unknown item "${itemId}"`);
    }
  }
  assert.deepEqual(Object.keys(WORKSHOP_RECIPES).sort(), Object.keys(BALANCE_FILE.workshopRecipes).sort());
  assert.deepEqual(Object.keys(ITEMS).sort(), Object.keys(BALANCE_FILE.items).sort());
});

test("A workshop mid-order survives saving and finishes while away", () => {
  const state = gameWithWorkshop();
  state.inventory.iron_bar = 60;
  addOrder(state, 0, "hull_plating", 2, START);
  advanceTo(state, START + 30 * SECOND);
  const loaded = importSave(exportSave(state)).state;
  applyOfflineProgress(loaded, START + HOUR);
  assert.equal(loaded.inventory.hull_plating, 60);
  assert.equal(getWorkshopJob(loaded, 0), undefined);
});

test("A version 8 save gains the Manufacturing skill at 0 XP", () => {
  const oldSave = {
    version: 8, credits: 100, inventory: { iron_bar: 30 }, commandUpgrades: 0, nextShipNumber: 2,
    ships: [{ id: "ship-1", name: "Rusty Pick", type: "prospector", destination: "inner_belt" }],
    skills: { mining: { xp: 900 }, trade: { xp: 0 }, refining: { xp: 650 } },
    jobs: [], lastSavedAt: START, simulatedUpTo: START, simulatedMs: 0,
  };
  const state = parseSave(JSON.stringify(oldSave));
  assert.equal(state.version, SAVE_VERSION);
  assert.deepEqual(state.skills.manufacturing, { xp: 0 });
  assert.equal(state.skills.refining.xp, 650);
});

test("Engine: 6 hours with the workshop running, ticked or jumped, end identical", () => {
  // The busy empire from the engine tests, plus a workshop with
  // a full queue fed by its own refinery. Every number must match.
  function busyWithWorkshop() {
    const state = busyEmpire();
    state.skills.manufacturing.xp = XP_TABLE[4];            // levels up to 5 during the run
    // No bars are added by hand: the empire's own refinery makes
    // them, so every bar arrives through a timed event.
    addOrder(state, 0, "hull_plating", 20, START);
    addOrder(state, 0, "hull_plating", 20, START);
    addOrder(state, 0, "hull_plating", 20, START);
    return state;
  }
  const jumped = busyWithWorkshop();
  advanceTo(jumped, START + 6 * HOUR);
  const ticked = busyWithWorkshop();
  for (let t = 250; t <= 6 * HOUR; t += 250) {
    advanceTo(ticked, START + t);
  }
  assert.ok(jumped.skills.manufacturing.xp > XP_TABLE[5]);  // the workshop really ran
  assert.deepEqual(ticked, jumped);
});


// =============================================================
// BONDED STOCK (js/bonded.js)
// Bonded goods are never sold - not by the Sell buttons, not by
// freighters - but the refinery and workshop can still use them.
// Each test checks one thing that takes goods from the hold.
// =============================================================

test("Selling at home leaves the bonded stock in the hold", () => {
  const state = newGame();
  state.inventory.iron_ore = 200;
  setBond(state, "iron_ore", 150);
  const sale = sellAll(state, "iron_ore");
  assert.equal(sale.credits, 50 * ITEMS.iron_ore.sellPrice);
  assert.equal(state.inventory.iron_ore, 150);
});

test("A bond bigger than the stock keeps all of it, and sells nothing", () => {
  const state = newGame();
  state.inventory.iron_ore = 40;
  setBond(state, "iron_ore", 100);
  assert.equal(getSellable(state, "iron_ore"), 0);
  assert.equal(getBondedInHold(state, "iron_ore"), 40);       // shown as "40 t (40 bonded)"
  assert.equal(sellAll(state, "iron_ore").credits, 0);
  assert.equal(state.inventory.iron_ore, 40);
});

test("Sell all and the cargo value only count unbonded stock", () => {
  const state = newGame();
  state.inventory.iron_ore = 100;
  state.inventory.iron_bar = 100;
  setBond(state, "iron_bar", 100);
  assert.equal(getCargoValue(state), 100 * ITEMS.iron_ore.sellPrice);
  sellEverything(state);
  assert.equal(state.inventory.iron_ore, 0);
  assert.equal(state.inventory.iron_bar, 100);
});

test("A freighter on constant runs leaves bonded goods behind", () => {
  const state = newGame();
  state.inventory.hull_plating = 150;
  setBond(state, "hull_plating", 100);
  const cargo = loadCargo(state, 600, "constant");
  assert.deepEqual(cargo, { hull_plating: 50 });
  assert.equal(state.inventory.hull_plating, 100);
});

test("A freighter waiting for a full load doesn't count bonded goods towards it", () => {
  const state = newGame();
  state.inventory.iron_ore = 650;
  setBond(state, "iron_ore", 100);                            // only 550 t for sale
  assert.equal(loadCargo(state, 600, "full"), null);          // so it keeps waiting
  state.inventory.iron_ore = 700;                             // now 600 t for sale
  assert.deepEqual(loadCargo(state, 600, "full"), { iron_ore: 600 });
  assert.equal(state.inventory.iron_ore, 100);
});

test("The refinery can smelt bonded ore", () => {
  const state = gameWithRefinery();
  state.inventory.iron_ore = 60;
  setBond(state, "iron_ore", 100);
  setRecipe(state, 0, "iron_bar", START);
  assert.equal(getRefineJob(state, 0).status, "working");
  assert.equal(state.inventory.iron_ore, 0);
});

test("The workshop can use bonded metal", () => {
  const state = gameWithWorkshop();
  state.inventory.iron_bar = 30;
  setBond(state, "iron_bar", 30);
  addOrder(state, 0, "hull_plating", 1, START);
  assert.equal(getWorkshopJob(state, 0).status, "working");
});

test("Bonds must be whole tonnes, 0 or more; 0 releases the bond", () => {
  const state = newGame();
  assert.equal(setBond(state, "iron_ore", -5).ok, false);
  assert.equal(setBond(state, "iron_ore", 2.5).ok, false);
  assert.equal(setBond(state, "unobtainium", 10).ok, false);
  assert.deepEqual(state.bonded, {});
  setBond(state, "iron_ore", 80);
  assert.equal(getBond(state, "iron_ore"), 80);
  setBond(state, "iron_ore", 0);                              // Release
  assert.deepEqual(state.bonded, {});                         // no entry left behind
});

test("Bonds survive saving and loading", () => {
  const state = newGame();
  setBond(state, "hull_plating", 100);
  const loaded = importSave(exportSave(state)).state;
  assert.equal(getBond(loaded, "hull_plating"), 100);
});

test("A version 9 save gains an empty bond list", () => {
  const oldSave = {
    version: 9, credits: 100, inventory: { iron_bar: 30 }, commandUpgrades: 0, nextShipNumber: 2,
    ships: [{ id: "ship-1", name: "Rusty Pick", type: "prospector", destination: "inner_belt" }],
    skills: { mining: { xp: 0 }, trade: { xp: 0 }, refining: { xp: 0 }, manufacturing: { xp: 0 } },
    jobs: [], lastSavedAt: START, simulatedUpTo: START, simulatedMs: 0,
  };
  const state = parseSave(JSON.stringify(oldSave));
  assert.equal(state.version, SAVE_VERSION);
  assert.deepEqual(state.bonded, {});
});

test("Engine: with bonds set, 6 hours ticked or jumped end identical, and bonds hold", () => {
  function bondedEmpire() {
    const state = busyEmpire();                               // both freighters run from the hold
    setBond(state, "iron_bar", 90);
    setBond(state, "nickel_bar", 60);
    return state;
  }
  const jumped = bondedEmpire();
  advanceTo(jumped, START + 6 * HOUR);
  const ticked = bondedEmpire();
  for (let t = 250; t <= 6 * HOUR; t += 250) {
    advanceTo(ticked, START + t);
  }
  assert.deepEqual(ticked, jumped);
  assert.ok(jumped.inventory.iron_bar >= 90);                 // the freighters left the bond alone
  assert.ok(jumped.inventory.nickel_bar >= 60);
});


// =============================================================
// UPGRADES (js/upgrades.js) and their effects
// =============================================================

// A game that can afford anything: plenty of every product and
// credits, at the given Refining and Manufacturing levels.
function richGame(refiningLevel, manufacturingLevel) {
  const state = gameWithWorkshop(manufacturingLevel);
  state.skills.refining.xp = XP_TABLE[refiningLevel];
  state.credits = 10_000_000;
  for (const itemId of Object.keys(ITEMS)) state.inventory[itemId] = 10_000;
  return state;
}

test("Buying an upgrade takes its goods and credits, once", () => {
  const state = richGame(8, 1);
  const lining = UPGRADES.furnace_lining_1;
  assert.equal(buyIndustryUpgrade(state, "furnace_lining_1").ok, true);
  assert.equal(isOwned(state, "furnace_lining_1"), true);
  assert.equal(state.inventory.hull_plating, 10_000 - lining.costs.hull_plating);
  assert.equal(state.credits, 10_000_000 - lining.credits);
  assert.match(buyIndustryUpgrade(state, "furnace_lining_1").reason, /Already owned/);
  assert.equal(state.credits, 10_000_000 - lining.credits);   // not charged twice
});

test("Upgrades are refused for level, missing tier, goods and credits, with the reason", () => {
  assert.match(canBuyIndustryUpgrade(richGame(8, 1), "precision_tooling_1").reason, /Manufacturing 3/);
  assert.match(canBuyIndustryUpgrade(richGame(20, 1), "furnace_lining_2").reason, /Furnace lining I first/);
  const poor = richGame(8, 1);
  poor.inventory.hull_plating = 5;
  assert.match(canBuyIndustryUpgrade(poor, "furnace_lining_1").reason, /Need 15 t more hull plating/);
  const broke = richGame(8, 1);
  broke.credits = 1000;
  assert.match(canBuyIndustryUpgrade(broke, "furnace_lining_1").reason, /cr more/);
  assert.equal(buyIndustryUpgrade(broke, "furnace_lining_1").ok, false);
  assert.equal(broke.inventory.hull_plating, 10_000);           // a refusal takes nothing
});

test("Bonded goods can pay for upgrades", () => {
  const state = richGame(8, 1);
  state.inventory.hull_plating = 20;
  setBond(state, "hull_plating", 20);
  assert.equal(buyIndustryUpgrade(state, "furnace_lining_1").ok, true);
});

test("Upgrade lines: every upgrade is in exactly one line, tiers in order", () => {
  // The Industry tab groups upgrades into these collapsible lines.
  const lines = getUpgradeLines();
  const furnace = lines.find((l) => l.id === "furnace_lining_1");
  assert.equal(furnace.name, "Furnace lining");
  assert.deepEqual(furnace.tiers, ["furnace_lining_1", "furnace_lining_2", "furnace_lining_3"]);
  assert.deepEqual(lines.find((l) => l.id === "smart_queue").tiers, ["smart_queue"]);
  // No upgrade lost or counted twice
  const all = lines.flatMap((l) => l.tiers).sort();
  assert.deepEqual(all, Object.keys(UPGRADES).sort());
  // Each tier needs the one before it
  for (const line of lines) {
    line.tiers.forEach((id, i) => assert.equal(UPGRADES[id].requires, i === 0 ? null : line.tiers[i - 1]));
  }
});

test("Furnace linings make refinery batches 10% faster each, on top of levels", () => {
  const state = richGame(40, 1);
  const base = getBatchMs(state, "iron_bar");
  buyIndustryUpgrade(state, "furnace_lining_1");
  assert.equal(getBatchMs(state, "iron_bar"), Math.round(base * 0.9));
  buyIndustryUpgrade(state, "furnace_lining_2");
  assert.equal(getBatchMs(state, "iron_bar"), Math.round(base * 0.8));
});

test("Improved yield: an iron bar batch makes 30 t, then 33 t, then 36 t", () => {
  const state = richGame(30, 1);
  assert.equal(getBatchOutput(state, "iron_bar"), 30);
  buyIndustryUpgrade(state, "improved_yield_1");
  assert.equal(getBatchOutput(state, "iron_bar"), 33);
  buyIndustryUpgrade(state, "improved_yield_2");
  assert.equal(getBatchOutput(state, "iron_bar"), 36);
});

test("Improved yield on steel: 49.5 t a batch, the half tonne carried, so 2 batches = 99 t", () => {
  const state = richGame(15, 1);
  state.skills.refining.xp = XP_TABLE[15];
  state.upgrades.improved_yield_1 = true;                   // (owned; level checks aside)
  state.inventory.steel = 0;
  state.inventory.iron_ore = 120;
  state.inventory.nickel_ore = 60;
  setRecipe(state, 0, "steel", START);
  advanceTo(state, START + 2 * getBatchMs(state, "steel"));
  assert.equal(state.inventory.steel, 99);
  assert.deepEqual(state.carry, {});                        // the halves made a whole tonne
});

test("Carrying part-tonnes: 1.5 t then 1.5 t adds 1 t then 2 t", () => {
  const state = newGame();
  assert.equal(addItemWithCarry(state, "iron_bar", 1.5), 1);
  assert.equal(state.carry.iron_bar, 0.5);
  assert.equal(addItemWithCarry(state, "iron_bar", 1.5), 2);
  assert.equal(state.inventory.iron_bar, 3);
  assert.deepEqual(state.carry, {});
});

test("Refinery slot 4 adds a fourth slot at Refining 50", () => {
  const state = richGame(50, 1);
  assert.equal(getSlotCount(state), 3);
  assert.equal(getMaxSlots(), 4);
  buyIndustryUpgrade(state, "refinery_slot_4");
  assert.equal(getSlotCount(state), 4);
  assert.equal(setRecipe(state, 3, "iron_bar", START), true);
});

test("Precision tooling makes workshop batches 10% faster", () => {
  const state = richGame(8, 3);
  const base = getWorkshopBatchMs(state, "hull_plating");
  buyIndustryUpgrade(state, "precision_tooling_1");
  assert.equal(getWorkshopBatchMs(state, "hull_plating"), Math.round(base * 0.9));
});

test("Scrap recovery: 20 plating batches use 570 t of bars instead of 600", () => {
  const state = richGame(8, 7);
  state.upgrades.scrap_recovery_1 = true;
  state.inventory.iron_bar = 600;
  addOrder(state, 0, "hull_plating", 20, START);
  advanceTo(state, START + 20 * getWorkshopBatchMs(state, "hull_plating"));
  assert.equal(state.inventory.hull_plating, 10_000 + 600);  // all 20 batches made
  assert.equal(state.inventory.iron_bar, 30);                // 5% of 600 t came back
});

test("Bigger work orders: the order cap goes 20, 40, 60", () => {
  const state = richGame(8, 32);
  assert.equal(getMaxOrderBatches(state), 20);
  assert.match(addOrder(state, 0, "hull_plating", 40, START).reason, /1 to 20/);
  buyIndustryUpgrade(state, "bigger_orders_1");
  assert.equal(addOrder(state, 0, "hull_plating", 40, START).ok, true);
  buyIndustryUpgrade(state, "bigger_orders_2");
  assert.equal(getMaxOrderBatches(state), 60);
});

test("Without the smart queue, a blocked first order holds up the queue", () => {
  const state = gameWithWorkshop(5);
  state.inventory.nickel_bar = 60;                           // metal for coils, none for plating
  addOrder(state, 0, "hull_plating", 1, START);
  addOrder(state, 0, "wiring_coils", 1, START);
  assert.equal(getWorkshopJob(state, 0).status, "waiting");
  advanceTo(state, START + HOUR);
  assert.equal(state.inventory.wiring_coils || 0, 0);
});

test("With the smart queue, the next order with metal runs, and nothing is reordered", () => {
  const state = gameWithWorkshop(14);
  state.upgrades.smart_queue = true;
  state.inventory.nickel_bar = 60;                           // enough for 2 coil batches
  addOrder(state, 0, "hull_plating", 1, START);              // blocked: no iron bars
  addOrder(state, 0, "wiring_coils", 2, START);
  const job = getWorkshopJob(state, 0);
  assert.equal(job.status, "working");
  assert.equal(job.runningIndex, 1);                         // the coils order is running
  assert.equal(job.orders[0].recipeId, "hull_plating");      // the plating order kept its place

  const coilsMs = getWorkshopBatchMs(state, "wiring_coils");
  advanceTo(state, START + 2 * coilsMs);
  assert.equal(state.inventory.wiring_coils, 60);            // both coil batches made
  assert.equal(job.orders.length, 1);                        // the coil order is done and gone
  assert.equal(job.orders[0].recipeId, "hull_plating");      // plating still waiting, still first

  state.inventory.iron_bar = 30;                             // its metal arrives...
  advanceTo(state, START + 2 * coilsMs + SECOND);
  assert.equal(job.status, "working");                       // ...and it picks up again
  assert.equal(job.runningIndex, 0);
});

test("Smart queue: cancelling the first order while the second runs keeps the batch going", () => {
  const state = gameWithWorkshop(14);
  state.upgrades.smart_queue = true;
  state.inventory.nickel_bar = 30;
  addOrder(state, 0, "hull_plating", 1, START);
  addOrder(state, 0, "wiring_coils", 1, START);
  cancelOrder(state, 0, 0, START + SECOND);                  // cancel the blocked plating order
  const job = getWorkshopJob(state, 0);
  assert.equal(job.status, "working");
  assert.equal(job.runningIndex, 0);                         // the coils order moved up to first
  assert.equal(job.startedAt, START);                        // its batch wasn't restarted
  advanceTo(state, START + getWorkshopBatchMs(state, "wiring_coils"));
  assert.equal(state.inventory.wiring_coils, 30);
});

test("Every upgrade's goods, skill and prerequisite exist", () => {
  for (const [id, upgrade] of Object.entries(UPGRADES)) {
    for (const itemId of Object.keys(upgrade.costs)) assert.ok(ITEMS[itemId], `${id} costs unknown item ${itemId}`);
    assert.ok(state_skills_exist(upgrade.skill), `${id} uses unknown skill ${upgrade.skill}`);
    if (upgrade.requires !== null) assert.ok(UPGRADES[upgrade.requires], `${id} requires unknown ${upgrade.requires}`);
  }
  assert.deepEqual(Object.keys(UPGRADES).sort(), Object.keys(BALANCE_FILE.upgrades).sort());
});
function state_skills_exist(skillId) { return newGame().skills[skillId] !== undefined; }

test("A version 10 save gains no upgrades and no part-tonnes", () => {
  const oldSave = {
    version: 10, credits: 100, inventory: { iron_bar: 30 }, bonded: {}, commandUpgrades: 0, nextShipNumber: 2,
    ships: [{ id: "ship-1", name: "Rusty Pick", type: "prospector", destination: "inner_belt" }],
    skills: { mining: { xp: 0 }, trade: { xp: 0 }, refining: { xp: 0 }, manufacturing: { xp: 0 } },
    jobs: [], lastSavedAt: START, simulatedUpTo: START, simulatedMs: 0,
  };
  const state = parseSave(JSON.stringify(oldSave));
  assert.equal(state.version, SAVE_VERSION);
  assert.deepEqual(state.upgrades, {});
  assert.deepEqual(state.carry, {});
});

test("Engine: 6 hours with every upgrade and a smart queue, ticked or jumped, end identical", () => {
  function upgradedEmpire() {
    const state = busyEmpire();
    for (const id of Object.keys(UPGRADES)) state.upgrades[id] = true;   // all of them
    state.skills.manufacturing.xp = XP_TABLE[14];
    // A plating order (needs iron bars, which the refinery makes)
    // ahead of a coils order (nickel bars): the smart queue will
    // keep switching between them as metal comes and goes.
    addOrder(state, 0, "hull_plating", 20, START);
    addOrder(state, 0, "wiring_coils", 20, START);
    return state;
  }
  const jumped = upgradedEmpire();
  advanceTo(jumped, START + 6 * HOUR);
  const ticked = upgradedEmpire();
  for (let t = 250; t <= 6 * HOUR; t += 250) {
    advanceTo(ticked, START + t);
  }
  assert.ok(jumped.skills.manufacturing.xp > XP_TABLE[14]);  // the workshop really ran
  assert.deepEqual(ticked, jumped);
});


// =============================================================
// STANDING ORDERS (the Control centre)
// "Keep X t of a product in stock": runs when no work order can,
// while the stock is below target. Never finishes.
// =============================================================

// A workshop with the Control centre built and plenty of bars.
function gameWithControlCentre() {
  const state = gameWithWorkshop(30);
  state.upgrades.control_centre = true;
  state.inventory.iron_bar = 1000;
  return state;
}

test("Standing orders need the Control centre", () => {
  const state = gameWithWorkshop(30);
  assert.match(addStandingOrder(state, 0, "hull_plating", 60, START).reason, /Control centre/);
  assert.deepEqual(state.standingOrders, {});
});

test("A standing order tops stock up to its target, then stops", () => {
  const state = gameWithControlCentre();
  assert.equal(addStandingOrder(state, 0, "hull_plating", 60, START).ok, true);
  assert.equal(getWorkshopJob(state, 0).status, "working");
  advanceTo(state, START + 10 * PLATING_MS);                  // time for 10 batches...
  assert.equal(state.inventory.hull_plating, 60);            // ...but it stopped at 60 t (2 batches)
  assert.equal(state.inventory.iron_bar, 940);
  assert.equal(getWorkshopJob(state, 0).status, "waiting");   // the slot keeps its job, ready
});

test("When stock is used or sold, the standing order tops it back up", () => {
  const state = gameWithControlCentre();
  addStandingOrder(state, 0, "hull_plating", 60, START);
  advanceTo(state, START + 3 * PLATING_MS);
  sellAll(state, "hull_plating");                            // stock drops to 0
  advanceTo(state, START + 3 * PLATING_MS + SECOND);         // the slot notices...
  advanceTo(state, START + 6 * PLATING_MS);                  // ...and makes it again
  assert.equal(state.inventory.hull_plating, 60);
});

test("Work orders come first; the standing order waits until the queue is done", () => {
  const state = gameWithControlCentre();
  addStandingOrder(state, 0, "hull_plating", 60, START);     // starts at once
  addOrder(state, 0, "hull_plating", 3, START + PLATING_MS / 2);
  advanceTo(state, START + PLATING_MS);                      // the standing batch finishes
  const job = getWorkshopJob(state, 0);
  assert.equal(job.standingIndex, null);                     // now the work order runs
  assert.equal(job.orders[0].done, 0);
  advanceTo(state, START + 4 * PLATING_MS);                  // the 3-batch order is done
  assert.equal(state.inventory.hull_plating, 120);           // 30 standing + 90 ordered
  assert.equal(job.orders.length, 0);
  assert.equal(job.status, "waiting");                       // above target: nothing to top up
});

test("Standing orders are refused when full, doubled, locked or a bad amount", () => {
  const state = gameWithControlCentre();
  assert.match(addStandingOrder(state, 0, "hull_plating", 0, START).reason, /1 or more/);
  assert.match(addStandingOrder(state, 0, "hull_plating", 2.5, START).reason, /1 or more/);
  addStandingOrder(state, 0, "hull_plating", 60, START);
  assert.match(addStandingOrder(state, 0, "hull_plating", 90, START).reason, /already keeps/);
  addStandingOrder(state, 0, "wiring_coils", 30, START);
  assert.match(addStandingOrder(state, 0, "cargo_pod", 30, START).reason, /already has 2/);
  const low = gameWithControlCentre();
  low.skills.manufacturing.xp = XP_TABLE[4];
  assert.match(addStandingOrder(low, 0, "wiring_coils", 30, START).reason, /Manufacturing 5/);
});

test("Removing a standing order mid-batch hands the metal back, and an empty slot goes idle", () => {
  const state = gameWithControlCentre();
  addStandingOrder(state, 0, "hull_plating", 60, START);
  assert.equal(state.inventory.iron_bar, 970);
  removeStandingOrder(state, 0, 0, START + SECOND);
  assert.equal(state.inventory.iron_bar, 1000);
  assert.deepEqual(state.standingOrders, {});
  assert.equal(getWorkshopJob(state, 0), undefined);
});

test("Cancelling a work order while a standing batch runs leaves the standing batch alone", () => {
  // (A bug caught while building: the cancel used to think the
  // running batch belonged to the first work order.)
  const state = gameWithControlCentre();
  addStandingOrder(state, 0, "hull_plating", 60, START);     // standing batch running
  state.inventory.iron_bar = 0;                              // so the work order can't start
  addOrder(state, 0, "hull_plating", 2, START);
  cancelOrder(state, 0, 0, START + SECOND);
  const job = getWorkshopJob(state, 0);
  assert.equal(job.status, "working");                       // still making the standing batch
  assert.equal(job.standingIndex, 0);
  assert.equal(job.startedAt, START);                        // not restarted: no progress lost
  assert.equal(state.inventory.iron_bar, 0);                 // no metal wrongly handed back
});

test("Standing orders survive saving, and keep working while away", () => {
  const state = gameWithControlCentre();
  addStandingOrder(state, 0, "hull_plating", 90, START);
  const loaded = importSave(exportSave(state)).state;
  applyOfflineProgress(loaded, START + HOUR);
  assert.equal(loaded.inventory.hull_plating, 90);
  assert.equal(getStandingOrders(loaded, 0).length, 1);
});

test("A version 11 save gains an empty set of standing orders", () => {
  const oldSave = {
    version: 11, credits: 100, inventory: { iron_bar: 30 }, bonded: {}, upgrades: {}, carry: {},
    commandUpgrades: 0, nextShipNumber: 2,
    ships: [{ id: "ship-1", name: "Rusty Pick", type: "prospector", destination: "inner_belt" }],
    skills: { mining: { xp: 0 }, trade: { xp: 0 }, refining: { xp: 0 }, manufacturing: { xp: 0 } },
    jobs: [], lastSavedAt: START, simulatedUpTo: START, simulatedMs: 0,
  };
  const state = parseSave(JSON.stringify(oldSave));
  assert.equal(state.version, SAVE_VERSION);
  assert.deepEqual(state.standingOrders, {});
});

test("Engine: standing orders with freighters selling the product, ticked or jumped, end identical", () => {
  // The busy empire's constant-run Courier keeps selling plating,
  // so the standing order keeps topping it up: a production line.
  function standingEmpire() {
    const state = busyEmpire();
    state.skills.manufacturing.xp = XP_TABLE[30];
    state.upgrades.control_centre = true;
    addStandingOrder(state, 0, "hull_plating", 60, START);
    return state;
  }
  const jumped = standingEmpire();
  advanceTo(jumped, START + 6 * HOUR);
  const ticked = standingEmpire();
  for (let t = 250; t <= 6 * HOUR; t += 250) {
    advanceTo(ticked, START + t);
  }
  assert.ok(jumped.skills.manufacturing.xp > XP_TABLE[30] + 1000);   // it kept working
  assert.deepEqual(ticked, jumped);
});

// =============================================================
// THE GAME CLOCK AND PLAYTEST TOOLS (clock.js, playtest.js)
// The promise to check: "an hour at 10x plays exactly like 10
// hours at 1x, offline time included", and the 24-hour cap
// counts GAME time. Plus: the dev panel's cheats do what they
// say, refuse nonsense, and always mark the save.
// =============================================================

test("Clock: a new game's clock IS real time at 1x", () => {
  const state = newGame();
  state.clock = createClock(START);
  // Any real time in, the same time out.
  assert.equal(gameNow(state, START), START);
  assert.equal(gameNow(state, START + 5 * HOUR), START + 5 * HOUR);
});

test("Clock: at 10x, 1 real minute is 10 game minutes", () => {
  const state = newGame();
  state.clock = createClock(START);
  setSpeed(state, 10, START);
  assert.equal(gameNow(state, START + MINUTE), START + 10 * MINUTE);
});

test("Clock: slowing back to 1x keeps the time already played fast", () => {
  // 1 real minute at 10x (= 10 game minutes), then 1 real minute
  // at 1x: the game should be 11 minutes on, never jump back.
  const state = newGame();
  state.clock = createClock(START);
  setSpeed(state, 10, START);
  setSpeed(state, 1, START + MINUTE);
  assert.equal(gameNow(state, START + MINUTE), START + 10 * MINUTE);       // no jump at the switch
  assert.equal(gameNow(state, START + 2 * MINUTE), START + 11 * MINUTE);
});

test("Clock: only the speeds on offer are allowed", () => {
  const state = newGame();
  state.clock = createClock(START);
  assert.deepEqual(SPEEDS, [1, 2, 5, 10, 60]);
  assert.equal(setSpeed(state, 3, START), false);
  assert.equal(setSpeed(state, 0, START), false);
  assert.equal(state.clock.speed, 1);   // unchanged
});

test("Clock: 1 real hour at 10x ends identical to 10 hours at 1x (played live)", () => {
  // Fast: ticking 4 times a second for 1 real hour at 10x.
  const fast = busyEmpire();
  setSpeed(fast, 10, START);
  for (let real = 250; real <= HOUR; real += 250) {
    advanceTo(fast, gameNow(fast, START + real));
  }
  // Normal: one jump of 10 hours at 1x.
  const normal = busyEmpire();
  advanceTo(normal, START + 10 * HOUR);

  assert.ok(normal.skills.trade.xp > 0);
  // Everything matches except the clock's own settings (the
  // speed and its anchor), which are SUPPOSED to differ.
  fast.clock = normal.clock;
  assert.deepEqual(fast, normal);
});

test("Clock: closing the game at 10x for 1 real hour = 10 game hours offline", () => {
  const closed = busyEmpire();
  setSpeed(closed, 10, START);
  // Save, then load it an hour later (real time).
  const loaded = parseSave(JSON.stringify(closed));
  const report = applyOfflineProgress(loaded, gameNow(loaded, START + HOUR));
  assert.equal(report.secondsAway, 10 * 60 * 60);

  const normal = busyEmpire();
  advanceTo(normal, START + 10 * HOUR);
  loaded.clock = normal.clock;
  loaded.lastSavedAt = normal.lastSavedAt;   // the save stamps its own time
  assert.deepEqual(loaded, normal);
});

test("Clock: the 24-hour offline cap counts GAME time (1 real hour at 60x = 60h, 24h counted)", () => {
  const state = busyEmpire();
  setSpeed(state, 60, START);
  const report = advanceTo(state, gameNow(state, START + HOUR));
  assert.equal(report.secondsAway, 60 * 60 * 60);
  assert.equal(report.secondsCounted, 24 * 60 * 60);
  assert.equal(state.simulatedMs, 24 * HOUR);
});

test("Clock: the computer's clock going back at 10x awards nothing", () => {
  const state = busyEmpire();
  setSpeed(state, 10, START);
  advanceTo(state, gameNow(state, START + MINUTE));   // 10 game minutes played
  const credits = state.credits;
  const report = advanceTo(state, gameNow(state, START));   // real clock back 1 minute
  assert.equal(report.secondsCounted, 0);
  assert.equal(state.credits, credits);
});

test("Clock: a version 12 save gets a 1x clock equal to real time, and no playtest mark", () => {
  const oldSave = newGame();
  oldSave.version = 12;
  oldSave.simulatedUpTo = START;
  delete oldSave.clock;
  delete oldSave.playtest;
  const state = parseSave(JSON.stringify(oldSave));
  assert.equal(state.version, SAVE_VERSION);
  assert.deepEqual(state.clock, { realAt: START, gameAt: START, speed: 1 });
  assert.equal(state.playtest, false);
  assert.equal(gameNow(state, START + HOUR), START + HOUR);   // still real time
});

test("Clock: an exported save keeps its speed and playtest mark", () => {
  const state = newGame();
  devSetSpeed(state, 5, START);
  const result = importSave(exportSave(state));
  assert.ok(result.ok);
  assert.equal(result.state.clock.speed, 5);
  assert.equal(result.state.playtest, true);
});

test("Playtest: a new game is not a playtest save", () => {
  assert.equal(newGame().playtest, false);
});

test("Playtest: set level puts the skill at the START of that level, and marks the save", () => {
  const state = newGame();
  assert.deepEqual(devSetLevel(state, "mining", 20), { ok: true });
  assert.equal(state.skills.mining.xp, XP_TABLE[20]);
  assert.equal(getLevel(state, "mining"), 20);
  assert.equal(state.playtest, true);
  // Down works too
  devSetLevel(state, "mining", 1);
  assert.equal(getLevel(state, "mining"), 1);
});

test("Playtest: set level refuses nonsense and doesn't mark the save", () => {
  const state = newGame();
  for (const level of [0, 100, 2.5, NaN]) {
    assert.equal(devSetLevel(state, "mining", level).ok, false, "level " + level);
  }
  assert.equal(devSetLevel(state, "cooking", 5).ok, false);
  assert.equal(state.skills.mining.xp, 0);
  assert.equal(state.playtest, false);
});

test("Playtest: add credits and goods, refusing 0, negatives and part-tonnes", () => {
  const state = newGame();
  const credits = state.credits;
  assert.equal(devAddCredits(state, 0).ok, false);
  assert.equal(devAddCredits(state, -5).ok, false);
  assert.equal(devAddGoods(state, "iron_ore", 1.5).ok, false);
  assert.equal(devAddGoods(state, "unobtainium", 10).ok, false);
  assert.equal(state.playtest, false);   // nothing worked, so no mark

  assert.ok(devAddCredits(state, 50_000).ok);
  assert.equal(state.credits, credits + 50_000);
  assert.ok(devAddGoods(state, "hull_plating", 300).ok);
  assert.equal(state.inventory.hull_plating, 300);
  assert.equal(state.playtest, true);
});

test("Playtest: added ore is picked up by a waiting refinery slot on the next tick", () => {
  const state = newGame();
  state.clock = createClock(START);
  state.simulatedUpTo = START;
  state.skills.mining.xp = XP_TABLE[8];          // refinery open
  setRecipe(state, 0, "iron_bar", START);        // waits: no ore yet
  assert.equal(getRefineJob(state, 0).status, "waiting");
  devAddGoods(state, "iron_ore", 1000);
  advanceTo(state, START + SECOND);
  assert.equal(getRefineJob(state, 0).status, "working");
});

test("Playtest: speed 1x doesn't mark the save; any faster speed does", () => {
  const state = newGame();
  assert.ok(devSetSpeed(state, 1, START).ok);
  assert.equal(state.playtest, false);
  assert.equal(devSetSpeed(state, 7, START).ok, false);
  assert.ok(devSetSpeed(state, 2, START).ok);
  assert.equal(state.playtest, true);
});

test("Playtest: jump an hour plays exactly one more hour", () => {
  const jumped = busyEmpire();
  devJumpHour(jumped);
  // The clock has moved an hour with no real time passing...
  assert.equal(gameNow(jumped, START), START + HOUR);
  advanceTo(jumped, gameNow(jumped, START));
  // ...and it plays the same as an hour going by normally.
  const normal = busyEmpire();
  advanceTo(normal, START + HOUR);
  assert.equal(jumped.simulatedMs, HOUR);
  jumped.clock = normal.clock;
  jumped.playtest = false;
  assert.deepEqual(jumped, normal);
});

test("Playtest: dropping a skill below its unlocks mid-run doesn't break the engine", () => {
  // Refinery and workshop busy at high levels, then Mining and
  // Refining dropped to 1 (the refinery and workshop "close").
  // Jobs already running should just carry on; nothing crashes
  // and no goods appear from nowhere.
  const state = busyEmpire();
  state.skills.refining.xp = XP_TABLE[30];
  addOrder(state, 0, "hull_plating", 5, START);
  devSetLevel(state, "mining", 1);
  devSetLevel(state, "refining", 1);
  advanceTo(state, START + 6 * HOUR);
  for (const [itemId, amount] of Object.entries(state.inventory)) {
    assert.ok(Number.isInteger(amount) && amount >= 0, itemId + " = " + amount);
  }
});

// =============================================================
// LEVEL PERKS, SHIP COMPONENTS AND LOADING TIME
// Agreed with Dan 29 Oct: Mining +0.5% drill speed and Trade
// +0.5% hub prices per level; components per hull type (Mk I credits,
// Mk II/III products too); loading by tonnes, rate by hull size.
// =============================================================

test("Perks: level 1 gives nothing; Mining 11 drills 5% faster; Trade 21 pays 10% more at the hub", () => {
  const state = newGame();
  assert.equal(getMiningDrillPerk(state), 0);
  assert.equal(getTradeHubPerk(state), 0);
  state.skills.mining.xp = XP_TABLE[11];
  state.skills.trade.xp = XP_TABLE[21];
  assert.ok(Math.abs(getMiningDrillPerk(state) - 0.05) < 1e-12);
  assert.ok(Math.abs(getTradeHubPerk(state) - 0.10) < 1e-12);
  // The skill card's numbers come from the same place
  assert.ok(Math.abs(getLevelPerk(state, "refining").total - 0) < 1e-12);
  assert.equal(getLevelPerk(state, "mining").perLevel, 0.005);
});

test("Perks: the Mining perk shortens only the mining part of a trip", () => {
  const state = newGame();
  state.skills.mining.xp = XP_TABLE[11];             // +5%
  const plan = getTripPlan(state, "prospector", "inner_belt");
  assert.equal(plan.miningMs, Math.round(60000 / 1.05));
  assert.equal(plan.outboundMs, PROSPECTOR.outboundMs);   // flights unchanged
  assert.equal(plan.orePerTrip, 120);                     // same load
});

test("Perks: a Trade 21 Courier sells 600 t iron at the hub for 5,280 cr (4,800 + 10%)", () => {
  const state = gameWithCourier();
  state.skills.trade.xp = XP_TABLE[21];
  state.inventory.iron_ore = 600;
  startHaulJob(state, "ship-2", START);
  processJobs(state, START + HUB_SALE);
  assert.equal(state.credits, 5280);
});

test("Perks: home sales get no Trade perk (it's for the hub)", () => {
  const state = newGame();
  state.skills.trade.xp = XP_TABLE[50];
  state.inventory.iron_ore = 100;
  assert.equal(sellAll(state, "iron_ore").credits, 500);
});

test("Loading: rate by hull size - small 20 t/s, medium 40 t/s", () => {
  assert.equal(HULL_SIZES.small.loadingRate, 20);
  assert.equal(HULL_SIZES.medium.loadingRate, 40);
  assert.equal(PROSPECTOR.unloadMs, 6 * SECOND);     // 120 t / 20
  assert.equal(EXCAVATOR.unloadMs, 12 * SECOND);     // 480 t / 40
});

test("Loading: a constant-run Courier with 200 t loads and unloads in 10s each, not 30s", () => {
  const state = gameWithCourier("constant");
  state.inventory.iron_ore = 200;
  const job = startHaulJob(state, "ship-2", START);
  assert.equal(job.loadMs, 10 * SECOND);
  assert.equal(job.tradeMs, 10 * SECOND);
  assert.equal(job.durationMs, 10 * SECOND + 180 * SECOND + 10 * SECOND + 180 * SECOND);
});

test("Loading: ore arrives at the END of unloading, not when the barge docks", () => {
  const state = newGame();
  startMiningJob(state, "ship-1", "inner_belt", START);
  processJobs(state, START + TRIP - PROSPECTOR.unloadMs);   // just docked
  assert.equal(state.inventory.iron_ore, 0);
  processJobs(state, START + TRIP);
  assert.equal(state.inventory.iron_ore, 120);
});

test("Loading: a Courier recalled while still loading stands down, cargo back at once", () => {
  const state = gameWithCourier();
  state.inventory.iron_ore = 600;
  const job = startHaulJob(state, "ship-2", START);
  assert.equal(state.inventory.iron_ore, 0);           // loading: it's aboard
  const recall = recallJob(state, job.id, START + 10 * SECOND);
  assert.equal(recall.mode, "stoodDown");
  assert.equal(state.inventory.iron_ore, 600);         // straight back in the hold
  assert.equal(state.jobs.length, 0);
});

test("Components: every hull's parts - barges get a drill, freighters don't", () => {
  assert.deepEqual(getHullParts("prospector"), ["drill", "hold", "drive"]);
  assert.deepEqual(getHullParts("excavator"), ["drill", "hold", "drive"]);
  assert.deepEqual(getHullParts("courier"), ["hold", "drive"]);
  assert.equal(getUpgradeName(SHIP_UPGRADES.prospector_drill_2), "Prospector drill Mk II");
});

test("Components: Mk I is credits only, Mk II and III also need workshop products", () => {
  for (const upgrade of Object.values(SHIP_UPGRADES)) {
    const hasGoods = Object.keys(upgrade.costs).length > 0;
    assert.equal(hasGoods, upgrade.grade > 1, upgrade.hull + " " + upgrade.part + " " + upgrade.grade);
  }
});

test("Components: no two components unlock at the same level of the same skill", () => {
  // Dan: spread unlocks out across the 99 levels.
  const seen = {};
  for (const upgrade of Object.values(SHIP_UPGRADES)) {
    const key = upgrade.skill + upgrade.level;
    assert.ok(!seen[key], "two components at " + key);
    seen[key] = true;
  }
});

test("Components: rules in order - level, then grades in order, then cost", () => {
  const state = newGame();
  state.credits = 1_000_000;
  // Drill Mk I needs Mining 2
  assert.deepEqual(canBuyShipUpgrade(state, "prospector_drill_1"), { ok: false, reason: "Needs Mining 2." });
  state.skills.mining.xp = XP_TABLE[30];
  // No Mk II before Mk I
  assert.deepEqual(canBuyShipUpgrade(state, "prospector_drill_2"), { ok: false, reason: "Needs Prospector drill Mk I first." });
  assert.ok(buyShipUpgrade(state, "prospector_drill_1").ok);
  assert.equal(state.credits, 1_000_000 - 3000);
  // Mk II needs 40 t wiring coils
  assert.deepEqual(canBuyShipUpgrade(state, "prospector_drill_2"), { ok: false, reason: "Need 40 t more wiring coils." });
  state.inventory.wiring_coils = 40;
  state.bonded.wiring_coils = 40;                    // bonded stock counts (the same as station upgrades)
  assert.ok(buyShipUpgrade(state, "prospector_drill_2").ok);
  assert.equal(state.inventory.wiring_coils, 0);
  assert.equal(getPartGrade(state, "prospector", "drill"), 2);
  assert.deepEqual(canBuyShipUpgrade(state, "prospector_drill_2"), { ok: false, reason: "Already fitted." });
  // Not enough credits
  state.credits = 10;
  state.inventory.thruster_assembly = 60;
  assert.equal(canBuyShipUpgrade(state, "prospector_drill_3").ok, false);
  assert.equal(state.inventory.thruster_assembly, 60);   // a refused buy takes nothing
});

test("Components: stats add up - Mk I hold 138 t, Mk II drill + Mining 11 = 120 x 1.35 t/min", () => {
  const state = newGame();
  state.shipUpgrades = { prospector: { drill: 2, hold: 1, drive: 1 } };
  state.skills.mining.xp = XP_TABLE[11];             // +5% drill perk
  const stats = getShipStats(state, "prospector");
  assert.equal(stats.cargoCapacity, 138);            // 120 x 1.15
  assert.ok(Math.abs(stats.miningRate - 120 * 1.35) < 1e-9);   // 1 + 0.15 + 0.15 + 0.05
  assert.ok(Math.abs(stats.speed - 1.1) < 1e-12);
  // Other hulls are untouched: components are per hull TYPE.
  assert.equal(getShipStats(state, "excavator").cargoCapacity, 480);
});

test("Components: a hold upgrade always gives whole tonnes (Excavator 480 x 1.45 = 696)", () => {
  const state = newGame();
  state.shipUpgrades = { excavator: { hold: 3 } };
  assert.equal(getShipStats(state, "excavator").cargoCapacity, 696);
  for (const grade of [1, 2, 3]) {
    for (const hull of ["prospector", "excavator", "courier"]) {
      state.shipUpgrades = { [hull]: { hold: grade } };
      assert.ok(Number.isInteger(getShipStats(state, hull).cargoCapacity));
    }
  }
});

test("Components: a ship mid-trip finishes it as it was; the NEXT trip uses the new component", () => {
  const state = newGame();
  state.skills.mining.xp = XP_TABLE[3];
  state.credits = 10_000;
  const job = startMiningJob(state, "ship-1", "inner_belt", START);
  const firstTrip = job.durationMs;
  buyShipUpgrade(state, "prospector_hold_1");        // bought mid-trip
  processJobs(state, START + firstTrip);
  assert.equal(state.inventory.iron_ore, 120);       // no ore it never mined
  assert.equal(job.orePerTrip, 138);                 // the next trip has the bigger hold
  assert.ok(job.durationMs > firstTrip);             // which takes longer to fill and unload
});

test("Components: one purchase fits ships bought later too", () => {
  const state = newGame();
  state.skills.mining.xp = XP_TABLE[3];
  state.credits = 1_000_000;
  buyShipUpgrade(state, "prospector_hold_1");
  buyShip(state, "prospector");                       // bought after the component
  const job = startMiningJob(state, "ship-2", "inner_belt", START);
  assert.equal(job.orePerTrip, 138);
});

test("Components: a component unlock shows at its exact level (for the level-up banner)", () => {
  assert.deepEqual(getShipUpgradeUnlocksAtLevel("mining", 2), ["prospector_drill_1"]);
  assert.deepEqual(getShipUpgradeUnlocksAtLevel("trade", 2), ["courier_hold_1"]);
  assert.deepEqual(getShipUpgradeUnlocksAtLevel("mining", 4), []);
});

test("Components: Prospector drill Mk I is an early goal - affordable within about 15 minutes", () => {
  // Design doc, early cadence: a next goal every 10 to 20 minutes.
  const creditsPerHour = PROSPECTOR.orePerTrip * ITEMS.iron_ore.sellPrice * (HOUR / TRIP);
  const minutes = SHIP_UPGRADES.prospector_drill_1.credits / creditsPerHour * 60;
  assert.ok(minutes > 5 && minutes < 20, minutes.toFixed(1) + " minutes");
});

test("Save: a version 13 save gets no components, and trips in flight finish on time", () => {
  const old = newGame();
  startMiningJob(old, "ship-1", "inner_belt", START);
  // What version 13 saved: no unload time, no stored load.
  const job = old.jobs[0];
  job.durationMs = 150 * SECOND;
  delete job.unloadMs;
  delete job.orePerTrip;
  delete old.shipUpgrades;
  old.version = 13;
  const state = parseSave(JSON.stringify(old));
  assert.equal(state.version, SAVE_VERSION);
  assert.deepEqual(state.shipUpgrades, {});
  assert.equal(state.jobs[0].unloadMs, 0);
  assert.equal(state.jobs[0].orePerTrip, 120);
  // The trip in flight ends when it always would have (150s)...
  processJobs(state, START + 150 * SECOND);
  assert.equal(state.inventory.iron_ore, 120);
  // ...and the next one is planned with unloading time.
  assert.equal(state.jobs[0].durationMs, 156 * SECOND);
});

test("Engine: with components bought part way, ticking and jumping still end identical", () => {
  // A component purchase is an action at a moment; the engine must still give
  // the same result however that time is played.
  function play(stepMs) {
    const state = busyEmpire();
    state.skills.mining.xp = XP_TABLE[20];
    state.skills.trade.xp = XP_TABLE[12];
    for (let t = stepMs; t <= 2 * HOUR; t += stepMs) {
      advanceTo(state, START + t);
      if (t === HOUR) {                              // buy components at the 1 hour mark
        buyShipUpgrade(state, "prospector_drill_1");
        buyShipUpgrade(state, "excavator_hold_1");
        buyShipUpgrade(state, "courier_drive_1");
      }
    }
    return state;
  }
  const ticked = play(250);
  const jumped = play(HOUR);
  assert.equal(getPartGrade(jumped, "courier", "drive"), 1);
  assert.deepEqual(ticked, jumped);
});

test("Hardpoints: a marker per component, numbered by Mk; no drill marker on a freighter", () => {
  // Prospector with drill Mk II, stock hold, drive Mk I
  const art = getShipArt("hull_prospector", { drill: 2, hold: 0, drive: 1 });
  assert.equal((art.match(/class="hardpoint /g) || []).length, 3);
  assert.equal((art.match(/hardpoint fitted/g) || []).length, 2);
  assert.equal((art.match(/hardpoint stock/g) || []).length, 1);
  assert.ok(art.includes(">II<") && art.includes(">I<"));
  assert.ok(art.trim().endsWith("</svg>"));            // markers sit inside the drawing
  // Courier: hold and drive only
  const courier = getShipArt("hull_courier", { hold: 3, drive: 0 });
  assert.equal((courier.match(/class="hardpoint /g) || []).length, 2);
  assert.ok(courier.includes(">III<"));
  // Hover labels ride on each marker
  const labelled = getShipArt("hull_courier", { hold: 1, drive: 0 },
    { hold: ["Cargo hold", "Mk I fitted · +15% cargo"], drive: ["Drive", "Stock part"] });
  assert.ok(labelled.includes('data-tip-title="Cargo hold" data-tip="Mk I fitted · +15% cargo"'));
  assert.ok(labelled.includes('data-tip-title="Drive" data-tip="Stock part"'));
});

// =============================================================
// RETROFIT WHEN DOCKED (Dan, 30 Oct): a component bought while a
// ship is out is only fitted once it's back at the station.
// =============================================================

test("Retrofit: a docked ship gets a new component straight away", () => {
  const state = newGame();
  state.skills.mining.xp = XP_TABLE[3];
  state.credits = 10_000;
  buyShipUpgrade(state, "prospector_hold_1");
  const ship = state.ships[0];
  assert.deepEqual(getShipGrades(state, ship), { drill: 0, hold: 1, drive: 0 });
  assert.deepEqual(getPendingRefits(state, ship), {});
});

test("Retrofit: a ship out working keeps its old parts until it's home, then it's fitted", () => {
  const state = newGame();
  state.skills.mining.xp = XP_TABLE[3];
  state.credits = 10_000;
  startMiningJob(state, "ship-1", "inner_belt", START);
  buyShipUpgrade(state, "prospector_hold_1");        // bought while it's out
  const ship = state.ships[0];
  assert.deepEqual(getShipGrades(state, ship), { drill: 0, hold: 0, drive: 0 });
  assert.deepEqual(getPendingRefits(state, ship), { hold: 1 });
  // Its stats on screen are its OLD ones (120 t), not the hull's (138 t)
  assert.equal(getShipStats(state, "prospector", getShipGrades(state, ship)).cargoCapacity, 120);

  // Back home, unloaded: the next trip leaves refitted.
  processJobs(state, START + TRIP);
  assert.deepEqual(getShipGrades(state, ship), { drill: 0, hold: 1, drive: 0 });
  assert.deepEqual(getPendingRefits(state, ship), {});
  assert.equal(state.jobs[0].orePerTrip, 138);
});

test("Retrofit: a freighter waiting at the dock is refitted at once; one flying waits", () => {
  const state = gameWithCourier();
  state.skills.trade.xp = XP_TABLE[4];
  state.credits = 1_000_000;
  state.inventory.iron_ore = 600;
  const job = startHaulJob(state, "ship-2", START);     // loads and leaves
  const courier = state.ships[1];
  buyShipUpgrade(state, "courier_drive_1");
  assert.deepEqual(getPendingRefits(state, courier), { drive: 1 });
  processJobs(state, START + HAUL.durationMs);          // back home, waiting
  assert.equal(job.status, "waiting");
  assert.deepEqual(getPendingRefits(state, courier), {});
  assert.equal(getShipGrades(state, courier).drive, 1);
});


// =============================================================
// EXPLORATION (scouts, survey targets, deep scans)
// =============================================================

// A new game that has sold its first ore and owns a Pathfinder
// (ship-2), with plenty of credits.
function gameWithScout() {
  const state = newGame();
  state.credits = 100_000;
  state.milestones.firstSale = true;
  buyShip(state, "pathfinder");
  return state;
}

test("Exploration: the Pathfinder and the tab unlock with the first sale, not before", () => {
  const state = newGame();
  state.credits = 100_000;
  assert.equal(isShipTypeUnlocked(state, "pathfinder"), false);
  assert.equal(isExplorationOpen(state), false);
  assert.equal(buyShip(state, "pathfinder"), null);       // can't buy it yet

  state.inventory.iron_ore = 10;
  sellAll(state, "iron_ore");                             // the first sale
  assert.equal(isShipTypeUnlocked(state, "pathfinder"), true);
  assert.equal(isExplorationOpen(state), true);
  assert.ok(buyShip(state, "pathfinder"));
});

test("Exploration: a survey trip is fly out, scan, fly back, timed by drive speed", () => {
  const state = gameWithScout();
  const target = SURVEY_TARGETS.inner_belt_survey;
  const plan = getScoutPlan(state, "pathfinder", "inner_belt_survey");
  const travel = Math.round(target.travelSeconds / SHIP_TYPES.pathfinder.speed * 1000);
  assert.equal(plan.outboundMs, travel);
  assert.equal(plan.returnMs, travel);
  assert.equal(plan.scanMs, target.scanSeconds * 1000);   // level 1: full scan time
  assert.equal(plan.durationMs, travel * 2 + target.scanSeconds * 1000);
});

test("Exploration: each level scans 0.5% faster", () => {
  const state = gameWithScout();
  state.skills.exploration.xp = XP_TABLE[11];
  const plan = getScoutPlan(state, "pathfinder", "inner_belt_survey");
  assert.equal(plan.scanMs, Math.round(SURVEY_TARGETS.inner_belt_survey.scanSeconds * 1000 * 0.95));
});

test("Exploration: finishing a survey gives its find and XP once, then moves on", () => {
  const state = gameWithScout();
  const target = SURVEY_TARGETS.inner_belt_survey;
  const creditsBefore = state.credits;
  const job = startScoutJob(state, "ship-2", "inner_belt_survey", START);
  const trip = job.durationMs;

  // Nothing until it's home again
  processJobs(state, START + trip - 1);
  assert.equal(state.skills.exploration.xp, 0);

  const results = processJobs(state, START + trip);
  assert.equal(state.credits, creditsBefore + target.credits);
  assert.equal(state.skills.exploration.xp, target.xp);
  assert.equal(getTargetStatus(state, "inner_belt_survey"), "surveyed");
  assert.deepEqual(results[0].surveys, ["inner_belt_survey"]);
  assert.equal(results[0].finds[0].credits, target.credits);

  // Still short of Exploration 2 (the next target's level), so it
  // moved straight on to deep scans to make up the rest (Dan, 30 Oct)
  assert.equal(job.targetId, DEEP_SCAN_ID);
  assert.equal(state.ships[1].destination, DEEP_SCAN_ID);
  assert.equal(job.startedAt, START + trip);
});

test("Exploration: a survey alone never reaches the next target's level (deep scans make up the rest)", () => {
  // Dan, 30 Oct: if every survey handed out the next level, the
  // level would mean nothing. Play the targets in order: after each
  // one's XP, the player must still be short of the NEXT unlock.
  const ids = Object.keys(SURVEY_TARGETS);
  let xp = 0;
  for (let i = 0; i < ids.length - 1; i++) {
    xp += SURVEY_TARGETS[ids[i]].xp;
    const nextLevel = SURVEY_TARGETS[ids[i + 1]].unlockLevel;
    if (nextLevel > getLevelForXp(xp - SURVEY_TARGETS[ids[i]].xp)) {
      // (only where the next target needs a level above where the
      // player was when this survey started)
      assert.ok(getLevelForXp(xp) < nextLevel,
        `${ids[i]} alone takes the player to Exploration ${getLevelForXp(xp)}, ` +
        `enough for ${ids[i + 1]} (${nextLevel}) with no deep scans`);
    }
    // Deep scans then make up the rest of the way
    xp = Math.max(xp, XP_TABLE[nextLevel]);
  }
});

test("Exploration: goods found go into the home hold", () => {
  const state = gameWithScout();
  state.skills.exploration.xp = XP_TABLE[2];
  const target = SURVEY_TARGETS.outer_belt_survey;
  const job = startScoutJob(state, "ship-2", "outer_belt_survey", START);
  processJobs(state, START + job.durationMs);
  assert.equal(state.inventory[target.item], target.tonnes);
});

test("Exploration: deep scans needed per level start at 1 and rise with the level", () => {
  // Dan, 30 Oct: "one for level 2, 2 for 3 etc." Play it the way a
  // scout does: each level, survey whatever has just opened, then
  // deep scan until the next level. Count the deep scans per level.
  const ids = Object.keys(SURVEY_TARGETS);
  const done = new Set();
  let xp = 0;
  const scansFor = {};   // level -> deep scans it took to reach it
  for (let level = 2; level <= 15; level++) {
    // Surveys open at the current level (and their earlier stage done) go first
    for (const id of ids) {
      const target = SURVEY_TARGETS[id];
      if (!done.has(id) && target.unlockLevel <= level - 1 && (!target.requires || done.has(target.requires))) {
        xp += target.xp;
        done.add(id);
      }
    }
    const scans = Math.max(0, Math.ceil((XP_TABLE[level] - xp) / DEEP_SCAN.xp));
    scansFor[level] = scans;
    xp += scans * DEEP_SCAN.xp;
  }
  assert.equal(scansFor[2], 1, "level 2 should take one deep scan");
  for (let level = 3; level <= 15; level++) {
    assert.ok(scansFor[level] >= 1, `level ${level} needs no deep scans`);
    // Rising: never fewer than one below the level before
    assert.ok(scansFor[level] >= scansFor[level - 1] - 1,
      `level ${level} takes ${scansFor[level]} deep scans, level ${level - 1} took ${scansFor[level - 1]}`);
  }
  assert.ok(scansFor[15] >= 3 * scansFor[3], "late levels should take several times the early ones");
});

test("Pathfinder components: a sensor array Mk I makes scans 15% faster", () => {
  const state = gameWithScout();
  const before = getScoutPlan(state, "pathfinder", "inner_belt_survey");
  assert.equal(canBuyShipUpgrade(state, "pathfinder_sensors_1").ok, false);   // Exploration 2 needed
  state.skills.exploration.xp = XP_TABLE[2];
  assert.equal(buyShipUpgrade(state, "pathfinder_sensors_1").ok, true);
  const after = getScoutPlan(state, "pathfinder", "inner_belt_survey");
  // Level 2 shortens it 0.5%, the sensors divide it by 1.15
  assert.equal(after.scanMs, Math.round(SURVEY_TARGETS.inner_belt_survey.scanSeconds * 1000 * 0.995 / 1.15));
  assert.equal(after.outboundMs, before.outboundMs);    // the drive is untouched
});

test("Pathfinder components: the drive Mk I makes trips 10% faster, and only scouts have sensors", () => {
  const state = gameWithScout();
  state.skills.exploration.xp = XP_TABLE[4];
  buyShipUpgrade(state, "pathfinder_drive_1");
  const plan = getScoutPlan(state, "pathfinder", "inner_belt_survey");
  assert.equal(plan.outboundMs, Math.round(SURVEY_TARGETS.inner_belt_survey.travelSeconds / (SHIP_TYPES.pathfinder.speed * 1.1) * 1000));
  assert.deepEqual(getHullParts("pathfinder"), ["drive", "sensors"]);
  assert.equal(getShipStats(state, "prospector").scanRate, undefined);
});

test("Exploration: locked targets and out-of-order wreck stages are refused", () => {
  const state = gameWithScout();
  assert.equal(getTargetStatus(state, "wreck_1"), "locked");               // Exploration 3 needed
  assert.equal(startScoutJob(state, "ship-2", "wreck_1", START), null);
  state.skills.exploration.xp = XP_TABLE[10];
  assert.equal(getTargetStatus(state, "wreck_2"), "needs");                // wreck_1 first
  assert.equal(startScoutJob(state, "ship-2", "wreck_2", START), null);
  assert.equal(getTargetStatus(state, "wreck_1"), "needs");                // needs the Outer Belt survey
  state.exploration.surveyed.outer_belt_survey = true;
  assert.equal(getTargetStatus(state, "wreck_1"), "available");
});

test("Exploration: two scouts never survey the same target", () => {
  const state = gameWithScout();
  buyShip(state, "pathfinder");                           // ship-3
  startScoutJob(state, "ship-2", "inner_belt_survey", START);
  assert.equal(startScoutJob(state, "ship-3", "inner_belt_survey", START), null);
  // The next best thing for ship-3 at Exploration 1 is a deep scan
  assert.equal(chooseNextTarget(state, "ship-3"), DEEP_SCAN_ID);
});

test("Exploration: with every target done, a scout deep scans forever", () => {
  const state = gameWithScout();
  for (const id of Object.keys(SURVEY_TARGETS)) state.exploration.surveyed[id] = true;
  assert.equal(chooseNextTarget(state, "ship-2"), DEEP_SCAN_ID);
  const job = startScoutJob(state, "ship-2", DEEP_SCAN_ID, START);
  const trip = job.durationMs;
  processJobs(state, START + trip * 10);
  assert.equal(state.exploration.deepScans, 10);
  assert.equal(state.skills.exploration.xp, DEEP_SCAN.xp * 10);
  assert.equal(job.targetId, DEEP_SCAN_ID);
});

test("Exploration: deep scan finds come from the save's seed, the same every time", () => {
  // The dice roll is fixed for a seed and scan number...
  assert.equal(rollFor(12345, 7, 0), rollFor(12345, 7, 0));
  assert.notEqual(rollFor(12345, 7, 0), rollFor(12345, 8, 0));
  // ...always between 0 and 1, and spread out (about 30% of 10,000
  // rolls land under 0.3)
  let under = 0;
  for (let n = 0; n < 10000; n++) {
    const roll = rollFor(99, n, 0);
    assert.ok(roll >= 0 && roll < 1);
    if (roll < 0.3) under++;
  }
  assert.ok(under > 2800 && under < 3200, "spread looks wrong: " + under);

  // Two saves with the same seed find exactly the same things.
  const runDeepScans = () => {
    const state = gameWithScout();
    for (const id of Object.keys(SURVEY_TARGETS)) state.exploration.surveyed[id] = true;
    const job = startScoutJob(state, "ship-2", DEEP_SCAN_ID, START);
    processJobs(state, START + job.durationMs * 50);
    return state;
  };
  const a = runDeepScans();
  const b = runDeepScans();
  assert.equal(a.credits, b.credits);
  assert.equal(a.inventory.wreck_alloy, b.inventory.wreck_alloy);
  assert.ok(a.exploration.deepFinds > 5 && a.exploration.deepFinds < 30);   // about 30% of 50
});

test("Exploration: recalled mid-scan, a scout brings nothing back and the target stays open", () => {
  const state = gameWithScout();
  const job = startScoutJob(state, "ship-2", "inner_belt_survey", START);
  const midScan = START + job.outboundMs + 10 * SECOND;
  const recall = recallJob(state, job.id, midScan);
  assert.equal(recall.mode, "leftEarly");
  processJobs(state, midScan + job.returnMs);
  assert.equal(state.jobs.length, 0);                       // docked and stays docked
  assert.equal(state.skills.exploration.xp, 0);
  assert.equal(getTargetStatus(state, "inner_belt_survey"), "available");
});

test("Exploration: recalled on the way out, then resumed, it carries on to its target", () => {
  const state = gameWithScout();
  const job = startScoutJob(state, "ship-2", "inner_belt_survey", START);
  const trip = job.durationMs;
  recallJob(state, job.id, START + 10 * SECOND);            // turns round
  resumeJob(state, job.id, START + 15 * SECOND);            // 5 s lost heading home
  assert.equal(job.abandoned, undefined);
  processJobs(state, START + trip + 10 * SECOND);           // 2 x 5 s later than planned
  assert.equal(getTargetStatus(state, "inner_belt_survey"), "surveyed");
});

test("Exploration: two scouts share XP by the fleet rule", () => {
  const state = gameWithScout();
  buyShip(state, "pathfinder");
  for (const id of Object.keys(SURVEY_TARGETS)) state.exploration.surveyed[id] = true;
  const job = startScoutJob(state, "ship-2", DEEP_SCAN_ID, START);
  startScoutJob(state, "ship-3", DEEP_SCAN_ID, START);
  processJobs(state, START + job.durationMs);
  // 2 ships: each keeps 2^(0.6 - 1) = 76% of its XP
  assert.ok(Math.abs(state.skills.exploration.xp - 2 * DEEP_SCAN.xp * 2 ** -0.4) < 1e-9);
});

test("Exploration: a version 14 save gains Exploration, and the first sale if it has played", () => {
  const played = newGame();
  played.version = 14;
  delete played.exploration; delete played.milestones; delete played.skills.exploration;
  played.skills.mining.xp = 500;
  const fresh = JSON.parse(JSON.stringify(played));
  fresh.skills.mining.xp = 0;

  const a = parseSave(JSON.stringify(played));
  assert.equal(a.version, SAVE_VERSION);
  assert.deepEqual(a.skills.exploration, { xp: 0 });
  assert.deepEqual(a.exploration.surveyed, {});
  assert.equal(typeof a.exploration.seed, "number");
  assert.equal(a.milestones.firstSale, true);

  const b = parseSave(JSON.stringify(fresh));
  assert.equal(b.milestones.firstSale, undefined);        // hasn't sold anything yet
});

// =============================================================
// CONTRACTS (the belt independents' board)
// =============================================================

// A game with the board open (Mining 3) and the first contracts posted.
function gameWithBoard() {
  const state = newGame();
  state.skills.mining.xp = XP_TABLE[CONTRACTS.openAtMiningLevel];
  processJobs(state, START);
  return state;
}

// Puts a contract of one kind in slot 0 (instead of whatever was rolled).
function forceContract(state, kindId, fields) {
  const kind = CONTRACT_KINDS[kindId];
  state.contracts.slots[0].contract = {
    number: 999, faction: "independents", kindId, itemId: null, fieldId: null, targetId: null,
    amount: kind.amount, baseline: 0, credits: 1000, reputation: kind.reputation,
    client: "Test client", ...fields,
  };
  return state.contracts.slots[0].contract;
}

test("Contracts: the board opens at Mining 3 with three contracts", () => {
  const state = newGame();
  processJobs(state, START);
  assert.equal(isBoardOpen(state), false);
  assert.ok(state.contracts.slots.every((slot) => slot.contract === null));
  const open = gameWithBoard();
  assert.equal(open.contracts.slots.length, CONTRACTS.slots);
  assert.ok(open.contracts.slots.every((slot) => slot.contract !== null));
});

test("Contracts: only kinds the player can do are posted (no metal before the refinery)", () => {
  const state = gameWithBoard();
  assert.equal(getSubjects(state, "metal_requisition").length, 0);
  assert.equal(getSubjects(state, "survey_request").length, 0);     // Exploration not open
  assert.equal(getSubjects(state, "deep_scan_contract").length, 0); // no scout
  for (const slot of state.contracts.slots) {
    assert.ok(["ore_requisition", "mining_charter"].includes(slot.contract.kindId), slot.contract.kindId);
  }
  // Only two different contracts exist this early (iron ore, Inner
  // Belt charter), so the third is a repeat of one: board still full.
  const keys = state.contracts.slots.map((s) => s.contract.kindId + s.contract.itemId + s.contract.fieldId);
  assert.equal(new Set(keys).size, 2);
});

test("Contracts: with plenty to choose from, the board never shows the same contract twice", () => {
  const state = newGame();
  state.skills.mining.xp = XP_TABLE[12];               // both fields, refinery open
  state.skills.refining.xp = XP_TABLE[15];             // every metal recipe
  for (let round = 0; round < 20; round++) {
    for (let slot = 0; slot < CONTRACTS.slots; slot++) discardContract(state, slot, START);
    for (const slot of state.contracts.slots) slot.readyAt = null;
    checkContracts(state, START);
    const keys = state.contracts.slots.map((s) => s.contract.kindId + s.contract.itemId + s.contract.fieldId);
    assert.equal(new Set(keys).size, keys.length, keys.join(" / "));
  }
});

test("Contracts: a delivery takes the goods and pays, and the slot refills 10 minutes later", () => {
  const state = gameWithBoard();
  const contract = forceContract(state, "ore_requisition", { itemId: "iron_ore", amount: 150, credits: 1130 });
  assert.equal(canDeliver(state, 0).ok, false);
  assert.match(canDeliver(state, 0).reason, /150 t more iron ore/);
  state.inventory.iron_ore = 200;
  const credits = state.credits;
  const result = deliverContract(state, 0, START);
  assert.equal(result.kind, "contract");
  assert.equal(state.inventory.iron_ore, 50);
  assert.equal(state.credits, credits + 1130);
  assert.equal(getReputation(state, "independents"), contract.reputation);
  assert.equal(state.contracts.slots[0].contract, null);

  // A new contract arrives exactly 10 minutes later, not before
  processJobs(state, START + CONTRACTS.refillMinutes * MINUTE - 1);
  assert.equal(state.contracts.slots[0].contract, null);
  processJobs(state, START + CONTRACTS.refillMinutes * MINUTE);
  assert.ok(state.contracts.slots[0].contract);
});

test("Contracts: deliveries leave bonded stock alone", () => {
  const state = gameWithBoard();
  forceContract(state, "ore_requisition", { itemId: "iron_ore", amount: 150 });
  state.inventory.iron_ore = 200;
  setBond(state, "iron_ore", 100);
  assert.equal(canDeliver(state, 0).ok, false);       // only 100 t above the bond
  assert.equal(getProgress(state, state.contracts.slots[0].contract).have, 100);
});

// --- Charters (30 Oct: replaced the "you keep the ore" quotas) ---

// A charter in slot 0 for "amount" tonnes from a field.
function forceCharter(state, fieldId, amount) {
  return forceContract(state, "mining_charter", {
    itemId: FIELDS[fieldId].yields, fieldId, amount, credits: 900, shipId: null, delivered: 0,
  });
}

test("Charter: a docked ship lent to a charter hands its hauls to the client, then the contract pays", () => {
  // Why: the core rule. 200 t owed, a Prospector holds 120 t:
  // trip 1 gives 120 t, trip 2 gives the last 80 t and the other
  // 40 t go into your hold. Then it pays and the ship is free.
  const state = gameWithBoard();
  const contract = forceCharter(state, "inner_belt", 200);
  const credits = state.credits;
  assert.equal(charterShip(state, 0, "ship-1").ok, true);
  startMiningJob(state, "ship-1", state.ships[0].destination, START);
  const trip = state.jobs[0].durationMs;

  processJobs(state, START + trip);
  assert.equal(contract.delivered, 120);
  assert.equal(state.inventory.iron_ore, 0);            // none of it was yours

  const results = processJobs(state, START + trip * 2);
  assert.ok(results.some((r) => r.kind === "contract"), "the charter finished");
  assert.equal(state.credits, credits + 900);
  assert.equal(state.inventory.iron_ore, 40);           // the extra 40 t is yours
  assert.equal(getCharter(state, "ship-1"), null);      // free again
  assert.ok(state.skills.mining.xp > XP_TABLE[3], "Mining XP still earned");
});

test("Charter: a ship already working starts its charter from its next departure", () => {
  // Why: a charter never changes a trip that's under way. The trip
  // in progress (Inner Belt) is yours; the next goes to the charter's
  // field (the Outer Belt).
  const state = newGame();
  state.skills.mining.xp = XP_TABLE[5];
  processJobs(state, START);
  startMiningJob(state, "ship-1", "inner_belt", START);
  const contract = forceCharter(state, "outer_belt", 300);
  charterShip(state, 0, "ship-1");
  const firstTrip = state.jobs[0].durationMs;
  processJobs(state, START + firstTrip);
  assert.equal(state.inventory.iron_ore, 120);          // the first trip was yours
  assert.equal(contract.delivered, 0);
  assert.equal(state.jobs[0].fieldId, "outer_belt");    // now heading to the charter's field
});

test("Charter: a chartered ship can't be sold, re-chartered or lent twice", () => {
  const state = gameWithBoard();
  state.credits = 100000;
  buyShip(state, "prospector");
  forceCharter(state, "inner_belt", 200);
  charterShip(state, 0, "ship-1");
  assert.equal(canSellShip(state, "ship-1").ok, false);
  assert.equal(canCharter(state, 0, "ship-2").ok, false);   // this charter has its ship
});

test("Charter: discarding it frees the ship, and its next haul is yours", () => {
  const state = gameWithBoard();
  const contract = forceCharter(state, "inner_belt", 500);
  charterShip(state, 0, "ship-1");
  startMiningJob(state, "ship-1", "inner_belt", START);
  const trip = state.jobs[0].durationMs;
  discardContract(state, 0, START + 1000);              // mid-trip
  processJobs(state, START + trip);
  assert.equal(state.inventory.iron_ore, 120);
  assert.equal(getCharter(state, "ship-1"), null);
});

test("Charter: one jump gives the same result as playing it minute by minute", () => {
  // Why: everything must come out the same offline (the engine rule).
  const make = () => {
    const state = gameWithBoard();
    forceCharter(state, "inner_belt", 300);
    charterShip(state, 0, "ship-1");
    startMiningJob(state, "ship-1", "inner_belt", START);
    return state;
  };
  const jumped = make();
  processJobs(jumped, START + 60 * MINUTE);
  const stepped = make();
  for (let t = MINUTE; t <= 60 * MINUTE; t += MINUTE) processJobs(stepped, START + t);
  assert.deepEqual(jumped.contracts, stepped.contracts);
  assert.deepEqual(jumped.inventory, stepped.inventory);
  assert.equal(jumped.credits, stepped.credits);
});

// --- Diplomacy (30 Oct) ---

test("Diplomacy: a finished contract earns Diplomacy XP, more at a higher tier", () => {
  const state = gameWithBoard();
  const contract = forceContract(state, "ore_requisition", { itemId: "iron_ore", amount: 10 });
  state.inventory.iron_ore = 10;
  const result = deliverContract(state, 0, START);
  assert.equal(result.xpGained, CONTRACT_KINDS.ore_requisition.xp);
  assert.equal(state.skills.diplomacy.xp, CONTRACT_KINDS.ore_requisition.xp);
  state.contracts.reputation.independents = REPUTATION_TIERS[2].from;   // Trusted: x2 size
  assert.equal(getContractXp(state, contract), CONTRACT_KINDS.ore_requisition.xp * REPUTATION_TIERS[2].size);
});

test("Diplomacy: each slot level adds a contract to the board, posted straight away", () => {
  const state = gameWithBoard();
  assert.equal(state.contracts.slots.length, CONTRACTS.slots);
  state.skills.diplomacy.xp = XP_TABLE[CONTRACTS.slotLevels[0]];
  assert.equal(getBoardSlotCount(state), CONTRACTS.slots + 1);
  checkContracts(state, START);
  assert.equal(state.contracts.slots.length, CONTRACTS.slots + 1);
  assert.ok(state.contracts.slots[CONTRACTS.slots].contract, "the new slot has a contract");
  state.skills.diplomacy.xp = XP_TABLE[CONTRACTS.slotLevels[1]];
  assert.equal(getBoardSlotCount(state), CONTRACTS.slots + 2);
});

test("Save: a version 17 save gets Diplomacy and room for ice, and loses its old quotas", () => {
  const old = gameWithBoard();
  old.version = 17;
  delete old.skills.diplomacy;
  delete old.inventory.ice;
  old.contracts.slots[0].contract = { ...old.contracts.slots[0].contract, kindId: "mining_quota" };
  const state = parseSave(JSON.stringify(old));
  assert.equal(state.version, SAVE_VERSION);
  assert.deepEqual(state.skills.diplomacy, { xp: 0 });
  assert.equal(state.inventory.ice, 0);
  assert.notEqual(state.contracts.slots[0].contract?.kindId, "mining_quota");   // cleared (and reposted)
});

test("Contracts: a survey request pays when the target is surveyed", () => {
  const state = gameWithScout();
  state.skills.mining.xp = XP_TABLE[3];
  processJobs(state, START);
  forceContract(state, "survey_request", { targetId: "inner_belt_survey", amount: 1 });
  const job = startScoutJob(state, "ship-2", "inner_belt_survey", START);
  const results = processJobs(state, START + job.durationMs);
  assert.ok(results.some((r) => r.kind === "contract" && r.contract.kindId === "survey_request"));
});

test("Contracts: discarding empties the slot and a new one comes after the wait", () => {
  const state = gameWithBoard();
  assert.equal(discardContract(state, 1, START), true);
  assert.equal(state.contracts.slots[1].contract, null);
  processJobs(state, START + CONTRACTS.refillMinutes * MINUTE);
  assert.ok(state.contracts.slots[1].contract);
  assert.equal(getReputation(state, "independents"), 0);   // discarding earns nothing
});

test("Contracts: reputation tiers make contracts bigger", () => {
  const state = gameWithBoard();
  assert.equal(getTier(state, "independents").name, "Unknown");
  state.contracts.reputation.independents = REPUTATION_TIERS[2].from;
  assert.equal(getTier(state, "independents").name, REPUTATION_TIERS[2].name);
  // Post 60 contracts at each tier: the higher tier's are bigger on average
  const average = (reputation) => {
    const s = gameWithBoard();
    s.contracts.reputation.independents = reputation;
    let total = 0, count = 0;
    for (let i = 0; i < 60; i++) {
      discardContract(s, 0, START);
      processJobs(s, START + 0);   // (posts nothing yet: the wait)
      s.contracts.slots[0].readyAt = null;
      checkContracts(s, START);
      // Each contract's size against its kind's usual size
      const c = s.contracts.slots[0].contract;
      total += c.amount / CONTRACT_KINDS[c.kindId].amount; count++;
    }
    return total / count;
  };
  assert.ok(average(REPUTATION_TIERS[2].from) > 1.6 * average(0));
});

test("Contracts: the same save posts the same contracts, however it's played", () => {
  const a = gameWithBoard();
  const b = gameWithBoard();
  assert.deepEqual(a.contracts, b.contracts);
  const c = newGame();
  c.exploration.seed = 999;                          // a different save
  c.skills.mining.xp = XP_TABLE[3];
  processJobs(c, START);
  assert.notDeepEqual(c.contracts.slots, a.contracts.slots);
});

test("Contracts: a version 15 save gets an empty board and running totals", () => {
  const old = newGame();
  old.version = 15;
  delete old.contracts; delete old.stats;
  const state = parseSave(JSON.stringify(old));
  assert.equal(state.version, SAVE_VERSION);
  assert.equal(state.contracts.slots.length, CONTRACTS.slots);
  assert.deepEqual(state.stats, { mined: {}, refined: {} });
});

// =============================================================
// FACTIONS (reputation per faction, 30 Oct)
// =============================================================

test("Factions: every contract posted names the faction that posted it", () => {
  // The screen sorts cards into faction boxes by this, and the
  // reputation it pays goes to this faction.
  const state = gameWithBoard();
  for (const slot of state.contracts.slots) {
    assert.ok(slot.contract.faction in CONTRACT_FACTIONS, "a known faction: " + slot.contract.faction);
  }
});

test("Factions: a new game starts at 0 reputation with every faction", () => {
  const state = newGame();
  for (const factionId of Object.keys(CONTRACT_FACTIONS)) {
    assert.equal(getReputation(state, factionId), 0);
  }
});

test("Factions: a finished contract's reputation goes to its own faction only", () => {
  // A pretend second faction, so we can check the points don't
  // land on the wrong one. (Added for this test only, then removed.)
  CONTRACT_FACTIONS.test_rivals = { name: "Test rivals", description: "" };
  try {
    const state = gameWithBoard();
    const contract = forceContract(state, "survey_request", { targetId: Object.keys(SURVEY_TARGETS)[0], faction: "test_rivals" });
    state.exploration.surveyed[contract.targetId] = true;   // the work is done
    checkContracts(state, START);
    assert.equal(getReputation(state, "test_rivals"), contract.reputation);
    assert.equal(getReputation(state, "independents"), 0);
  } finally {
    delete CONTRACT_FACTIONS.test_rivals;
  }
});

test("Factions: a version 16 save keeps its reputation, now with the belt independents", () => {
  // Before 0.2.3, reputation was one number and contracts had no faction.
  const old = gameWithBoard();
  old.version = 16;
  old.contracts.reputation = 140;
  for (const slot of old.contracts.slots) delete slot.contract.faction;
  const state = parseSave(JSON.stringify(old));
  assert.equal(state.version, SAVE_VERSION);
  assert.deepEqual(state.contracts.reputation, { independents: 140 });
  assert.equal(getTier(state, "independents").name, "Known");     // 140 is past Known's 100
  for (const slot of state.contracts.slots) assert.equal(slot.contract.faction, "independents");
});

// =============================================================
// RELEASES (tools/release.js)
// =============================================================

test("Release: index.html is stamped with the version in js/version.js, on every file", () => {
  // If a new file is added (or the version changed by hand) without
  // running "node tools/release.js", a browser could load an old copy
  // of that file after an update. This catches it.
  const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(page.includes(`<meta name="game-version" content="${VERSION}">`), "meta tag version");
  assert.ok(page.includes(`href="css/style.css?v=${VERSION}"`), "stylesheet version");
  assert.ok(page.includes(`src="js/main.js?v=${VERSION}"`), "main.js version");
  for (const folder of ["js", "data"]) {
    for (const name of readdirSync(new URL(`../${folder}/`, import.meta.url))) {
      if (!name.endsWith(".js")) continue;
      const entry = `"./${folder}/${name}": "./${folder}/${name}?v=${VERSION}"`;
      assert.ok(page.includes(entry), `${folder}/${name} missing from the import map: run node tools/release.js`);
    }
  }
  assert.match(VERSION, /^0\.\d+\.\d+$/);   // 0.phase.build, until 1.0
});

// -------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);   // tells the computer "something went wrong"
}
