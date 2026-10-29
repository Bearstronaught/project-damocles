// =============================================================
// js/workshop.js
// -------------------------------------------------------------
// THE WORKSHOP at Anvil Station: turning metal into products
// (the Manufacturing skill).
//
// It looks like the refinery - a few SLOTS, each making one
// recipe at a time - but it works differently on purpose
// (design doc, "Work orders"):
//
//   REFINERY  a slot runs ONE recipe over and over, forever.
//   WORKSHOP  a slot works through a QUEUE of work ORDERS. Each
//             order says "make this recipe, this many batches".
//             When the last order is done, the slot goes idle
//             until the player queues more.
//
// So a player who's away longer than their queue comes back to
// an idle workshop. That's intended: it's what makes longer
// queues (and, later, the Control centre) worth wanting.
//
// A slot with orders is stored as a JOB in state.jobs, like the
// ships and the refinery, so jobs.js plays its batches out in
// time order with everything else - offline too.
//
// A workshop job looks like this:
//   {
//     id: "workshop-slot-0",
//     type: "workshop",
//     slot: 0,                     which slot (0 = the first)
//     orders: [                    the queue; the FIRST is current
//       { recipeId: "hull_plating", batches: 20, done: 3 },
//       { recipeId: "wiring_coils", batches: 5,  done: 0 },
//     ],
//     status: "working",           "working" on a batch, or
//                                  "waiting" for metal
//     startedAt: 1712345678901,    when the current batch started
//     durationMs: 90000,           how long this batch takes
//     inputs: { iron_bar: 30 },    metal taken for this batch (so
//                                  it can be handed back if cancelled)
//   }
// When the queue empties, the job is removed: the slot is idle.
//
// The queue is worked in order. If the first order is waiting
// for metal, the orders behind it wait too. That keeps it
// predictable: the player always knows what comes next.
//
// SMART QUEUE (an upgrade) changes that one rule: if the first
// order is short of metal, the first order BEHIND it that has
// metal runs a batch instead. Nothing is reordered - the blocked
// order keeps its place and picks up again when its metal comes.
// So the job also remembers WHICH order its batch belongs to:
//     runningIndex: 0     (0 = the first order; with the smart
//                          queue it can be 1, 2, ...)
//
// STANDING ORDERS (the Control centre upgrade) sit beside the
// queue, not in it: "keep 50 t of cargo pods in stock". They
// never finish. Whenever a slot has NO work order it can run,
// it runs a batch for the first standing order whose product is
// below its target (and whose metal is in the hold). So work
// orders always come first, and standing orders fill the gaps.
// They're stored per slot, outside the job:
//     state.standingOrders = { 0: [{ recipeId: "cargo_pod", target: 50 }] }
// and a slot with standing orders keeps its job even when its
// queue is empty. While a standing batch runs, the job says which:
//     standingIndex: 0    (null when a work order's batch runs)
// =============================================================

import { WORKSHOP_RECIPES, WORKSHOP, ITEMS } from "../data/content.js";
import { addItem, addItemWithCarry } from "./state.js";
import { getEffect } from "./upgrades.js";
import { getLevel, addXp } from "./skills.js";


// =============================================================
// WHAT THE PLAYER HAS UNLOCKED
// =============================================================

// -------------------------------------------------------------
// isWorkshopOpen(state)
// The workshop stays shut until a REFINING milestone (Refining 8
// to start with), the same way the refinery waits for Mining.
// -------------------------------------------------------------
export function isWorkshopOpen(state) {
  return getLevel(state, "refining") >= WORKSHOP.openAtRefiningLevel;
}

// -------------------------------------------------------------
// getWorkshopSlotCount(state)
// How many workshop slots the player can use. With slotLevels
// [1, 12, 35]: Manufacturing 1-11 = 1, 12-34 = 2, 35+ = 3.
// A closed workshop has none.
// -------------------------------------------------------------
export function getWorkshopSlotCount(state) {
  if (!isWorkshopOpen(state)) {
    return 0;
  }
  const level = getLevel(state, "manufacturing");
  return WORKSHOP.slotLevels.filter((slotLevel) => level >= slotLevel).length;
}

// The Manufacturing level a slot unlocks at (slot 0 = the first).
export function getWorkshopSlotUnlockLevel(slot) {
  return WORKSHOP.slotLevels[slot];
}

