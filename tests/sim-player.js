// =============================================================
// tests/sim-player.js
// -------------------------------------------------------------
// The REALISTIC PLAYER for the pacing simulator (added 4 Nov).
//
// The first balance check (3 Nov) used a pretend player that only
// ever bought Prospectors, Prospector parts and command upgrades.
// It never bought a Courier, never used the workshop, never fitted
// Excavator parts and never swapped small barges for big ones, so
// Refining, Manufacturing and Trade were never really measured,
// and "command points block everything" might just have been the
// pretend player being simple.
//
// This file teaches it the rest of the game. Each export is one
// habit a sensible player has; pacing-sim.js calls them in turn
// once a game minute:
//
//   stockToKeep        what to hold back for the next purchases
//   sellAtHome         sell at Anvil, but leave freighters a load
//   runRefinery        keep every smelting slot on a useful recipe
//   runWorkshop        keep every workshop slot queued
//   extraShopping      more things to buy: every hull's parts,
//                      station upgrades, Couriers, Excavator swaps
//   finishSwaps        sell recalled Prospectors, buy the Excavator
//
// None of this changes the game itself: it only calls the same
// functions the buttons on screen call.
// =============================================================

import {
  FIELDS, ITEMS, RECIPES, WORKSHOP_RECIPES, SHIP_TYPES, SHIP_UPGRADES, UPGRADES, HULL_SIZES,
  SHIP_PRICE_GROWTH,
} from "../data/content.js";
import { getLevel, isFieldUnlocked, canHullWorkField } from "../js/skills.js";
import { getTripPlan, getHaulPlan, getJobForShip, recallJob } from "../js/jobs.js";
import { getPrice, sellAll } from "../js/trade.js";
import { setBond } from "../js/bonded.js";
import { buyShip, getShipPrice, canBuyShip, getSellValue, canSellShip, sellShip } from "../js/shipyard.js";
import { canBuyShipUpgrade, buyShipUpgrade, getPartGrade, getShipStats } from "../js/ship-upgrades.js";
import { canBuyIndustryUpgrade, buyIndustryUpgrade, isOwned } from "../js/upgrades.js";
import { getCommandFree } from "../js/command.js";
import { getCharter } from "../js/contracts.js";
import { setRecipe, getRefineJob, getSlotCount, isRecipeUnlocked } from "../js/refinery.js";
import {
  isWorkshopOpen, getWorkshopSlotCount, getWorkshopJob, getQueueLimit,
  isWorkshopRecipeUnlocked, hasWorkshopInputs, addOrder, getMaxOrderBatches,
  cancelOrder, getRunningIndex,
} from "../js/workshop.js";

const HOUR = 60 * 60 * 1000;

// How many batches the player puts in each work order. 5 batches
// of hull plating is about 7 minutes; of thruster assemblies about
// 25. Short orders keep the workshop flexible.
const BATCHES_PER_ORDER = 5;

// How many orders the player keeps queued in each workshop slot.
// One: it checks in every minute, and a second order would count
// the same bars in the hold as the first (the game allows more).
const ORDERS_KEPT_QUEUED = 1;

// Freighters need cargo waiting when they get home. The player
// leaves this many full Courier loads in the hold for them, and
// sells everything above that at Anvil.
const LOADS_LEFT_FOR_FREIGHTERS = 1.5;


// -------------------------------------------------------------
// Small helpers
// -------------------------------------------------------------

// How many ships of one type the player owns, e.g. count(state, "courier")
function count(state, typeId) {
  return state.ships.filter((ship) => ship.type === typeId).length;
}

// The hull types the player owns at least one of, e.g. ["prospector", "pathfinder"]
function ownedHullTypes(state) {
  return [...new Set(state.ships.map((ship) => ship.type))];
}

// Command points one ship of this type costs (small 1, medium 2)
function pointsFor(typeId) {
  return HULL_SIZES[SHIP_TYPES[typeId].size].commandPoints;
}


