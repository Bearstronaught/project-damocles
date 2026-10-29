// =============================================================
// js/ship-upgrades.js
// -------------------------------------------------------------
// SHIP UPGRADES, and a ship's STATS once upgrades and levels are
// counted.
//
// Each hull TYPE has up to three parts: a drill (mining ships
// only), a cargo hold and a drive. Each part goes from stock to
// Mk I, Mk II, then Mk III. One purchase upgrades every ship of
// that type, including ones bought later (agreed with Dan,
// 29 Oct): fewer clicks, and it matches the planned blueprints.
//
//   Mk I    credits only - a cheap early goal
//   Mk II   credits plus workshop components
//   Mk III  credits plus workshop assemblies
//
// Each grade adds its bonus to the part's stat, and grades add
// up: three drill grades at +15% each = +45% mining rate.
//
// What's owned is stored as the grade reached per hull and part:
//   state.shipUpgrades = { prospector: { drill: 2, hold: 1 } }
// A part with no entry is stock (grade 0).
//
// getShipStats() at the bottom is the ONE place a ship's working
// numbers come from: the hull's base stats, plus its parts, plus
// the Mining level perk on drills. Trips (jobs.js) and the screen
// both use it, so they can never disagree.
// =============================================================

import { SHIP_TYPES, SHIP_UPGRADES, SHIP_PARTS, SKILLS, ITEMS } from "../data/content.js";
import { getLevel, getMiningDrillPerk } from "./skills.js";


// -------------------------------------------------------------
// getPartGrade(state, hullId, part)
// The grade a part has reached: 0 (stock), 1, 2 or 3.
// -------------------------------------------------------------
export function getPartGrade(state, hullId, part) {
  // (Very old saves being upgraded have no shipUpgrades yet.)
  const hull = state.shipUpgrades && state.shipUpgrades[hullId];
  return (hull && hull[part]) || 0;
}

// -------------------------------------------------------------
// getHullParts(hullId)
// The parts this hull can upgrade, in screen order, e.g.
//   "prospector" -> ["drill", "hold", "drive"]
//   "courier"    -> ["hold", "drive"]       (no drill)
// Worked out from which upgrades exist in the balance sheet.
// -------------------------------------------------------------
export function getHullParts(hullId) {
  return Object.keys(SHIP_PARTS).filter((part) =>
    Object.values(SHIP_UPGRADES).some((u) => u.hull === hullId && u.part === part)
  );
}

// -------------------------------------------------------------
// findUpgrade(hullId, part, grade)
// The upgrade for one grade of one part, as { id, ...data },
// or null if there isn't one (e.g. past Mk III).
// -------------------------------------------------------------
export function findUpgrade(hullId, part, grade) {
  for (const [id, upgrade] of Object.entries(SHIP_UPGRADES)) {
    if (upgrade.hull === hullId && upgrade.part === part && upgrade.grade === grade) {
      return { id, ...upgrade };
    }
  }
  return null;
}

// -------------------------------------------------------------
// getNextUpgrade(state, hullId, part)
// The next grade to buy for this part, or null when it's at the
// top grade.
// -------------------------------------------------------------
export function getNextUpgrade(state, hullId, part) {
  return findUpgrade(hullId, part, getPartGrade(state, hullId, part) + 1);
}

// -------------------------------------------------------------
// getPartBonus(state, hullId, part)
// The part's total bonus from every grade owned, e.g. Mk II drill
// = 0.15 + 0.15 = 0.30 (+30%).
// -------------------------------------------------------------
export function getPartBonus(state, hullId, part) {
  let total = 0;
  for (let grade = 1; grade <= getPartGrade(state, hullId, part); grade++) {
    total += findUpgrade(hullId, part, grade).bonus;
  }
  return total;
}

// -------------------------------------------------------------
// getHullShortName(hullId)
// "Prospector-class barge" -> "Prospector", for upgrade names.
// -------------------------------------------------------------
export function getHullShortName(hullId) {
  return SHIP_TYPES[hullId].name.split("-")[0];
}

// -------------------------------------------------------------
// getUpgradeName(upgrade)
// e.g. "Prospector drill Mk II".
// -------------------------------------------------------------
export function getUpgradeName(upgrade) {
  const partName = SHIP_PARTS[upgrade.part].name.toLowerCase();
  return `${getHullShortName(upgrade.hull)} ${partName} ${upgrade.gradeName}`;
}


