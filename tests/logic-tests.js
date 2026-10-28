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
import { SHIP_TYPES, ITEMS, COMMAND } from "../data/content.js";
import { createNewGame } from "../js/state.js";
import { startMiningJob, processJobs, cancelJob, getJobProgress, getJobPhase, getTripPlan } from "../js/jobs.js";
import { sellAll, sellEverything, getCargoValue, sellAtHub, getTradeXp, getPrice } from "../js/trade.js";
import { parseSave, applyOfflineProgress } from "../js/save.js";
import { XP_TABLE, getLevelForXp, getLevel, getLevelProgress, addXp, isShipTypeUnlocked, MAX_LEVEL } from "../js/skills.js";
import { canBuyShip, buyShip, canSellShip, sellShip, getSellValue } from "../js/shipyard.js";
import { getCommandCapacity, getCommandUsed, getNextUpgradeCost, buyUpgrade } from "../js/command.js";
import { isFieldUnlocked } from "../js/skills.js";

const SECOND = 1000;                 // milliseconds in a second
const HOUR = 60 * 60 * SECOND;
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

test("Prospector trip: 45s out, 1m mining, 45s back = 2m 30s, 12 ore, 12 XP", () => {
  assert.equal(PROSPECTOR.outboundMs, 45 * SECOND);
  assert.equal(PROSPECTOR.miningMs, 60 * SECOND);
  assert.equal(PROSPECTOR.returnMs, 45 * SECOND);
  assert.equal(PROSPECTOR.durationMs, 150 * SECOND);
  assert.equal(PROSPECTOR.orePerTrip, 12);
  assert.equal(PROSPECTOR.xpPerTrip, 12);
});

test("Excavator trip: 1m out (slower drive), 2m mining, 1m back = 4m, 40 ore", () => {
  assert.equal(EXCAVATOR.outboundMs, 60 * SECOND);
  assert.equal(EXCAVATOR.miningMs, 120 * SECOND);
  assert.equal(EXCAVATOR.durationMs, 240 * SECOND);
  assert.equal(EXCAVATOR.orePerTrip, 40);
});