// -------------------------------------------------------------
// minerValuePerHour(state, typeId)
// Credits an hour ONE mining ship of this type earns at home
// prices, on its best open field. Used to compare hulls fairly:
// a Prospector's value against an Excavator's, or against what a
// Courier would add.
//   e.g. 120 t of iron ore at 2 cr/t, every 2.6 minutes
//        = 120 x 2 x (60 / 2.6) = about 5,500 cr an hour
// -------------------------------------------------------------
export function minerValuePerHour(state, typeId) {
  let best = 0;
  for (const fieldId of Object.keys(FIELDS)) {
    if (!isFieldUnlocked(state, fieldId)) continue;
    // Hull rules (built 4 Nov): the Ice moon is small hulls only,
    // the deep core large and up. A field this hull can't work
    // isn't worth anything to it.
    if (!canHullWorkField(typeId, fieldId)) continue;
    const plan = getTripPlan(state, typeId, fieldId);
    const stats = getShipStats(state, typeId);
    const value = stats.cargoCapacity * getPrice(FIELDS[fieldId].yields, "home");
    best = Math.max(best, value / (plan.durationMs / HOUR));
  }
  return best;
}


// -------------------------------------------------------------
// bestXpField(state, typeId)
// The field pacing-sim.js sends a mining ship to: the most Mining
// XP per hour. (Usually the Outer Belt once it opens.)
// -------------------------------------------------------------
export function bestXpField(state, typeId) {
  let best = null;
  for (const fieldId of Object.keys(FIELDS)) {
    if (!isFieldUnlocked(state, fieldId)) continue;
    if (!canHullWorkField(typeId, fieldId)) continue;      // hull rules
    const plan = getTripPlan(state, typeId, fieldId);
    const xpPerHour = plan.xpPerTrip / plan.durationMs;
    if (!best || xpPerHour > best.xpPerHour) best = { fieldId, xpPerHour };
  }
  return best.fieldId;
}


// -------------------------------------------------------------
// refineryOreNeeds(state)
// The ore the refinery's current recipes eat: two batches' worth
// of each, which is what the player keeps in the hold for it.
//   e.g. iron bars (60 t iron ore) + steel (60 t iron, 30 t nickel)
//        -> { iron_ore: 240, nickel_ore: 60 }
// -------------------------------------------------------------
export function refineryOreNeeds(state) {
  const needs = {};
  for (let slot = 0; slot < getSlotCount(state); slot++) {
    const job = getRefineJob(state, slot);
    if (!job || job.toll !== undefined || !RECIPES[job.recipeId]) continue;
    for (const [oreId, tonnes] of Object.entries(RECIPES[job.recipeId].inputs)) {
      needs[oreId] = (needs[oreId] || 0) + 2 * tonnes;
    }
  }
  return needs;
}


// -------------------------------------------------------------
// chooseMiningField(state, ship)
// Where a docked barge goes next. Normally the field with the
// most Mining XP per hour (usually the Outer Belt). But if the
// refinery is short of an ore that field doesn't give, the barge
// goes for that ore instead, so the smelters keep working.
// (Found 4 Nov: chasing XP alone sent every barge to the Outer
// Belt, iron ore sat at zero all day, and iron bars, steel and
// the workshop behind them starved.)
// -------------------------------------------------------------
export function chooseMiningField(state, ship) {
  const best = bestXpField(state, ship.type);
  const needs = refineryOreNeeds(state);
  // What's on its way home already counts: barges out mining
  // that ore will top the hold up soon.
  for (const [oreId, tonnes] of Object.entries(needs)) {
    if ((state.inventory[oreId] || 0) >= tonnes) continue;     // enough in the hold
    if (FIELDS[best].yields === oreId) return best;            // the XP field gives it anyway
    const incoming = state.ships.filter((other) => {
      const job = getJobForShip(state, other.id);
      return job && job.type === "mining" && FIELDS[job.fieldId] && FIELDS[job.fieldId].yields === oreId;
    }).length;
    if (incoming >= 2) continue;                               // two barges on it is plenty
    const fieldId = Object.keys(FIELDS).find((id) => FIELDS[id].yields === oreId && isFieldUnlocked(state, id) &&
      canHullWorkField(ship.type, id));                        // only a field this barge can work
    if (fieldId) return fieldId;
  }
  return best;
}


