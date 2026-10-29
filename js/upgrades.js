// =============================================================
// js/upgrades.js
// -------------------------------------------------------------
// UPGRADES for the refinery and workshop, bought on the Industry
// tab with the player's own products plus credits.
//
// Which upgrades exist, what they cost and what they do all
// come from content.js (numbers from the balance sheet's
// Upgrades tab). This file only knows the RULES:
//   - you need the right skill level
//   - some need an earlier tier first (Furnace lining II needs I)
//   - you pay goods from the hold and credits
//   - each upgrade is bought once
//
// The refinery and workshop never ask "does the player own
// Furnace lining II?". They ask getEffect(state, "refineSpeed")
// and get the total of every owned upgrade with that effect,
// e.g. 0.2 with two Furnace linings. So adding a new upgrade is
// just a new row in the sheet - no code changes.
//
// Owned upgrades are stored in the save as:
//   state.upgrades = { furnace_lining_1: true }
// =============================================================

import { UPGRADES, ITEMS, SKILLS } from "../data/content.js";
import { getLevel } from "./skills.js";


// -------------------------------------------------------------
// isOwned(state, upgradeId)
// True if the player has bought this upgrade.
// -------------------------------------------------------------
export function isOwned(state, upgradeId) {
  return state.upgrades[upgradeId] === true;
}

// -------------------------------------------------------------
// getEffect(state, effect)
// The total of one effect from every upgrade the player owns.
//   getEffect(state, "refineSpeed")  ->  0.2  (two linings)
//   getEffect(state, "smartQueue")   ->  0 or 1
// -------------------------------------------------------------
export function getEffect(state, effect) {
  let total = 0;
  for (const [upgradeId, upgrade] of Object.entries(UPGRADES)) {
    if (upgrade.effect === effect && isOwned(state, upgradeId)) {
      total += upgrade.value;
    }
  }
  return total;
}

// -------------------------------------------------------------
// getEffectMax(effect)
// The total of one effect if EVERY upgrade were owned. Used to
// know how many extra refinery slots could ever exist, so the
// screen can draw a box for each.
// -------------------------------------------------------------
export function getEffectMax(effect) {
  let total = 0;
  for (const upgrade of Object.values(UPGRADES)) {
    if (upgrade.effect === effect) total += upgrade.value;
  }
  return total;
}

// -------------------------------------------------------------
// isShown(state, upgradeId)
// The Industry tab only lists upgrades that are owned, or the
// NEXT tier of their line (design doc: "showing only what is
// available or next"). Furnace lining II stays hidden until
// Furnace lining I is owned.
// -------------------------------------------------------------
export function isShown(state, upgradeId) {
  const upgrade = UPGRADES[upgradeId];
  return isOwned(state, upgradeId) || upgrade.requires === null || isOwned(state, upgrade.requires);
}


// -------------------------------------------------------------
// canBuyIndustryUpgrade(state, upgradeId)
// Checks every rule, in the order a player would want to know.
// Returns { ok: true } or { ok: false, reason: "..." }.
// Goods are counted from the whole hold, bonded stock included:
// that's what bonding is for.
// -------------------------------------------------------------
export function canBuyIndustryUpgrade(state, upgradeId) {
  const upgrade = UPGRADES[upgradeId];
  if (!upgrade) {
    return { ok: false, reason: "There's no such upgrade." };
  }
  if (isOwned(state, upgradeId)) {
    return { ok: false, reason: "Already owned." };
  }
  if (getLevel(state, upgrade.skill) < upgrade.level) {
    return { ok: false, reason: `Needs ${SKILLS[upgrade.skill].name} ${upgrade.level}.` };
  }
  if (upgrade.requires !== null && !isOwned(state, upgrade.requires)) {
    return { ok: false, reason: `Needs ${UPGRADES[upgrade.requires].name} first.` };
  }

  // Goods: say exactly what's missing, e.g. "Need 12 t more hull plating."
  for (const [itemId, tonnes] of Object.entries(upgrade.costs)) {
    const have = state.inventory[itemId] || 0;
    if (have < tonnes) {
      return { ok: false, reason: `Need ${tonnes - have} t more ${ITEMS[itemId].name.toLowerCase()}.` };
    }
  }
  if (state.credits < upgrade.credits) {
    return { ok: false, reason: `Need ${(upgrade.credits - state.credits).toLocaleString("en-GB")} cr more.` };
  }
  return { ok: true };
}

// -------------------------------------------------------------
// buyIndustryUpgrade(state, upgradeId)
// Pays for an upgrade and marks it owned. Returns the same
// { ok, reason } as canBuyIndustryUpgrade, so a refusal can be shown.
// The effect starts with the NEXT batch: one already running
// keeps the time it started with.
// -------------------------------------------------------------
export function buyIndustryUpgrade(state, upgradeId) {
  const check = canBuyIndustryUpgrade(state, upgradeId);
  if (!check.ok) {
    return check;
  }
  const upgrade = UPGRADES[upgradeId];
  for (const [itemId, tonnes] of Object.entries(upgrade.costs)) {
    state.inventory[itemId] -= tonnes;
  }
  state.credits -= upgrade.credits;
  state.upgrades[upgradeId] = true;
  return { ok: true };
}

// -------------------------------------------------------------
// getUpgradeUnlocksAtLevel(skillId, level)
// Upgrades that become buyable at exactly this level, for the
// level-up log and banner, e.g. ("refining", 8) -> ["furnace_lining_1"].
// -------------------------------------------------------------
export function getUpgradeUnlocksAtLevel(skillId, level) {
  return Object.keys(UPGRADES).filter(
    (id) => UPGRADES[id].skill === skillId && UPGRADES[id].level === level
  );
}
