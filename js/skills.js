// =============================================================
// js/skills.js
// -------------------------------------------------------------
// SKILLS: XP, levels, and what each level unlocks.
//
// The state only stores each skill's total XP. The LEVEL is
// always worked out from the XP using the XP table below.
// Storing just one number means the two can never disagree, and
// if we change the curve later, everyone's levels update.
// =============================================================

import { SHIP_TYPES, FIELDS, RULES, LEVEL_PERKS, REFINERY, WORKSHOP, EXPLORATION } from "../data/content.js";

// The highest level (99, set in content.js).
export const MAX_LEVEL = RULES.maxLevel;


// -------------------------------------------------------------
// THE XP TABLE (RuneScape's formula)
// -------------------------------------------------------------
// In RuneScape, the XP to go from level n to level n+1 is:
//
//     ( n + 300 × 2^(n / 7) ) ÷ 4      (rounded down at each step)
//
// The "2^(n / 7)" part doubles every 7 levels, so early levels
// are quick and later ones take much longer. Adding the steps
// up gives the TOTAL XP needed to reach each level:
//
//     level 2 = 83,  level 10 = 1,154,  level 50 = 101,333,
//     level 92 = 6,517,253 (half of 99!),  level 99 = 13,034,431
//
// XP_TABLE[level] = total XP needed to reach that level.
// Position 0 is unused, so the position matches the level.
export const XP_TABLE = buildXpTable(MAX_LEVEL);

function buildXpTable(maxLevel) {
  const table = [null, 0];   // no level 0; level 1 needs 0 XP
  let points = 0;            // running total, before the final ÷ 4

  for (let level = 1; level < maxLevel; level++) {
    // Math.floor rounds down; Math.pow(2, x) is 2 to the power x.
    points += Math.floor(level + 300 * Math.pow(2, level / 7));
    table.push(Math.floor(points / 4));
  }
  return table;
}


// -------------------------------------------------------------
// getLevelForXp(xp)
// Turns a total XP number into a level.
// e.g. 0 -> 1,  82 -> 1,  83 -> 2,  1154 -> 10
// -------------------------------------------------------------
export function getLevelForXp(xp) {
  // Start at the top level and work down until we find one
  // the player has enough XP for.
  for (let level = MAX_LEVEL; level >= 1; level--) {
    if (xp >= XP_TABLE[level]) {
      return level;
    }
  }
  return 1;
}


// -------------------------------------------------------------
// getLevel(state, skillId)
// The player's current level in a skill.
// -------------------------------------------------------------
export function getLevel(state, skillId) {
  return getLevelForXp(state.skills[skillId].xp);
}


// -------------------------------------------------------------
// getLevelProgress(state, skillId)
// Everything the screen needs to draw an XP bar:
//   { level, xp, xpIntoLevel, xpForNextLevel, fraction, isMax }
// "xpIntoLevel" counts from the START of the current level, so
// the bar empties each time you level up.
// -------------------------------------------------------------
export function getLevelProgress(state, skillId) {
  const xp = state.skills[skillId].xp;
  const level = getLevelForXp(xp);

  // At the top level there's nothing left to fill.
  if (level >= MAX_LEVEL) {
    return { level, xp, xpIntoLevel: 0, xpForNextLevel: 0, fraction: 1, isMax: true };
  }

  const levelStart = XP_TABLE[level];          // XP where this level began
  const nextLevelAt = XP_TABLE[level + 1];     // XP where the next one begins

  const xpIntoLevel = xp - levelStart;
  const xpForNextLevel = nextLevelAt - levelStart;

  return {
    level,
    xp,
    xpIntoLevel,
    xpForNextLevel,
    fraction: xpIntoLevel / xpForNextLevel,    // 0 to 1, for the bar
    isMax: false,
  };
}


// -------------------------------------------------------------
// addXp(state, skillId, amount)
// Gives XP to a skill. Returns a list of any NEW levels reached,
// e.g. [2] or [2, 3] if a big chunk of offline XP skipped two.
// An empty list means no level-up.
// -------------------------------------------------------------
export function addXp(state, skillId, amount) {
  const levelBefore = getLevel(state, skillId);
  state.skills[skillId].xp += amount;
  const levelAfter = getLevel(state, skillId);

  const newLevels = [];
  for (let level = levelBefore + 1; level <= levelAfter; level++) {
    newLevels.push(level);
  }
  return newLevels;
}


// -------------------------------------------------------------
// isShipTypeUnlocked(state, shipTypeId)
// True if the player's skill level is high enough to buy it.
// -------------------------------------------------------------
export function isShipTypeUnlocked(state, shipTypeId) {
  const shipType = SHIP_TYPES[shipTypeId];
  // Some ships also wait for a milestone (the Pathfinder waits
  // for the first sale - see MILESTONES in content.js).
  if (shipType.unlockAfter && !state.milestones[shipType.unlockAfter]) {
    return false;
  }
  return getLevel(state, shipType.skill) >= shipType.unlockLevel;
}


// -------------------------------------------------------------
// isFieldUnlocked(state, fieldId)
// True if ships can be sent to this field: the player's Mining
// level is high enough, and, for a field that's opened by a
// survey (the Ice moon), a scout has surveyed it.
// -------------------------------------------------------------
export function isFieldUnlocked(state, fieldId) {
  const field = FIELDS[fieldId];
  if (getLevel(state, "mining") < field.unlockLevel) return false;
  if (field.survey && !state.exploration.surveyed[field.survey]) return false;
  return true;
}