// -------------------------------------------------------------
// rebalanceMiners(state, now)
// Barges repeat their trips forever, so one sent to the Outer
// Belt never docks again by itself. If the refinery is short of
// an ore and NO barge is working a field that gives it, the
// player recalls one barge from elsewhere; when it docks,
// chooseMiningField sends it where the ore is needed.
// One recall at a time, and never a chartered barge.
// Returns a list of log lines.
// -------------------------------------------------------------
export function rebalanceMiners(state, now) {
  const lines = [];
  const miningJobs = state.jobs.filter((job) => job.type === "mining");
  if (miningJobs.some((job) => job.recall)) return lines;   // one already heading home

  for (const [oreId, tonnes] of Object.entries(refineryOreNeeds(state))) {
    if ((state.inventory[oreId] || 0) >= tonnes) continue;
    const fieldId = Object.keys(FIELDS).find((id) => FIELDS[id].yields === oreId && isFieldUnlocked(state, id));
    if (!fieldId) continue;
    if (miningJobs.some((job) => job.fieldId === fieldId)) continue;   // someone's on it
    // Recall a barge from another field (not a chartered one)
    // (only one whose hull can work that field: no point recalling
    // a Deep-core barge for iron ore it can't mine)
    const job = miningJobs.find((j) => j.fieldId !== fieldId && !getCharter(state, j.shipId) &&
      canHullWorkField(state.ships.find((s) => s.id === j.shipId).type, fieldId));
    if (!job) continue;
    recallJob(state, job.id, now);
    lines.push(`recalled a barge to send it for ${ITEMS[oreId].name.toLowerCase()} (refinery short)`);
    break;
  }
  return lines;
}


// -------------------------------------------------------------
// oreFlowPerHour(state)
// How many tonnes of each ore the mining fleet brings home in an
// hour, each ship on the field it actually works.
//   e.g. { nickel_ore: 4200, iron_ore: 900 }
// Freighters can only add value on goods that exist, so this
// caps what a Courier is worth.
// -------------------------------------------------------------
function oreFlowPerHour(state) {
  const flow = {};
  for (const ship of state.ships) {
    if (SHIP_TYPES[ship.type].role !== "mining") continue;
    const fieldId = bestXpField(state, ship.type);
    const oreId = FIELDS[fieldId].yields;
    const plan = getTripPlan(state, ship.type, fieldId);
    flow[oreId] = (flow[oreId] || 0) + getShipStats(state, ship.type).cargoCapacity / (plan.durationMs / HOUR);
  }
  return flow;
}


// -------------------------------------------------------------
// courierValuePerHour(state)
// What ONE MORE Courier would add in credits an hour: what Last
// Post pays over Anvil, on the ore it could carry that the
// Couriers already flying can't.
// Couriers load the best-paying goods first, so the carrying is
// shared out from the biggest gain per tonne down:
//   e.g. nickel ore gains 7 cr/t at Last Post (12 -> 19),
//        iron ore 3 cr/t (5 -> 8). The Couriers flying already
//        take the nickel; the new one gets what's left.
// (Bars the refinery makes go to freighters too and gain more,
// but the refinery takes ore first, so ore is a fair guide.)
// -------------------------------------------------------------
export function courierValuePerHour(state) {
  const plan = getHaulPlan(state, "courier");
  const carryPerHour = plan.capacity / (plan.durationMs / HOUR);
  let alreadyCarried = count(state, "courier") * carryPerHour;   // tonnes the fleet's Couriers take
  let room = carryPerHour;                                       // the new Courier's tonnes
  let value = 0;

  // Biggest gain per tonne first
  const flow = oreFlowPerHour(state);
  const gain = (oreId) => getPrice(oreId, "hub") - getPrice(oreId, "home");
  for (const oreId of Object.keys(flow).sort((a, b) => gain(b) - gain(a))) {
    let tonnes = flow[oreId];
    const takenAlready = Math.min(tonnes, alreadyCarried);   // the other Couriers' share
    alreadyCarried -= takenAlready;
    tonnes -= takenAlready;
    const mine = Math.min(tonnes, room);                     // the new Courier's share
    room -= mine;
    value += mine * gain(oreId);
  }
  return value;
}


// -------------------------------------------------------------
// stockToKeep(state)
// What the player holds back from selling, item by item, so the
// next purchases can be paid for: metal bars and workshop
// products for the next ship part of every hull type owned, and
// for the next station upgrade of each line.
// It starts saving a few levels early, because products take a
// while to make.
// Returns e.g. { iron_bar: 40, hull_plating: 20 }
// -------------------------------------------------------------
const SAVE_LEVELS_EARLY = 3;