// -------------------------------------------------------------
// getQueueLimit(state)
// How many orders each slot can hold: the starting amount, plus
// one for every queueLevels milestone reached.
//   baseQueue 3, queueLevels [8, 25]:
//   Manufacturing 1-7 = 3, 8-24 = 4, 25+ = 5
// -------------------------------------------------------------
export function getQueueLimit(state) {
  const level = getLevel(state, "manufacturing");
  const extra = WORKSHOP.queueLevels.filter((queueLevel) => level >= queueLevel).length;
  return WORKSHOP.baseQueue + extra;
}

// -------------------------------------------------------------
// getMaxOrderBatches(state)
// The most batches one order can hold: 20 to start, and each
// Bigger work orders upgrade adds 20 (orderSize effect).
// -------------------------------------------------------------
export function getMaxOrderBatches(state) {
  return WORKSHOP.maxOrderBatches + getEffect(state, "orderSize");
}

// True if the player owns the Smart queue upgrade.
export function hasSmartQueue(state) {
  return getEffect(state, "smartQueue") > 0;
}

// True if the player has built the Control centre (standing orders).
export function hasControlCentre(state) {
  return getEffect(state, "standingOrders") > 0;
}

// A slot's standing orders (an empty list if it has none).
export function getStandingOrders(state, slot) {
  return state.standingOrders[slot] || [];
}

// True if the player's Manufacturing level allows this recipe.
export function isWorkshopRecipeUnlocked(state, recipeId) {
  return getLevel(state, "manufacturing") >= WORKSHOP_RECIPES[recipeId].unlockLevel;
}

// Which workshop recipes unlock at exactly this Manufacturing
// level, e.g. getWorkshopRecipeUnlocksAtLevel(5) -> ["wiring_coils"]
export function getWorkshopRecipeUnlocksAtLevel(level) {
  return Object.keys(WORKSHOP_RECIPES).filter((id) => WORKSHOP_RECIPES[id].unlockLevel === level);
}

// Which slots unlock at exactly this level, as the numbers a
// player would say ("slot 2"), e.g. level 12 -> [2].
export function getWorkshopSlotUnlocksAtLevel(level) {
  const slots = [];
  WORKSHOP.slotLevels.forEach((slotLevel, index) => {
    if (slotLevel === level) {
      slots.push(index + 1);
    }
  });
  return slots;
}

// True if this Manufacturing level adds a queued order per slot.
export function isQueueUnlockLevel(level) {
  return WORKSHOP.queueLevels.includes(level);
}


// =============================================================
// HOW LONG A BATCH TAKES
// =============================================================

// -------------------------------------------------------------
// getWorkshopBatchMs(state, recipeId)
// Batch time in milliseconds, exactly like the refinery: the
// Manufacturing level and Precision tooling MULTIPLY.
//   level 1, no tooling:   90s x 1.000        = 90s
//   level 11, no tooling:  90s x 0.950        = 85.5s
//   level 11, 1 tooling:   90s x 0.950 x 0.90 = 76.95s
// -------------------------------------------------------------
export function getWorkshopBatchMs(state, recipeId) {
  const level = getLevel(state, "manufacturing");
  const levelFactor = 1 - WORKSHOP.speedPerLevel * (level - 1);
  const upgradeFactor = 1 - getEffect(state, "workshopSpeed");
  // Never shorter than a tenth of the normal time, whatever the
  // balance sheet says (a safety net against a typo).
  const factor = Math.max(0.1, levelFactor * upgradeFactor);
  return Math.round(WORKSHOP_RECIPES[recipeId].seconds * 1000 * factor);
}


// =============================================================
// ORDERS: QUEUEING AND CANCELLING
// =============================================================

// The workshop job for one slot, or undefined if the slot is idle.
export function getWorkshopJob(state, slot) {
  return state.jobs.find((job) => job.type === "workshop" && job.slot === slot);
}