// -------------------------------------------------------------
// canBuyShipUpgrade(state, upgradeId)
// Checks every rule, in the order a player would want to know.
// Returns { ok: true } or { ok: false, reason: "..." }.
// Goods count from the whole hold, bonded stock included (the
// same rule as station upgrades: that's what bonding is for).
// -------------------------------------------------------------
export function canBuyShipUpgrade(state, upgradeId) {
  const upgrade = SHIP_UPGRADES[upgradeId];
  if (!upgrade) {
    return { ok: false, reason: "There's no such upgrade." };
  }

  const owned = getPartGrade(state, upgrade.hull, upgrade.part);
  if (owned >= upgrade.grade) {
    return { ok: false, reason: "Already fitted." };
  }
  // Grades go in order: no Mk II before Mk I.
  if (owned < upgrade.grade - 1) {
    const previous = findUpgrade(upgrade.hull, upgrade.part, upgrade.grade - 1);
    return { ok: false, reason: `Needs ${getUpgradeName(previous)} first.` };
  }
  if (getLevel(state, upgrade.skill) < upgrade.level) {
    return { ok: false, reason: `Needs ${SKILLS[upgrade.skill].name} ${upgrade.level}.` };
  }

  // Goods: say exactly what's missing, e.g. "Need 12 t more wiring coils."
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
// buyShipUpgrade(state, upgradeId)
// Pays and fits the upgrade to the whole hull type.
// Ships already on a trip finish it as they are; their NEXT trip
// uses the new stats (jobs.js plans every trip fresh).
// -------------------------------------------------------------
export function buyShipUpgrade(state, upgradeId) {
  const check = canBuyShipUpgrade(state, upgradeId);
  if (!check.ok) {
    return check;
  }
  const upgrade = SHIP_UPGRADES[upgradeId];
  for (const [itemId, tonnes] of Object.entries(upgrade.costs)) {
    state.inventory[itemId] -= tonnes;
  }
  state.credits -= upgrade.credits;

  // Make the hull's entry if it's the first upgrade for it.
  if (!state.shipUpgrades[upgrade.hull]) {
    state.shipUpgrades[upgrade.hull] = {};
  }
  state.shipUpgrades[upgrade.hull][upgrade.part] = upgrade.grade;
  return { ok: true };
}

// -------------------------------------------------------------
// getShipUpgradeUnlocksAtLevel(skillId, level)
// Ship upgrades that become buyable at exactly this level, for
// the level-up log, banner and skill cards.
// -------------------------------------------------------------
export function getShipUpgradeUnlocksAtLevel(skillId, level) {
  return Object.keys(SHIP_UPGRADES).filter(
    (id) => SHIP_UPGRADES[id].skill === skillId && SHIP_UPGRADES[id].level === level
  );
}


// =============================================================
// A SHIP'S STATS
// =============================================================

// -------------------------------------------------------------
// getShipStats(state, hullId)
// The numbers a ship of this type actually works with right now:
//   {
//     cargoCapacity  tonnes (whole), base + hold upgrades
//     miningRate     tonnes per minute, base + drill upgrades +
//                    the Mining level perk (mining ships only)
//     speed          drive speed, base + drive upgrades
//   }
// Bonuses ADD to each other before multiplying the base:
//   Prospector drill Mk I (+15%) at Mining 11 (+5%):
//   120 t/min x (1 + 0.15 + 0.05) = 144 t/min
// Adding (rather than multiplying one bonus by the next) keeps
// every bonus worth exactly what it says on screen.
// -------------------------------------------------------------
export function getShipStats(state, hullId) {
  const base = SHIP_TYPES[hullId];

  const holdBonus = getPartBonus(state, hullId, "hold");
  const driveBonus = getPartBonus(state, hullId, "drive");

  const stats = {
    // Math.round keeps the hold in whole tonnes (480 x 1.15 = 552).
    cargoCapacity: Math.round(base.cargoCapacity * (1 + holdBonus)),
    speed: base.speed * (1 + driveBonus),
  };

  // Only mining ships have a drill (and get the Mining perk).
  if (base.miningRate) {
    const drillBonus = getPartBonus(state, hullId, "drill") + getMiningDrillPerk(state);
    stats.miningRate = base.miningRate * (1 + drillBonus);
  }
  return stats;
}