export function stockToKeep(state) {
  const keep = {};
  const add = (costs) => {
    for (const [itemId, tonnes] of Object.entries(costs)) {
      keep[itemId] = (keep[itemId] || 0) + tonnes;
    }
  };

  // The next grade of each part, for every hull type owned
  for (const hullId of ownedHullTypes(state)) {
    for (const upgrade of Object.values(SHIP_UPGRADES)) {
      if (upgrade.hull !== hullId) continue;
      const nextGrade = getPartGrade(state, hullId, upgrade.part) + 1;
      if (upgrade.grade !== nextGrade) continue;                       // not the next one
      if (getLevel(state, upgrade.skill) < upgrade.level - SAVE_LEVELS_EARLY) continue;   // too far off
      add(upgrade.costs);
    }
  }

  // Feed for the workshop: two batches' worth of the metal each
  // unlocked recipe takes, so an order has its bars ready instead
  // of the refinery's output being sold the minute it lands.
  //   e.g. hull plating takes 30 t of iron bars a batch -> keep 60 t
  // (Worked out separately, then added on top of the bars saved
  // for ship parts, so the two don't eat into each other.)
  if (isWorkshopOpen(state)) {
    const feed = {};
    for (const [recipeId, recipe] of Object.entries(WORKSHOP_RECIPES)) {
      if (!isWorkshopRecipeUnlocked(state, recipeId)) continue;
      for (const [inputId, tonnes] of Object.entries(recipe.inputs)) {
        // Bars, and products that feed other products (plating and
        // frames for cargo pods, say)
        feed[inputId] = Math.max(feed[inputId] || 0, 2 * tonnes);
      }
    }
    add(feed);
  }

  // Ore for the refinery: two batches of whatever it's smelting,
  // so ore isn't sold the minute before a batch wants it
  add(refineryOreNeeds(state));

  // Station upgrades (refinery and workshop) not owned yet whose
  // level is close, and whose earlier tier is owned
  for (const [id, upgrade] of Object.entries(UPGRADES)) {
    if (isOwned(state, id)) continue;
    if (upgrade.requires && !isOwned(state, upgrade.requires)) continue;
    if (getLevel(state, upgrade.skill) < upgrade.level - SAVE_LEVELS_EARLY) continue;
    add(upgrade.costs);
  }
  return keep;
}


// -------------------------------------------------------------
// sellAtHome(state, keep, wanted)
// Sells at Anvil, apart from:
//   - "keep": goods saved for purchases (bonded, the game's own
//     way to stop them being sold)
//   - "wanted": goods an open delivery contract asks for
//   - a load or so for the freighters, so a Courier coming home
//     finds cargo waiting. The most valuable goods are left for
//     them, because a freighter loads the best-paying goods first
//     and those gain the most at Last Post.
// Returns the credits earned.
// -------------------------------------------------------------
export function sellAtHome(state, keep, wanted) {
  // 1. Bond what's being saved (and nothing else)
  for (const itemId of Object.keys(ITEMS)) {
    setBond(state, itemId, keep[itemId] || 0);
  }

  // 2. How many tonnes to leave for freighters (none without any)
  const courierHold = getShipStats(state, "courier").cargoCapacity;
  let leaveForFreight = count(state, "courier") * courierHold * LOADS_LEFT_FOR_FREIGHTERS;

  // 3. Sell, most valuable at Last Post first, so the freighters'
  //    allowance goes on the goods that gain most from the trip
  const byHubPrice = Object.keys(ITEMS).sort((a, b) => getPrice(b, "hub") - getPrice(a, "hub"));
  let earned = 0;
  for (const itemId of byHubPrice) {
    if (wanted.has(itemId)) continue;
    const bond = keep[itemId] || 0;
    const aboveBond = Math.max(0, (state.inventory[itemId] || 0) - bond);
    const forFreight = Math.min(aboveBond, leaveForFreight);
    leaveForFreight -= forFreight;
    // Raise the bond for a moment to cover the freighters' share,
    // sell the rest, then put the bond back. (A bond also stops
    // freighters, so it mustn't stay raised.)
    setBond(state, itemId, bond + forFreight);
    earned += sellAll(state, itemId).credits;
    setBond(state, itemId, bond);
  }
  return earned;
}


