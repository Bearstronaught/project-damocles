// =============================================================
// js/welcome-back.js
// -------------------------------------------------------------
// THE WELCOME-BACK REPORT: the sums behind it (agreed 5 Nov).
//
// After 10 minutes or more away, one pop-up says what happened,
// grouped by role (Mining, Freight, Station industry, and so
// on). This file only does the ADDING UP: it takes the list of
// results the simulation engine played while you were away and
// turns it into totals. It has no screen code at all, so the
// tests (tests/logic-tests.js) can check the sums in Node.
//
// The pop-up itself is drawn by js/welcome-popup.js, and the
// words are put together in js/main.js (where the helpers for
// unlock lines and perks already live).
// =============================================================


// A gap at least this long (in seconds) gets the pop-up.
// Shorter gaps get one line in the log instead (Dan, 5 Nov:
// "anything lower than that can be tracked reasonably easily
// by the player without a notification"). It was 60 seconds.
export const WELCOME_BACK_SECONDS = 10 * 60;

// Long lists of goods show this many, then "and 2 more".
export const LIST_LIMIT = 3;


// -------------------------------------------------------------
// summariseTimeAway(results)
// Adds up a list of results from the engine (see jobs.js for
// what each kind looks like). Returns one object per role:
//
//   { mining:      { trips: 41, ore: { iron_ore: 3800 } },
//     freight:     { runs: 18, sold: { iron_bar: 600 }, credits: 162900 },
//     industry:    { refined: { iron_bar: 1900 }, made: { hull_plating: 320 }, idleSlots: [2] },
//     exploration: { deepScans: 12, surveys: ["ice_moon"], finds: [...] },
//     contracts:   { done: 2, paid: 21400, posted: 1, tiers: [{ faction, tier }] },
//     shipyard:    { built: ["excavator"] },
//     levels:      { mining: { from: 21, to: 23, levels: [22, 23] } } }
//
// A role with nothing in it is still there, just with zeros and
// empty lists; hasActivity() below says whether to show it.
// -------------------------------------------------------------
export function summariseTimeAway(results) {
  const summary = {
    mining:      { trips: 0, ore: {} },
    freight:     { runs: 0, sold: {}, credits: 0 },
    industry:    { refined: {}, made: {}, idleSlots: [] },
    exploration: { deepScans: 0, surveys: [], finds: [] },
    contracts:   { done: 0, paid: 0, posted: 0, tiers: [] },
    shipyard:    { built: [] },
    levels:      {},
  };

  for (const result of results) {
    // --- One role at a time, by the kind of result ---
    if (result.kind === "mining") {
      summary.mining.trips += result.trips;
      addAmount(summary.mining.ore, result.itemId, result.amount);

    } else if (result.kind === "haul") {
      summary.freight.runs += result.trips;
      // result.cargo is a list of what was sold, e.g. { iron_ore: 400 }
      for (const [itemId, amount] of Object.entries(result.cargo)) {
        addAmount(summary.freight.sold, itemId, amount);
      }
      summary.freight.credits += result.credits;

    } else if (result.kind === "refine") {
      addAmount(summary.industry.refined, result.itemId, result.amount);

    } else if (result.kind === "workshop") {
      addAmount(summary.industry.made, result.itemId, result.amount);
      // A workshop slot whose queue ran out (slot numbers start at 1
      // for the player; the code counts from 0)
      if (result.slotIdle && !summary.industry.idleSlots.includes(result.slot + 1)) {
        summary.industry.idleSlots.push(result.slot + 1);
      }

    } else if (result.kind === "scout") {
      summary.exploration.deepScans += result.deepScans;
      summary.exploration.surveys.push(...result.surveys);
      summary.exploration.finds.push(...result.finds);

    } else if (result.kind === "contract") {
      summary.contracts.done += 1;
      summary.contracts.paid += result.credits;
      // A new reputation tier reached while away
      if (result.tierAfter !== result.tierBefore) {
        summary.contracts.tiers.push({ faction: result.contract.faction, tier: result.tierAfter });
      }

    } else if (result.kind === "posted") {
      summary.contracts.posted += 1;

    } else if (result.kind === "built") {
      summary.shipyard.built.push(result.typeId);
    }

    // --- Level-ups, from any kind of result ---
    // (A docked or built result never has any, so this is safe.)
    if (result.skillId && result.newLevels && result.newLevels.length > 0) {
      addLevels(summary.levels, result.skillId, result.newLevels);
    }
  }

  return summary;
}


// -------------------------------------------------------------
// hasActivity(role)
// True if a role's part of the summary has anything to say,
// so roles that did nothing are left out of the pop-up.
// -------------------------------------------------------------
export function hasActivity(roleId, summary) {
  const role = summary[roleId];
  switch (roleId) {
    case "mining":      return role.trips > 0;
    case "freight":     return role.runs > 0;
    case "industry":    return hasAny(role.refined) || hasAny(role.made);
    case "exploration": return role.deepScans > 0 || role.surveys.length > 0;
    case "contracts":   return role.done > 0 || role.posted > 0;
    case "shipyard":    return role.built.length > 0;
    default:            return false;
  }
}


// -------------------------------------------------------------
// largestFirst(amounts, limit)
// Turns { iron_ore: 400, nickel_ore: 3800, ice: 60, ... } into
// the biggest few, largest first, plus how many were left off:
//   { shown: [["nickel_ore", 3800], ["iron_ore", 400], ["ice", 60]],
//     more: 2 }
// so the pop-up can say "... and 2 more" instead of a long list.
// -------------------------------------------------------------
export function largestFirst(amounts, limit = LIST_LIMIT) {
  // Object.entries gives [itemId, amount] pairs; sort by amount,
  // biggest first (b minus a sorts high to low).
  const sorted = Object.entries(amounts).sort((a, b) => b[1] - a[1]);
  return {
    shown: sorted.slice(0, limit),          // the first few
    more: Math.max(0, sorted.length - limit), // how many didn't fit
  };
}


// -------------------------------------------------------------
// Small helpers
// -------------------------------------------------------------

// Adds an amount to a running total for one item.
function addAmount(totals, itemId, amount) {
  totals[itemId] = (totals[itemId] || 0) + amount;
}

// Is there at least one item in this { itemId: amount } list?
function hasAny(amounts) {
  return Object.keys(amounts).length > 0;
}

// Records new levels for one skill. "from" is the level before
// the first new one, "to" the highest reached; "levels" keeps
// every one in order, so the pop-up can list each one's unlocks.
function addLevels(levels, skillId, newLevels) {
  if (!levels[skillId]) {
    levels[skillId] = { from: Math.min(...newLevels) - 1, to: 0, levels: [] };
  }
  const entry = levels[skillId];
  for (const level of newLevels) {
    if (!entry.levels.includes(level)) entry.levels.push(level);
  }
  entry.levels.sort((a, b) => a - b);         // lowest first
  entry.from = Math.min(entry.from, entry.levels[0] - 1);
  entry.to = entry.levels[entry.levels.length - 1];
}