test("Excavator earns about twice the Prospector's credits per hour", () => {
  const perHour = (plan) => plan.orePerTrip * (HOUR / plan.durationMs);
  const ratio = perHour(EXCAVATOR) / perHour(PROSPECTOR);
  assert.ok(ratio > 1.9 && ratio < 2.3, "ratio was " + ratio.toFixed(2));
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

test("Selling at home earns 1 Trade XP per 10 cr (12 iron = 60 cr = 6 XP)", () => {
  const state = createNewGame();
  state.inventory.iron_ore = 12;
  const sale = sellAll(state, "iron_ore");
  assert.equal(sale.xp, 6);
  assert.equal(state.skills.trade.xp, 6);
  assert.equal(state.skills.mining.xp, 0);          // Mining XP untouched
});

test("Trade XP can be a fraction: 12 nickel = 144 cr = 14.4 XP", () => {
  const state = createNewGame();
  state.inventory.nickel_ore = 12;
  assert.equal(sellAll(state, "nickel_ore").xp, 14.4);
});

test("A big home sale reports the Trade levels it reached", () => {
  const state = createNewGame();
  state.inventory.iron_ore = 400;                   // 2,000 cr = 200 XP
  const sale = sellAll(state, "iron_ore");
  assert.equal(getLevel(state, "trade"), 3);        // level 3 starts at 174 XP
  assert.deepEqual(sale.newLevels, [2, 3]);
});

test("Selling at the hub: 60 iron pays 480 cr and 108 XP (48 sale + 60 bonus)", () => {
  const state = createNewGame();
  const sale = sellAtHub(state, { iron_ore: 60 });
  assert.equal(sale.credits, 480);
  assert.equal(sale.units, 60);
  assert.equal(sale.xp, 108);
  assert.equal(state.credits, 480);
  assert.equal(state.skills.trade.xp, 108);
});

test("The hub takes mixed cargo and doesn't touch the home hold", () => {
  const state = createNewGame();
  state.inventory.iron_ore = 99;                    // stays at home
  const sale = sellAtHub(state, { nickel_ore: 20, iron_ore: 40 });
  assert.equal(sale.credits, 20 * 19 + 40 * 8);      // 380 + 320 = 700
  assert.equal(sale.xp, getTradeXp(700, 60));       // 70 + 60 = 130
  assert.equal(state.inventory.iron_ore, 99);
});

test("Hauling 60 iron earns over 3x the Trade XP of selling it at home", () => {
  const homeXp = getTradeXp(60 * ITEMS.iron_ore.sellPrice);        // 30
  const hubXp = getTradeXp(60 * ITEMS.iron_ore.hubPrice, 60);      // 108
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
  const state = gameAtLevel10(cost + 250);
  const ship = buyShip(state, "excavator");
  assert.equal(state.credits, 250);
  assert.equal(state.ships.length, 2);
  assert.equal(ship.id, "ship-2");
  assert.equal(ship.name, "Second Wind");
  assert.equal(state.nextShipNumber, 3);
});

test("A second Prospector can be bought from the start, for 1,500 cr", () => {
  const state = createNewGame();
  state.credits = 1500;
  const ship = buyShip(state, "prospector");
  assert.ok(ship);
  assert.equal(ship.type, "prospector");
  assert.equal(state.credits, 0);
  assert.equal(state.ships.length, 2);
});

test("Four Prospectors fill the 4 starting command points", () => {
  const state = createNewGame();
  state.credits = 1500 * 4;
  buyShip(state, "prospector");
  buyShip(state, "prospector");
  buyShip(state, "prospector");
  assert.deepEqual(canBuyShip(state, "prospector"), { ok: false, reason: "Not enough command points" });
  assert.equal(state.credits, 1500);                 // the 4th wasn't charged
});

test("A second Prospector takes about an hour of mining to afford", () => {
  const creditsPerHour = PROSPECTOR.orePerTrip * ITEMS.iron_ore.sellPrice * (HOUR / TRIP);
  const hours = SHIP_TYPES.prospector.cost / creditsPerHour;
  assert.ok(hours > 0.75 && hours < 1.5, hours.toFixed(2) + " hours");
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

test("A version 1 save (first commit) upgrades all the way to version 5", () => {
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
  assert.equal(state.version, 5);
  assert.equal(state.credits, 50);                 // nothing lost
  assert.equal(state.inventory.iron_ore, 10);
  assert.deepEqual(state.skills, { mining: { xp: 0 }, trade: { xp: 0 } });
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
  assert.equal(state.version, 5);
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

test("Command upgrades: +2 points each, priced 2,000 then 4,000 then 8,000", () => {
  const state = createNewGame();
  state.credits = 2000 + 4000 + 8000;
  assert.equal(getNextUpgradeCost(state), 2000);
  buyUpgrade(state);
  assert.equal(getNextUpgradeCost(state), 4000);
  buyUpgrade(state);
  assert.equal(getNextUpgradeCost(state), 8000);
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
  const state = gameAtLevel10(SHIP_TYPES.excavator.cost * 2 + 2000);
  buyShip(state, "excavator");
  buyUpgrade(state);
  assert.ok(buyShip(state, "excavator"));
  assert.equal(getCommandUsed(state), 5);
  assert.equal(getCommandCapacity(state), 6);
});


// =============================================================
// SELLING SHIPS
// =============================================================

test("Both barges sell for half their price (Excavator 1,500, Prospector 750)", () => {
  assert.equal(getSellValue("excavator"), SHIP_TYPES.excavator.cost / 2);
  assert.equal(getSellValue("prospector"), 750);
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
  assert.equal(plan.xpPerTrip, 12 * 2);
});

test("An Outer Belt trip brings home nickel ore, not iron", () => {
  const state = createNewGame();
  state.skills.mining.xp = XP_TABLE[5];
  startMiningJob(state, "ship-1", "outer_belt", START);
  processJobs(state, START + 240 * SECOND);
  assert.equal(state.inventory.nickel_ore, 12);
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
  assert.equal(sale.xp, expected / 10);
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
  assert.equal(state.version, 5);
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
  assert.equal(state.version, 5);
  assert.deepEqual(state.skills, { mining: { xp: 900 }, trade: { xp: 0 } });
  assert.equal(state.credits, 1200);
});

// -------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);   // tells the computer "something went wrong"
}