// -------------------------------------------------------------
// runRefinery(state, keep, now)
// Keeps every refinery slot on a useful recipe:
//   slot 1: iron bars (hull plating, the Prospector's Mk II parts)
//   slot 2: nickel bars (wiring coils), once nickel is mined
//   slot 3: steel (structural frames), once Refining 15 opens it
// If the workshop or a purchase needs a metal the player is short
// of, the first slot switches to it until there's enough.
// Slots lent out for toll smelting are left alone.
// Returns a list of log lines.
// -------------------------------------------------------------
export function runRefinery(state, keep, now) {
  const lines = [];
  const canMake = (recipeId) => isRecipeUnlocked(state, recipeId) &&
    Object.keys(RECIPES[recipeId].inputs).every((oreId) =>
      Object.values(FIELDS).some((field, i) => field.yields === oreId && isFieldUnlocked(state, Object.keys(FIELDS)[i])));

  // Slot 1 makes iron bars, unless a metal being saved for is
  // short: then it makes that until there's enough.
  let firstSlot = "iron_bar";
  for (const metal of Object.keys(RECIPES)) {
    if ((keep[metal] || 0) > (state.inventory[metal] || 0) && canMake(metal)) {
      firstSlot = metal;
      break;
    }
  }

  // Every other slot makes the metal the hold is SHORTEST of,
  // measured against what's being kept for it (found 4 Nov:
  // with fixed recipes nothing made steel until a third slot
  // opened, and a frames order sat waiting for it all day).
  //   e.g. keep 60 t nickel, have 50 t -> 0.83 full
  //        keep 60 t steel,  have 10 t -> 0.17 full  -> make steel
  const fullness = (metal) => (state.inventory[metal] || 0) / Math.max(1, keep[metal] || 0);
  const otherMetals = Object.keys(RECIPES).filter((metal) => metal !== "iron_bar" && canMake(metal) && (keep[metal] || 0) > 0);

  for (let slot = 0; slot < getSlotCount(state); slot++) {
    const current = getRefineJob(state, slot);
    let recipe = firstSlot;
    if (slot > 0) {
      // Keep the current recipe unless another metal is clearly
      // emptier, so slots don't flip back and forth every minute
      const emptiest = otherMetals.sort((a, b) => fullness(a) - fullness(b))[0];
      const currentId = current && current.recipeId;
      recipe = emptiest || bestXpRecipe(state, canMake) || (canMake("nickel_bar") ? "nickel_bar" : "iron_bar");
      if (currentId && otherMetals.includes(currentId) && fullness(currentId) < 1) recipe = currentId;
    }
    if (current && (current.recipeId === recipe || current.toll !== undefined)) continue;
    if (setRecipe(state, slot, recipe, now)) {
      lines.push(`refinery slot ${slot + 1} set to ${RECIPES[recipe].name.toLowerCase()}`);
    }
  }
  return lines;
}


// -------------------------------------------------------------
// bestXpRecipe(state, canMake)
// With nothing short, a spare refinery slot runs the recipe with
// the most Refining XP per second that has a batch's ore in the
// hold right now (added 4 Nov, for iridium bars: a real player
// smelts the rich ore for the XP and the better price).
//   e.g. iridium bars 80 XP / 180 s = 0.44 XP/s, steel 30 / 120 = 0.25
// Returns a recipe ID, or null to fall back to nickel or iron.
// -------------------------------------------------------------
function bestXpRecipe(state, canMake) {
  let best = null;
  for (const [recipeId, recipe] of Object.entries(RECIPES)) {
    if (recipeId === "iron_bar" || !canMake(recipeId)) continue;
    const hasOre = Object.entries(recipe.inputs).every(([oreId, tonnes]) => (state.inventory[oreId] || 0) >= tonnes);
    if (!hasOre) continue;
    const xpPerSecond = recipe.xp / recipe.seconds;
    if (!best || xpPerSecond > best.xpPerSecond) best = { recipeId, xpPerSecond };
  }
  return best ? best.recipeId : null;
}


