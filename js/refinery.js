// =============================================================
// js/refinery.js
// -------------------------------------------------------------
// THE REFINERY at Anvil Station: turning ore into metal.
//
// The refinery has a few SLOTS (more unlock with Refining
// levels). The player picks a RECIPE for a slot, and that slot
// then runs batches of it over and over, like a ship's standing
// order:
//
//   WAITING   the slot has a recipe but the hold doesn't have
//             enough ore for a batch yet
//   WORKING   a batch is in the furnace; the ore was taken out
//             of the hold when it started
//   ...when the batch finishes, the metal goes into the hold,
//   Refining XP is earned, and the slot goes back to WAITING
//   (and straight into the next batch if there's ore).
//
// Each running slot is stored as a JOB in state.jobs, next to
// the ships' jobs, so jobs.js plays batches out in time order
// with everything else. That's what makes offline progress work:
// a barge docking at 12:00 with iron can feed a batch that
// starts at 12:00, all while the game is closed.
//
// A refinery job looks like this:
//   {
//     id: "refine-slot-0",
//     type: "refine",
//     slot: 0,                  which slot (0 = the first)
//     recipeId: "iron_bar",     what it's making
//     status: "working",        "waiting" or "working"
//     startedAt: 1712345678901, when the current batch started
//     durationMs: 60000,        how long this batch takes
//     inputs: { iron_ore: 60 }, ore taken for this batch (so it
//                               can be given back if stopped)
//     repeat: true,
//   }
// =============================================================

import { RECIPES, REFINERY, ITEMS } from "../data/content.js";
import { addItem, addItemWithCarry } from "./state.js";
import { getEffect, getEffectMax } from "./upgrades.js";
import { getLevel, addXp } from "./skills.js";


// =============================================================
// WHAT THE PLAYER HAS UNLOCKED
// =============================================================

// -------------------------------------------------------------
// isRefineryOpen(state)
// The refinery stays shut until a MINING milestone (Mining 8 to
// start with), so early on the player has to sell their ore.
// -------------------------------------------------------------
export function isRefineryOpen(state) {
  return getLevel(state, "mining") >= REFINERY.openAtMiningLevel;
}

// -------------------------------------------------------------
// getSlotCount(state)
// How many refinery slots the player can use. Most come with
// Refining levels - with slotLevels [1, 10, 25]: level 1-9 = 1,
// level 10-24 = 2, level 25+ = 3 - and upgrades can add more
// (Refinery slot 4).
// -------------------------------------------------------------
export function getSlotCount(state) {
  // A closed refinery has no slots to use at all.
  if (!isRefineryOpen(state)) {
    return 0;
  }
  const level = getLevel(state, "refining");
  // .filter keeps the slot levels the player has reached;
  // .length counts them.
  const fromLevels = REFINERY.slotLevels.filter((slotLevel) => level >= slotLevel).length;
  return fromLevels + getEffect(state, "refineSlot");
}

// -------------------------------------------------------------
// getMaxSlots()
// Every refinery slot that could ever exist: the level ones plus
// any an upgrade can add. The screen draws a box for each.
// -------------------------------------------------------------
export function getMaxSlots() {
  return REFINERY.slotLevels.length + getEffectMax("refineSlot");
}

// The Refining level a slot unlocks at (slot 0 = the first).
export function getSlotUnlockLevel(slot) {
  return REFINERY.slotLevels[slot];
}

// True if the player's Refining level allows this recipe.
export function isRecipeUnlocked(state, recipeId) {
  return getLevel(state, "refining") >= RECIPES[recipeId].unlockLevel;
}

// Which recipes unlock at exactly this Refining level,
// e.g. getRecipeUnlocksAtLevel(5) -> ["nickel_bar"]
export function getRecipeUnlocksAtLevel(level) {
  return Object.keys(RECIPES).filter((recipeId) => RECIPES[recipeId].unlockLevel === level);
}

// Which slots unlock at exactly this level, as slot NUMBERS
// the player would say ("slot 2"), e.g. level 10 -> [2].
export function getSlotUnlocksAtLevel(level) {
  const slots = [];
  REFINERY.slotLevels.forEach((slotLevel, index) => {
    if (slotLevel === level) {
      slots.push(index + 1);   // index 1 is "slot 2"
    }
  });
  return slots;
}


// =============================================================
// HOW LONG A BATCH TAKES
// =============================================================

// -------------------------------------------------------------
// getBatchMs(state, recipeId)
// Batch time in milliseconds. Two things make it shorter, and
// they MULTIPLY:
//   Refining level:  each level above 1 is speedPerLevel faster
//   Furnace linings: each one is 10% faster (upgrades.js)
//   level 1, no lining:   60s x 1.000         = 60s
//   level 11, no lining:  60s x 0.950         = 57s
//   level 11, 1 lining:   60s x 0.950 x 0.90  = 51.3s
// -------------------------------------------------------------
export function getBatchMs(state, recipeId) {
  const level = getLevel(state, "refining");
  const levelFactor = 1 - REFINERY.speedPerLevel * (level - 1);
  const upgradeFactor = 1 - getEffect(state, "refineSpeed");
  // Never let a batch get shorter than a tenth of its normal
  // time, even if someone sets a huge speed bonus in the sheet.
  const factor = Math.max(0.1, levelFactor * upgradeFactor);
  return Math.round(RECIPES[recipeId].seconds * 1000 * factor);
}

// -------------------------------------------------------------
// getBatchOutput(state, recipeId)
// Tonnes of metal one batch makes. Improved yield adds 10% each:
//   iron bars: 30 t, then 33 t, then 36 t
// (Steel's 45 t becomes 49.5 t: the half tonne is carried over
// to the next batch, so nothing is lost - see addItemWithCarry.)
// -------------------------------------------------------------
export function getBatchOutput(state, recipeId) {
  return RECIPES[recipeId].outputAmount * (1 + getEffect(state, "refineYield"));
}


