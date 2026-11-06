// =============================================================
// js/fuel.js
// -------------------------------------------------------------
// FUEL: deuterium, the Isotope plant and the Drive reserve
// (design doc, "Refinery fuel and workshop power", Dan 6 Nov).
//
// The big idea: every refinery recipe BURNS deuterium, and only
// the Isotope plant makes it. Once the refinery wants more fuel
// than the plant makes, the plant's output sets how fast Refining
// can go. That lets better recipes earn more XP per second
// without Refining racing ahead of Mining.
//
// THE ISOTOPE PLANT
//   A building of its own at Anvil Station that pulls deuterium
//   out of ice. It opens WITH the refinery (Mining 8). It has one
//   slot that runs on repeat, like a refinery slot, but:
//     - it runs on electricity, so it burns no fuel itself
//     - it runs at a FIXED speed (Refining levels and furnace
//       linings don't touch it; plant upgrades will, later)
//   Its job in state.jobs looks like this:
//   {
//     id: "isotope-plant",
//     type: "isotope",
//     status: "working",        "waiting" (for ice) or "working"
//     startedAt: 1712345678901,
//     durationMs: 120000,
//     inputs: { ice: 60 },      ice taken for this batch (handed
//                               back if the plant is switched off)
//   }
//   No job = the plant is switched off.
//
// THE STARTER GRANT
//   When the refinery opens, 200 t of deuterium arrives and the
//   plant switches on, so the refinery is never blocked while the
//   player gets ice flowing. Old saves get the same grant (once).
//
// THE DRIVE RESERVE
//   A setting of its own, NOT a bond (Dan: one name, one meaning).
//   The refinery only burns deuterium ABOVE the reserve; torch
//   drives (later) can use all of it. Default 0 for now, because
//   no ship has a torch drive yet.
//
// BUYING FUEL
//   The Ledger sells deuterium at a premium (ITEMS.deuterium.
//   buyPrice), as the safety net if the plant can't keep up.
//
// Saved as:  state.fuel = { driveReserve: 0, granted: false }
// =============================================================

import { ISOTOPE_PLANT, ITEMS } from "../data/content.js";
import { addItem } from "./state.js";
import { addXp } from "./skills.js";
import { isRefineryOpen } from "./refinery.js";

// The plant's job ID: there's only ever one plant.
const PLANT_JOB_ID = "isotope-plant";


// =============================================================
// SETTING UP
// =============================================================

// -------------------------------------------------------------
// createFuel()
// The fuel settings for a new game (or an old save that never
// had them - see save.js).
// -------------------------------------------------------------
export function createFuel() {
  return {
    driveReserve: 0,   // tonnes the refinery must leave alone
    granted: false,    // has the starter grant been given yet?
  };
}

// The plant opens together with the refinery.
export function isIsotopePlantOpen(state) {
  return isRefineryOpen(state);
}


// =============================================================
// HOW MUCH FUEL THE REFINERY MAY USE
// =============================================================

// Tonnes of deuterium the refinery must leave for torch drives.
export function getDriveReserve(state) {
  return state.fuel.driveReserve || 0;
}

// -------------------------------------------------------------
// getFuelForRefinery(state)
// Deuterium the refinery is allowed to burn: whatever is in the
// hold ABOVE the Drive reserve. Never below 0.
//   300 t in the hold, reserve 100 t  ->  200 t usable
//    60 t in the hold, reserve 100 t  ->    0 t usable
// -------------------------------------------------------------
export function getFuelForRefinery(state) {
  const inHold = state.inventory.deuterium || 0;
  return Math.max(0, inHold - getDriveReserve(state));
}

// -------------------------------------------------------------
// setDriveReserve(state, tonnes)
// Changes the Drive reserve. Whole tonnes, 0 or more.
// Returns { ok: true } or { ok: false, reason } for the screen.
// -------------------------------------------------------------
export function setDriveReserve(state, tonnes) {
  if (!Number.isInteger(tonnes) || tonnes < 0) {
    return { ok: false, reason: "The Drive reserve is a whole number of tonnes, 0 or more." };
  }
  state.fuel.driveReserve = tonnes;
  return { ok: true };
}


// =============================================================
// THE STARTER GRANT
// =============================================================

// -------------------------------------------------------------
// checkFuelGrant(state, time)
// Called every time the game moves on (jobs.js). The first time
// the refinery is open, it gives the starter deuterium and
// switches the plant on. Returns the tonnes granted (0 if nothing
// happened), so the game can log it.
// -------------------------------------------------------------
export function checkFuelGrant(state, time) {
  if (state.fuel.granted || !isIsotopePlantOpen(state)) {
    return 0;
  }
  state.fuel.granted = true;
  addItem(state, "deuterium", ISOTOPE_PLANT.starterGrant);
  // Switch the plant on, ready for the first ice to arrive.
  setPlantRunning(state, true, time);
  return ISOTOPE_PLANT.starterGrant;
}