// -------------------------------------------------------------
// runWorkshop(state, keep, now)
// Keeps each workshop slot's queue topped up to 2 orders.
// What to make, in order of preference:
//   1. a product that's being saved for and is short
//   2. failing that, the most advanced product the player can
//      make right now (more XP per hour, sells for more)
// A recipe is only queued if its inputs are in the hold now, so
// an order never sits blocking the queue. If a saved-for product
// can't be made yet (cargo pods need frames, say), the player
// makes its missing input instead.
// Returns a list of log lines.
// -------------------------------------------------------------
// "away" (the casual player, 4 Nov): it's about to leave for hours,
// so it fills each queue to the game's limit with the biggest
// orders allowed, as a real player heading out would.
export function runWorkshop(state, keep, now, away = false) {
  const lines = [];
  if (!isWorkshopOpen(state)) return lines;

  // Most advanced first: thruster assemblies, cargo pods, frames...
  const recipes = Object.keys(WORKSHOP_RECIPES)
    .filter((id) => isWorkshopRecipeUnlocked(state, id))
    .sort((a, b) => WORKSHOP_RECIPES[b].unlockLevel - WORKSHOP_RECIPES[a].unlockLevel);

  // Can one batch of this recipe start from what's AVAILABLE (in
  // the hold and not promised to another slot's queue)?
  // ("available" is worked out further down, before this is used.)
  const canStart = (recipeId) => Object.entries(WORKSHOP_RECIPES[recipeId].inputs)
    .every(([inputId, tonnes]) => available(inputId) >= tonnes);

  // A recipe that's makeable now, or (one step down) the input
  // it's missing, or null
  const makeableFor = (recipeId) => {
    if (canStart(recipeId)) return recipeId;
    for (const inputId of Object.keys(WORKSHOP_RECIPES[recipeId].inputs)) {
      if (WORKSHOP_RECIPES[inputId] && isWorkshopRecipeUnlocked(state, inputId) &&
          available(inputId) < WORKSHOP_RECIPES[recipeId].inputs[inputId] &&
          canStart(inputId)) {
        return inputId;
      }
    }
    return null;
  };

  // A stuck order (waiting for inputs that aren't in the hold) is
  // cancelled, as a player would on seeing it. (Found 4 Nov: two
  // slots queued cargo pods off the same plating, one used it, and
  // both then waited for plating forever, with no slot free to
  // make any. Manufacturing sat at 16 for four weeks.)
  for (let slot = 0; slot < getWorkshopSlotCount(state); slot++) {
    const job = getWorkshopJob(state, slot);
    if (!job || job.status !== "waiting" || job.orders.length === 0) continue;
    const order = job.orders[getRunningIndex(job)] || job.orders[0];
    if (order && !hasWorkshopInputs(state, order.recipeId)) {
      cancelOrder(state, slot, job.orders.indexOf(order), now);
      lines.push(`workshop slot ${slot + 1}: cancelled a stuck ${WORKSHOP_RECIPES[order.recipeId].name.toLowerCase()} order`);
    }
  }

  // Inputs already promised to batches queued in any slot, so two
  // slots never count the same bars. A batch that has started has
  // taken its inputs already, so only the ones still to start count.
  //   e.g. 3 batches of cargo pods, 1 done, 1 running -> 1 to start
  //        -> 40 t plating and 20 t frames promised
  const promised = {};
  for (let slot = 0; slot < getWorkshopSlotCount(state); slot++) {
    const job = getWorkshopJob(state, slot);
    if (!job) continue;
    for (const order of job.orders) {
      const running = job.inputs ? 1 : 0;   // a batch under way has its inputs
      const isRunning = order === job.orders[getRunningIndex(job)];
      const toStart = Math.max(0, order.batches - order.done - (isRunning ? running : 0));
      for (const [inputId, tonnes] of Object.entries(WORKSHOP_RECIPES[order.recipeId].inputs)) {
        promised[inputId] = (promised[inputId] || 0) + toStart * tonnes;
      }
    }
  }
  const available = (itemId) => (state.inventory[itemId] || 0) - (promised[itemId] || 0);

  for (let slot = 0; slot < getWorkshopSlotCount(state); slot++) {
    const job = getWorkshopJob(state, slot);
    const queued = job ? job.orders.length : 0;
    const keepQueued = away ? getQueueLimit(state) : Math.min(ORDERS_KEPT_QUEUED, getQueueLimit(state));
    if (queued >= keepQueued) continue;

    // 1. Something being saved for and short
    let choice = null;
    for (const recipeId of recipes) {
      if ((keep[recipeId] || 0) > (state.inventory[recipeId] || 0)) {
        choice = makeableFor(recipeId);
        if (choice) break;
      }
    }
    // 2. Otherwise the most advanced thing makeable now
    if (!choice) choice = recipes.find((id) => canStart(id)) || null;
    if (!choice) continue;

    // Only as many batches as the available stock can pay for, so
    // an order never sits half-done waiting for inputs.
    //   e.g. 70 t of steel available, frames take 30 t a batch -> 2 batches
    let affordable = Infinity;
    for (const [inputId, tonnes] of Object.entries(WORKSHOP_RECIPES[choice].inputs)) {
      affordable = Math.min(affordable, Math.floor(available(inputId) / tonnes));
    }
    const batches = Math.min(away ? getMaxOrderBatches(state) : BATCHES_PER_ORDER, getMaxOrderBatches(state), affordable);
    if (batches < 1) continue;
    if (addOrder(state, slot, choice, batches, now).ok) {
      // Promise its inputs, so the next slot doesn't count them too
      for (const [inputId, tonnes] of Object.entries(WORKSHOP_RECIPES[choice].inputs)) {
        promised[inputId] = (promised[inputId] || 0) + batches * tonnes;
      }
      lines.push(`workshop slot ${slot + 1}: ordered ${batches} x ${WORKSHOP_RECIPES[choice].name.toLowerCase()}`);
    }
  }
  return lines;
}