// =============================================================
// STARTING AND STOPPING A SLOT
// =============================================================

// The refinery job for one slot, or undefined if the slot is idle.
export function getRefineJob(state, slot) {
  return state.jobs.find((job) => job.type === "refine" && job.slot === slot);
}

// -------------------------------------------------------------
// setRecipe(state, slot, recipeId, now)
// Gives a slot a recipe to run (recipeId), or stops it (null).
// Changing to a different recipe stops the current one first,
// handing back the ore from any half-finished batch.
// Returns true if anything changed.
// -------------------------------------------------------------
export function setRecipe(state, slot, recipeId, now) {
  // Only slots the player has unlocked can be used.
  if (slot < 0 || slot >= getSlotCount(state)) {
    return false;
  }
  // Only real recipes the player has unlocked (or null to stop).
  if (recipeId !== null && (!RECIPES[recipeId] || !isRecipeUnlocked(state, recipeId))) {
    return false;
  }

  const current = getRefineJob(state, slot);
  if (current && current.recipeId === recipeId) {
    return false;   // already making that: nothing to do
  }
  if (current) {
    stopSlot(state, current);
  }
  if (recipeId === null) {
    return true;    // stopped, and that's all
  }

  state.jobs.push({
    id: "refine-slot-" + slot,
    type: "refine",
    slot: slot,
    recipeId: recipeId,
    status: "waiting",
    startedAt: now,
    durationMs: 0,
    inputs: null,
    repeat: true,
  });

  // Start straight away if there's ore in the hold.
  startWaitingBatches(state, now);
  return true;
}

// -------------------------------------------------------------
// stopSlot(state, job)
// Removes a slot's job. Ore from a half-finished batch goes back
// into the hold, so stopping never loses anything (but the
// batch's XP isn't earned).
// -------------------------------------------------------------
function stopSlot(state, job) {
  if (job.status === "working" && job.inputs) {
    for (const [itemId, amount] of Object.entries(job.inputs)) {
      addItem(state, itemId, amount);
    }
  }
  state.jobs = state.jobs.filter((other) => other !== job);
}


// =============================================================
// RUNNING BATCHES (called by jobs.js as time passes)
// =============================================================

// -------------------------------------------------------------
// hasInputs(state, recipeId)
// True if the hold has enough of every input for one batch.
// -------------------------------------------------------------
export function hasInputs(state, recipeId) {
  const inputs = RECIPES[recipeId].inputs;
  // .every is true only if the check passes for EVERY input
  return Object.entries(inputs).every(
    ([itemId, amount]) => (state.inventory[itemId] || 0) >= amount
  );
}

// -------------------------------------------------------------
// startWaitingBatches(state, time)
// Every waiting slot checks whether the hold has the ore for a
// batch. Those that do take it and start at "time".
// Slots are checked in order, so slot 1 gets first pick.
// (Nothing starts while the refinery is closed.)
// -------------------------------------------------------------
export function startWaitingBatches(state, time) {
  if (!isRefineryOpen(state)) {
    return;
  }

  // Copy the list and sort it by slot, so the order is the same
  // every time (it matters when two slots want the same ore).
  const waiting = state.jobs
    .filter((job) => job.type === "refine" && job.status === "waiting")
    .sort((a, b) => a.slot - b.slot);

  for (const job of waiting) {
    if (!hasInputs(state, job.recipeId)) {
      continue;   // not enough ore yet: keep waiting
    }

    // Take the ore out of the hold for this batch.
    const inputs = { ...RECIPES[job.recipeId].inputs };   // a copy
    for (const [itemId, amount] of Object.entries(inputs)) {
      state.inventory[itemId] -= amount;
    }

    job.status = "working";
    job.startedAt = time;
    job.durationMs = getBatchMs(state, job.recipeId);
    job.inputs = inputs;
  }
}

// -------------------------------------------------------------
// finishBatch(state, job)
// A batch is done: the metal goes into the hold and Refining XP
// is earned. The slot goes back to waiting (jobs.js then starts
// the next batch straight away if there's ore).
// Returns a result for the log, like the ships' results.
// -------------------------------------------------------------
export function finishBatch(state, job) {
  const recipe = RECIPES[job.recipeId];

  // Whole tonnes into the hold now; any part-tonne waits for the
  // next batch (Improved yield can make 49.5 t of steel).
  const made = addItemWithCarry(state, recipe.output, getBatchOutput(state, job.recipeId));
  // The running total smelting contracts count from (contracts.js)
  state.stats.refined[recipe.output] = (state.stats.refined[recipe.output] || 0) + made;
  const newLevels = addXp(state, "refining", recipe.xp);

  job.status = "waiting";
  job.inputs = null;

  return {
    kind: "refine",
    slot: job.slot,
    recipeId: job.recipeId,
    itemId: recipe.output,
    amount: made,
    trips: 1,                 // (batches - called trips so results add up the same way)
    skillId: "refining",
    xpGained: recipe.xp,
    newLevels: newLevels,
  };
}


// -------------------------------------------------------------
// describeInputs(recipeId)
// "60 t iron ore" or "60 t iron ore + 30 t nickel ore", for the
// screen. (Kept here so the wording matches everywhere.)
// -------------------------------------------------------------
export function describeInputs(recipeId, formatTonnes) {
  return Object.entries(RECIPES[recipeId].inputs)
    .map(([itemId, amount]) => `${formatTonnes(amount)} ${ITEMS[itemId].name.toLowerCase()}`)
    .join(" + ");
}