// -------------------------------------------------------------
// addOrder(state, slot, recipeId, batches, now)
// Puts a work order at the back of a slot's queue.
// Returns { ok: true } or { ok: false, reason: "..." } so the
// screen can say why an order was refused.
// -------------------------------------------------------------
export function addOrder(state, slot, recipeId, batches, now) {
  // --- Check everything before changing anything ---
  if (!isWorkshopOpen(state)) {
    return { ok: false, reason: `The workshop opens at Refining ${WORKSHOP.openAtRefiningLevel}.` };
  }
  if (slot < 0 || slot >= getWorkshopSlotCount(state)) {
    return { ok: false, reason: "That slot isn't unlocked yet." };
  }
  const recipe = WORKSHOP_RECIPES[recipeId];
  if (!recipe) {
    return { ok: false, reason: "Pick a recipe first." };
  }
  if (!isWorkshopRecipeUnlocked(state, recipeId)) {
    return { ok: false, reason: `${recipe.name} needs Manufacturing ${recipe.unlockLevel}.` };
  }
  // Number.isInteger rules out 2.5 batches, text, and so on.
  const maxBatches = getMaxOrderBatches(state);
  if (!Number.isInteger(batches) || batches < 1 || batches > maxBatches) {
    return { ok: false, reason: `An order can be 1 to ${maxBatches} batches.` };
  }

  let job = getWorkshopJob(state, slot);
  const queued = job ? job.orders.length : 0;
  if (queued >= getQueueLimit(state)) {
    return { ok: false, reason: `This slot's queue is full (${getQueueLimit(state)} orders).` };
  }

  // --- All good: queue it ---
  const order = { recipeId: recipeId, batches: batches, done: 0 };

  if (job) {
    job.orders.push(order);   // to the back of the queue
    // With the smart queue, a new order that has its metal can
    // start now even if the first order is still waiting.
    startWaitingOrders(state, now);
  } else {
    // An idle slot: make its job, waiting for metal to start.
    job = {
      id: "workshop-slot-" + slot,
      type: "workshop",
      slot: slot,
      orders: [order],
      status: "waiting",
      startedAt: now,
      durationMs: 0,
      inputs: null,
    };
    state.jobs.push(job);
    // Start straight away if the metal is already in the hold.
    startWaitingOrders(state, now);
  }
  return { ok: true };
}

// -------------------------------------------------------------
// cancelOrder(state, slot, index, now)
// Removes one order from a slot's queue (index 0 = the current
// order). Cancelling the current order mid-batch hands its
// metal back, so nothing is ever lost (but that batch's XP isn't
// earned). Batches already finished stay finished.
// Returns true if an order was removed.
// -------------------------------------------------------------
export function cancelOrder(state, slot, index, now) {
  const job = getWorkshopJob(state, slot);
  if (!job || index < 0 || index >= job.orders.length) {
    return false;
  }

  // Which work order's batch is running (-1 if none is: the slot
  // is waiting, or running a STANDING order's batch instead).
  const running = job.status === "working" && (job.standingIndex ?? null) === null
    ? getRunningIndex(job)
    : -1;

  // Cancelling the order whose batch is RUNNING: give the metal
  // back and stop the batch.
  if (index === running) {
    for (const [itemId, amount] of Object.entries(job.inputs)) {
      addItem(state, itemId, amount);
    }
    job.status = "waiting";
    job.inputs = null;
    job.runningIndex = 0;
  }

  // .splice(index, 1) removes one item from the list at "index".
  job.orders.splice(index, 1);

  // Cancelling an order IN FRONT of the running one moves the
  // running one up a place (from 2nd to 1st, say).
  if (running !== -1 && index < running) {
    job.runningIndex = running - 1;
  }

  if (job.orders.length === 0 && getStandingOrders(state, slot).length === 0 && job.status !== "working") {
    removeJob(state, job);              // nothing left: the slot is idle
  } else {
    startWaitingOrders(state, now);     // the next order may start now
  }
  return true;
}


// =============================================================
// STANDING ORDERS (needs the Control centre)
// =============================================================

// -------------------------------------------------------------
// addStandingOrder(state, slot, recipeId, target, now)
// "Keep [target] t of [product] in stock" on one slot.
// Returns { ok: true } or { ok: false, reason }.
// -------------------------------------------------------------
export function addStandingOrder(state, slot, recipeId, target, now) {
  if (!hasControlCentre(state)) {
    return { ok: false, reason: "Standing orders need the Control centre (Upgrades)." };
  }
  if (slot < 0 || slot >= getWorkshopSlotCount(state)) {
    return { ok: false, reason: "That slot isn't unlocked yet." };
  }
  const recipe = WORKSHOP_RECIPES[recipeId];
  if (!recipe) {
    return { ok: false, reason: "Pick a recipe first." };
  }
  if (!isWorkshopRecipeUnlocked(state, recipeId)) {
    return { ok: false, reason: `${recipe.name} needs Manufacturing ${recipe.unlockLevel}.` };
  }
  if (!Number.isInteger(target) || target < 1) {
    return { ok: false, reason: "The stock to keep is a whole number of tonnes, 1 or more." };
  }
  const standing = getStandingOrders(state, slot);
  if (standing.length >= WORKSHOP.standingPerSlot) {
    return { ok: false, reason: `This slot already has ${WORKSHOP.standingPerSlot} standing orders.` };
  }
  // .some is true if ANY standing order matches
  if (standing.some((order) => order.recipeId === recipeId)) {
    return { ok: false, reason: `This slot already keeps ${recipe.name.toLowerCase()} in stock.` };
  }

  // --- All good ---
  state.standingOrders[slot] = [...standing, { recipeId: recipeId, target: target }];
  if (!getWorkshopJob(state, slot)) {
    // The slot needs a job to work on standing orders. It starts
    // with an empty queue, waiting.
    state.jobs.push({
      id: "workshop-slot-" + slot,
      type: "workshop",
      slot: slot,
      orders: [],
      status: "waiting",
      startedAt: now,
      durationMs: 0,
      inputs: null,
    });
  }
  startWaitingOrders(state, now);
  return { ok: true };
}