// =============================================================
// SWITCHING THE PLANT ON AND OFF
// =============================================================

// The plant's job, or undefined if it's switched off.
export function getPlantJob(state) {
  return state.jobs.find((job) => job.type === "isotope");
}

// -------------------------------------------------------------
// setPlantRunning(state, on, now)
// Switches the plant on (true) or off (false).
// Switching off hands back the ice from a half-finished batch,
// like stopping a refinery slot. Returns true if anything changed.
// -------------------------------------------------------------
export function setPlantRunning(state, on, now) {
  if (!isIsotopePlantOpen(state)) {
    return false;
  }
  const job = getPlantJob(state);

  if (on && !job) {
    state.jobs.push({
      id: PLANT_JOB_ID,
      type: "isotope",
      status: "waiting",
      // Only means something while a batch runs; a fixed 0 while
      // waiting keeps "played live" and "caught up offline" saves
      // identical, whichever tick happened to switch it on.
      startedAt: 0,
      durationMs: 0,
      inputs: null,
    });
    startPlantBatch(state, now);   // straight away, if there's ice
    return true;
  }

  if (!on && job) {
    if (job.status === "working" && job.inputs) {
      for (const [itemId, amount] of Object.entries(job.inputs)) {
        addItem(state, itemId, amount);   // the ice goes back
      }
    }
    state.jobs = state.jobs.filter((other) => other !== job);
    return true;
  }

  return false;   // already in that state
}


// =============================================================
// RUNNING BATCHES (called by jobs.js as time passes)
// =============================================================

// True if the hold has the ice for one batch.
export function hasIce(state) {
  return Object.entries(ISOTOPE_PLANT.inputs).every(
    ([itemId, amount]) => (state.inventory[itemId] || 0) >= amount
  );
}

// -------------------------------------------------------------
// startPlantBatch(state, time)
// If the plant is waiting and there's ice, it takes the ice and
// starts a batch at "time". Always the same length: the plant
// runs at a fixed speed.
// -------------------------------------------------------------
export function startPlantBatch(state, time) {
  const job = getPlantJob(state);
  if (!job || job.status !== "waiting" || !hasIce(state)) {
    return;
  }
  const inputs = { ...ISOTOPE_PLANT.inputs };   // a copy
  for (const [itemId, amount] of Object.entries(inputs)) {
    state.inventory[itemId] -= amount;
  }
  job.status = "working";
  job.startedAt = time;
  job.durationMs = ISOTOPE_PLANT.seconds * 1000;
  job.inputs = inputs;
}

// -------------------------------------------------------------
// finishPlantBatch(state, job)
// A batch is done: deuterium into the hold and a little Refining
// XP. The plant goes back to waiting (jobs.js starts the next
// batch straight away if there's ice).
// The result looks like a refinery batch's, with slot "plant",
// so reports and the welcome-back pop-up add it up with the
// refinery's metal without any extra code.
// -------------------------------------------------------------
export function finishPlantBatch(state, job) {
  const made = ISOTOPE_PLANT.outputAmount;
  addItem(state, ISOTOPE_PLANT.output, made);
  state.stats.refined[ISOTOPE_PLANT.output] = (state.stats.refined[ISOTOPE_PLANT.output] || 0) + made;
  const newLevels = addXp(state, "refining", ISOTOPE_PLANT.xp);

  job.status = "waiting";
  job.inputs = null;

  return {
    kind: "refine",
    slot: "plant",                 // not a refinery slot number
    recipeId: "deuterium",
    itemId: ISOTOPE_PLANT.output,
    amount: made,
    tolled: 0,
    trips: 1,
    skillId: "refining",
    xpGained: ISOTOPE_PLANT.xp,
    newLevels: newLevels,
  };
}


// =============================================================
// BUYING FUEL FROM THE LEDGER (the safety net)
// =============================================================

// What the Ledger charges for some tonnes of deuterium.
export function getFuelCost(tonnes) {
  return tonnes * ITEMS.deuterium.buyPrice;
}

// -------------------------------------------------------------
// buyFuel(state, tonnes)
// Buys deuterium from the Ledger with credits.
// Returns { ok: true, cost } or { ok: false, reason }.
// -------------------------------------------------------------
export function buyFuel(state, tonnes) {
  if (!Number.isInteger(tonnes) || tonnes <= 0) {
    return { ok: false, reason: "Buy a whole number of tonnes, 1 or more." };
  }
  if (!isIsotopePlantOpen(state)) {
    return { ok: false, reason: "Fuel is only needed once the refinery opens." };
  }
  const cost = getFuelCost(tonnes);
  if (state.credits < cost) {
    return { ok: false, reason: `Not enough credits: ${tonnes} t costs ${cost.toLocaleString("en-GB")} cr.` };
  }
  state.credits -= cost;
  addItem(state, "deuterium", tonnes);
  return { ok: true, cost: cost };
}