// -------------------------------------------------------------
// extraShopping(state, now, swaps)
// More things for the shopping list, on top of what the simple
// player buys (Prospectors, their parts, command upgrades, the
// Pathfinder and its parts). Each option is
//   { cost, buy(), text }
// and pacing-sim.js buys the cheapest first, as before.
//   - parts for every other hull type owned (Excavator, Courier)
//   - refinery and workshop upgrades
//   - a Courier, when it would earn more per command point than
//     the next mining ship (see courierValuePerHour)
//   - an Excavator SWAP: when the fleet is out of command points,
//     recall two Prospectors, sell them and buy an Excavator in
//     their 2 points. Only if an Excavator out-earns two
//     Prospectors, which is the whole point of the hull.
// "swaps" is the list of swaps in progress (see finishSwaps).
// -------------------------------------------------------------
export function extraShopping(state, now, swaps) {
  const options = [];

  // Parts for hulls other than the Prospector and Pathfinder
  // (pacing-sim.js already shops for those two)
  for (const [id, upgrade] of Object.entries(SHIP_UPGRADES)) {
    if (upgrade.hull === "prospector" || upgrade.hull === "pathfinder") continue;
    if (count(state, upgrade.hull) === 0) continue;
    if (canBuyShipUpgrade(state, id).ok) {
      options.push({ cost: upgrade.credits, buy: () => buyShipUpgrade(state, id), text: "component " + id });
    }
  }

  // Refinery and workshop upgrades
  for (const [id, upgrade] of Object.entries(UPGRADES)) {
    if (canBuyIndustryUpgrade(state, id).ok) {
      options.push({ cost: upgrade.credits, buy: () => buyIndustryUpgrade(state, id), text: "station upgrade " + id });
    }
  }

  // A Courier, if it beats the best mining ship per command point
  // (a Prospector, or an Excavator once those are unlocked)
  if (canBuyShip(state, "courier").ok) {
    const courierPerPoint = courierValuePerHour(state) / pointsFor("courier");
    let minerPerPoint = minerValuePerHour(state, "prospector") / pointsFor("prospector");
    for (const big of ["excavator", "deep_core_barge"]) {
      if (getLevel(state, "mining") >= SHIP_TYPES[big].unlockLevel) {
        minerPerPoint = Math.max(minerPerPoint, minerValuePerHour(state, big) / pointsFor(big));
      }
    }
    if (courierPerPoint >= minerPerPoint) {
      options.push({ cost: getShipPrice(state, "courier"), buy: () => buyShip(state, "courier"), text: "Courier #" + (count(state, "courier") + 1) });
    }
  }

  // Swaps (never two at once): when the fleet is out of command
  // points, recall two barges of one size, sell them, and buy one
  // of the next size up in their points. Only if the bigger hull
  // out-earns the two it replaces, which is the whole point of it.
  //   two Prospectors (1 + 1 points) -> one Excavator (2)
  //   two Excavators  (2 + 2 points) -> one Deep-core barge (4) (added 4 Nov)
  // "keepAtLeast": how many of the small hull to keep anyway. One
  // Prospector stays for the Ice moon, which bigger hulls can't work.
  for (const { from, to, keepAtLeast } of SWAP_STEPS) {
    if (swaps.length > 0) break;
    const option = swapOption(state, now, swaps, from, to, keepAtLeast);
    if (option) options.push(option);
  }
  return options;
}


// Which swaps the realistic player considers. Each sells enough
// "from" hulls to free the points for one "to" hull: 2 Prospectors
// for an Excavator, 4 for a Deep-core barge, 2 Excavators for a
// barge. (Added 4 Nov: before, only Prospectors -> Excavator
// existed, so once barges arrived nothing ever retired the small
// hulls, and the casual player kept 6 Prospectors all game.)
// One Prospector is always kept, for the Ice moon.
const SWAP_STEPS = [
  { from: "prospector", to: "excavator", keepAtLeast: 1 },
  { from: "prospector", to: "deep_core_barge", keepAtLeast: 1 },
  { from: "excavator", to: "deep_core_barge", keepAtLeast: 0 },
];