// -------------------------------------------------------------
// removeStandingOrder(state, slot, index, now)
// Removes one standing order. If its batch is running, the metal
// comes back, as when cancelling a work order.
// Returns true if one was removed.
// -------------------------------------------------------------
export function removeStandingOrder(state, slot, index, now) {
  const standing = getStandingOrders(state, slot);
  if (index < 0 || index >= standing.length) {
    return false;
  }
  const job = getWorkshopJob(state, slot);
  const runningStanding = job && job.status === "working" ? job.standingIndex ?? null : null;

  if (runningStanding === index) {
    // Its batch is running: hand the metal back and stop it.
    for (const [itemId, amount] of Object.entries(job.inputs)) {
      addItem(state, itemId, amount);
    }
    job.status = "waiting";
    job.inputs = null;
    job.standingIndex = null;
  } else if (runningStanding !== null && runningStanding > index) {
    job.standingIndex = runningStanding - 1;   // the running one moved up a place
  }

  // A new list without that one (.filter keeps every other index)
  const left = standing.filter((order, i) => i !== index);
  if (left.length === 0) {
    delete state.standingOrders[slot];
  } else {
    state.standingOrders[slot] = left;
  }

  if (job && job.orders.length === 0 && left.length === 0 && job.status !== "working") {
    removeJob(state, job);                 // nothing left: idle
  } else {
    startWaitingOrders(state, now);
  }
  return true;
}

// -------------------------------------------------------------
// standingNeedsWork(state, order)
// True if a standing order's product is below its target. Stock
// is everything in the hold, bonded included.
// -------------------------------------------------------------
export function standingNeedsWork(state, order) {
  const output = WORKSHOP_RECIPES[order.recipeId].output;
  return (state.inventory[output] || 0) < order.target;
}

// Which order the job's current batch belongs to (0 = the first).
// Saves from before the smart queue have no runningIndex: 0.
export function getRunningIndex(job) {
  return job.runningIndex ?? 0;
}

// Takes a job out of the list of running jobs.
function removeJob(state, job) {
  state.jobs = state.jobs.filter((other) => other !== job);
}


// =============================================================
// RUNNING BATCHES (called by jobs.js as time passes)
// =============================================================

// -------------------------------------------------------------
// hasWorkshopInputs(state, recipeId)
// True if the hold has enough of every input for one batch.
// -------------------------------------------------------------
export function hasWorkshopInputs(state, recipeId) {
  const inputs = WORKSHOP_RECIPES[recipeId].inputs;
  return Object.entries(inputs).every(
    ([itemId, amount]) => (state.inventory[itemId] || 0) >= amount
  );
}

// -------------------------------------------------------------
// startWaitingOrders(state, time)
// Every waiting slot checks whether the hold has the metal for
// its current order's next batch. Those that do take it and
// start at "time". Slots are checked in order, so slot 1 gets
// first pick when two want the same metal.
// -------------------------------------------------------------
export function startWaitingOrders(state, time) {
  const waiting = state.jobs
    .filter((job) => job.type === "workshop" && job.status === "waiting")
    .sort((a, b) => a.slot - b.slot);

  for (const job of waiting) {
    // 1. Work orders first. Normally only the first order can
    //    run; with the smart queue, the first one that HAS its
    //    metal runs instead.
    const index = pickOrderToRun(state, job);
    // 2. If no work order can run, a standing order fills the gap.
    const standingIndex = index === -1 ? pickStandingToRun(state, job.slot) : -1;
    if (index === -1 && standingIndex === -1) {
      continue;   // nothing can run yet: keep waiting
    }
    const recipeId = index !== -1
      ? job.orders[index].recipeId
      : getStandingOrders(state, job.slot)[standingIndex].recipeId;

    // Take the metal out of the hold for this batch.
    const inputs = { ...WORKSHOP_RECIPES[recipeId].inputs };   // a copy
    for (const [itemId, amount] of Object.entries(inputs)) {
      state.inventory[itemId] -= amount;
    }

    job.status = "working";
    job.runningIndex = index === -1 ? 0 : index;
    job.standingIndex = index === -1 ? standingIndex : null;
    job.startedAt = time;
    job.durationMs = getWorkshopBatchMs(state, recipeId);
    job.inputs = inputs;
  }
}