// -------------------------------------------------------------
// canHullWorkField(shipTypeId, fieldId)
// True if a ship of this type can work this field at all, going
// by its hull size (Dan, 1 and 4 Nov). A field's "hulls" lists the
// sizes allowed; null means any hull can go there.
//   Surface fields, e.g. the Ice moon (hulls: ['small']): only a
//     small hull can land and lift off again.
//   Deep-core fields (hulls: ['large', 'capital']): only a heavy
//     barge can cut into a dense asteroid core.
// This is about the HULL, not the player: whether the field is
// open yet is isFieldUnlocked's job (above).
// -------------------------------------------------------------
export function canHullWorkField(shipTypeId, fieldId) {
  const allowed = FIELDS[fieldId].hulls;
  if (!allowed) return true;                          // any hull
  return allowed.includes(SHIP_TYPES[shipTypeId].size);
}

// -------------------------------------------------------------
// getFirstFieldFor(state, shipTypeId)
// Where a newly bought barge heads by default.
//   A big hull goes to an open field kept for its size, if there
//   is one: a Deep-core barge to the deep core, the place it was
//   built for. (It CAN work the belts - asteroid belts are open to
//   every hull - but it would earn far less there.)
//   Otherwise, the first open field (in screen order) it can
//   work: the Inner Belt for a Prospector or an Excavator, as
//   always, so the early game is unchanged.
// Falls back to the first field this hull can ever work, so a
// ship always has somewhere sensible to point at.
// -------------------------------------------------------------
export function getFirstFieldFor(state, shipTypeId) {
  const size = SHIP_TYPES[shipTypeId].size;
  const ids = Object.keys(FIELDS).filter((fieldId) => canHullWorkField(shipTypeId, fieldId));
  const open = ids.filter((fieldId) => isFieldUnlocked(state, fieldId));
  if (size !== "small") {
    const keptForSize = open.find((fieldId) => FIELDS[fieldId].hulls && FIELDS[fieldId].hulls.includes(size));
    if (keptForSize) return keptForSize;
  }
  return open[0] || ids[0];
}

// -------------------------------------------------------------
// getHullRuleText(fieldId)
// The hull rule in words, for screens and tooltips, or "" when
// any hull can go:
//   "small hulls only"            (the Ice moon)
//   "large and capital hulls only" (the deep core)
// -------------------------------------------------------------
export function getHullRuleText(fieldId) {
  const allowed = FIELDS[fieldId].hulls;
  if (!allowed) return "";
  return allowed.join(" and ") + " hulls only";
}

// -------------------------------------------------------------
// getFieldRequirement(fieldId)
// What opens a field, in words, for the screens:
//   "Mining 5"          (outer_belt)
//   "once surveyed"     (ice_moon: a scout has to survey it first)
// -------------------------------------------------------------
export function getFieldRequirement(fieldId) {
  const field = FIELDS[fieldId];
  if (field.survey) return "once surveyed";
  return `Mining ${field.unlockLevel}`;
}


// -------------------------------------------------------------
// getUnlocksAtLevel(skillId, level)
// Which ship types a skill unlocks at exactly this level.
// Returns a list of ship type IDs, e.g. ["excavator"].
// -------------------------------------------------------------
export function getUnlocksAtLevel(skillId, level) {
  // Object.keys gives the list of IDs: ["prospector", "excavator"]
  return Object.keys(SHIP_TYPES).filter((typeId) => {
    const shipType = SHIP_TYPES[typeId];
    return shipType.skill === skillId && shipType.unlockLevel === level;
  });
}


// -------------------------------------------------------------
// getFieldUnlocksAtLevel(level)
// Which mining fields open up at exactly this Mining level.
// Returns a list of field IDs, e.g. ["outer_belt"]. Fields opened
// by a survey aren't listed (a level doesn't open them).
// -------------------------------------------------------------
export function getFieldUnlocksAtLevel(level) {
  return Object.keys(FIELDS).filter((fieldId) => FIELDS[fieldId].unlockLevel === level && !FIELDS[fieldId].survey);
}


// =============================================================
// LEVEL PERKS (the bonus every level gives)
// =============================================================

// -------------------------------------------------------------
// getMiningDrillPerk(state)
// Mining's level perk: drills this much faster, e.g. 0.045 at
// Mining 10 (+4.5%). Level 1 gives nothing; each level after
// adds LEVEL_PERKS.miningDrillPerLevel.
// -------------------------------------------------------------
export function getMiningDrillPerk(state) {
  return LEVEL_PERKS.miningDrillPerLevel * (getLevel(state, "mining") - 1);
}

// -------------------------------------------------------------
// getTradeHubPerk(state)
// Trade's level perk: hub sales pay this much more, e.g. 0.045
// at Trade 10 (+4.5%).
// -------------------------------------------------------------
export function getTradeHubPerk(state) {
  return LEVEL_PERKS.tradeHubPricePerLevel * (getLevel(state, "trade") - 1);
}

// -------------------------------------------------------------
// getLevelPerk(state, skillId, level)
// What EVERY level of a skill gives, for the screen:
//   { perLevel: 0.005, total: 0.045 }   (at level 10)
// "level" defaults to the player's level; the level-up banner
// passes the level just reached. Each skill's perk counts from
// level 1 (level 1 = +0%). The words are SKILLS[skillId].perk.
// -------------------------------------------------------------
export function getLevelPerk(state, skillId, level = getLevel(state, skillId)) {
  const perLevel = {
    mining: LEVEL_PERKS.miningDrillPerLevel,
    trade: LEVEL_PERKS.tradeHubPricePerLevel,
    refining: REFINERY.speedPerLevel,
    manufacturing: WORKSHOP.speedPerLevel,
    exploration: EXPLORATION.scanSpeedPerLevel,
  }[skillId];
  return { perLevel: perLevel, total: perLevel * (level - 1) };
}