// -------------------------------------------------------------
// swapOption(state, now, swaps, from, to, keepAtLeast)
// One swap for the shopping list, or null if it doesn't make
// sense yet: "to" isn't unlocked, there are spare points to just
// buy one, it wouldn't earn more than the two it replaces, or
// there aren't enough "from" barges to sell.
// -------------------------------------------------------------
function swapOption(state, now, swaps, from, to, keepAtLeast) {
  // How many "from" hulls make room for one "to": its points ÷ theirs
  //   e.g. a barge (4 points) for Prospectors (1 point each) -> 4
  const count = pointsFor(to) / pointsFor(from);
  const unlocked = getLevel(state, "mining") >= SHIP_TYPES[to].unlockLevel;
  const outOfPoints = getCommandFree(state) < pointsFor(to);
  // Worth it only if the one big hull out-earns all the ones it replaces
  const better = minerValuePerHour(state, to) > count * minerValuePerHour(state, from);
  const sellable = state.ships.filter((ship) => ship.type === from && !getCharter(state, ship.id));
  if (!unlocked || !outOfPoints || !better || sellable.length < count + keepAtLeast) return null;

  // Each sale makes the next one of that type cheaper: each sells for
  // the one before's price divided by the growth rate (found 4 Nov:
  // counting them all at the first price left the swap short).
  //   e.g. first sells for 26,214 cr, second for 26,214 / 1.6 = 16,384 cr
  let saleValue = 0;
  let price = getSellValue(state, from);
  for (let i = 0; i < count; i++) {
    saleValue += Math.floor(price);
    price /= SHIP_PRICE_GROWTH;
  }
  const netCost = getShipPrice(state, to) - saleValue;
  if (state.credits < netCost) return null;
  return {
    cost: netCost,
    text: `${SHIP_TYPES[to].name} swap (recalling ${count} x ${SHIP_TYPES[from].name} to sell)`,
    buy: () => {
      // The newest ones: they have the most refits waiting anyway
      const pair = sellable.slice(-count).map((ship) => ship.id);
      for (const shipId of pair) {
        const job = getJobForShip(state, shipId);
        if (job) recallJob(state, job.id, now);
      }
      swaps.push({ shipIds: pair, from, to });
    },
  };
}


// -------------------------------------------------------------
// finishSwaps(state, swaps)
// Recalled Prospectors take a few minutes to fly home. Once both
// in a swap are docked, sell them and buy the Excavator in their
// place. (If the credits have been spent meanwhile, the sale
// still goes ahead and the Excavator is bought as soon as it's
// affordable, by the normal shopping list.)
// Returns a list of log lines.
// -------------------------------------------------------------
export function finishSwaps(state, swaps) {
  const lines = [];
  for (let i = swaps.length - 1; i >= 0; i--) {
    const swap = swaps[i];
    const stillHere = swap.shipIds.filter((id) => state.ships.some((ship) => ship.id === id));
    if (!stillHere.every((id) => canSellShip(state, id).ok)) continue;   // not all home yet
    let sold = 0;
    for (const id of stillHere) sold += sellShip(state, id);
    swaps.splice(i, 1);
    const fromName = SHIP_TYPES[swap.from].name, toName = SHIP_TYPES[swap.to].name;
    if (canBuyShip(state, swap.to).ok) {
      const price = getShipPrice(state, swap.to);
      buyShip(state, swap.to);
      lines.push(`swap: sold ${stillHere.length} x ${fromName} (${sold.toLocaleString("en-GB")} cr), bought a ${toName} (${price.toLocaleString("en-GB")} cr)`);
    } else {
      lines.push(`swap: sold ${stillHere.length} x ${fromName} (${sold.toLocaleString("en-GB")} cr); ${toName} not affordable yet`);
    }
  }
  return lines;
}


// -------------------------------------------------------------
// shipsInSwaps(swaps)
// The ships waiting to be sold, so pacing-sim.js doesn't send
// them straight back out to mine.
// -------------------------------------------------------------
export function shipsInSwaps(swaps) {
  return new Set(swaps.flatMap((swap) => swap.shipIds));
}