// -------------------------------------------------------------
// pickOrderToRun(state, job)
// Which order should run the next batch, as a position in the
// queue (0 = first), or -1 if none can run yet.
//   Without the smart queue: the first order, or nothing.
//   With it: the first order that has its metal in the hold.
// -------------------------------------------------------------
function pickOrderToRun(state, job) {
  if (job.orders.length === 0) {
    return -1;                     // only standing orders on this slot
  }
  if (hasWorkshopInputs(state, job.orders[0].recipeId)) {
    return 0;
  }
  if (!hasSmartQueue(state)) {
    return -1;
  }
  // .findIndex gives the position of the first order that passes
  // the check, or -1 if none do.
  return job.orders.findIndex((order) => hasWorkshopInputs(state, order.recipeId));
}

// -------------------------------------------------------------
// pickStandingToRun(state, slot)
// The first standing order on this slot that's below its target
// and has its metal in the hold, or -1 if none.
// (Without the Control centre, standing orders never run.)
// -------------------------------------------------------------
function pickStandingToRun(state, slot) {
  if (!hasControlCentre(state)) {
    return -1;
  }
  return getStandingOrders(state, slot).findIndex(
    (order) => standingNeedsWork(state, order) && hasWorkshopInputs(state, order.recipeId)
  );
}

// -------------------------------------------------------------
// finishWorkshopBatch(state, job)
// A batch is done: the product goes into the hold and
// Manufacturing XP is earned. The order counts one more batch
// done; a finished order leaves the queue, and an empty queue
// means the slot goes idle (its job is removed).
// jobs.js then starts the next batch straight away if there's
// metal for it.
// Returns a result for the log, like the ships' results.
// -------------------------------------------------------------
export function finishWorkshopBatch(state, job) {
  // Whose batch was this: a standing order's, or a work order's?
  const standingIndex = job.standingIndex ?? null;
  const isStanding = standingIndex !== null;
  const index = getRunningIndex(job);
  const order = isStanding ? getStandingOrders(state, job.slot)[standingIndex] : job.orders[index];
  const recipe = WORKSHOP_RECIPES[order.recipeId];

  addItem(state, recipe.output, recipe.outputAmount);
  const newLevels = addXp(state, "manufacturing", recipe.xp);

  // Scrap recovery: a share of the metal comes back (5% of 30 t
  // = 1.5 t; the half tonne is carried to the next batch).
  const scrap = getEffect(state, "workshopScrap");
  if (scrap > 0) {
    for (const [itemId, amount] of Object.entries(job.inputs)) {
      addItemWithCarry(state, itemId, amount * scrap);
    }
  }

  // A work order counts its batches; a standing order never ends.
  let orderFinished = false;
  if (!isStanding) {
    order.done += 1;
    orderFinished = order.done >= order.batches;
    if (orderFinished) {
      job.orders.splice(index, 1);   // this order is done: out of the queue
    }
  }

  job.status = "waiting";
  job.inputs = null;
  job.runningIndex = 0;
  job.standingIndex = null;

  // Queue empty and no standing orders: the slot is idle.
  const idle = job.orders.length === 0 && getStandingOrders(state, job.slot).length === 0;
  if (idle) {
    removeJob(state, job);
  }

  return {
    kind: "workshop",
    slot: job.slot,
    recipeId: order.recipeId,
    itemId: recipe.output,
    amount: recipe.outputAmount,
    trips: 1,                          // (batches; "trips" so results add up the same way)
    ordersFinished: orderFinished ? 1 : 0,
    standing: isStanding,              // made for a standing order?
    slotIdle: idle,                    // true if this batch emptied the queue
    skillId: "manufacturing",
    xpGained: recipe.xp,
    newLevels: newLevels,
  };
}


// -------------------------------------------------------------
// describeWorkshopInputs(recipeId, formatTonnes)
// "30 t iron bars" or "40 t hull plating + 20 t structural
// frames", for the screen. (Kept here so the wording matches.)
// -------------------------------------------------------------
export function describeWorkshopInputs(recipeId, formatTonnes) {
  return Object.entries(WORKSHOP_RECIPES[recipeId].inputs)
    .map(([itemId, amount]) => `${formatTonnes(amount)} ${ITEMS[itemId].name.toLowerCase()}`)
    .join(" + ");
}
