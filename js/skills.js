// =============================================================
// js/skills.js
// -------------------------------------------------------------
// SKILLS: XP, levels, and what each level unlocks.
//
// The state only stores each skill's total XP. The LEVEL is
// always worked out from the XP using XP_TABLE (in content.js).
// Storing just one number means the two can never disagree, and
// if we change the XP table later, everyone's levels update.
// =============================================================

import { XP_TABLE, SHIP_TYPES } from "../data/content.js";

// The highest level in the table (10 at the moment).
export const MAX_LEVEL = XP_TABLE.length - 1;


// -------------------------------------------------------------
// getLevelForXp(xp)
// Turns a total XP number into a level.
// e.g. 0 -> 1,  99 -> 1,  100 -> 2,  260 -> 3
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
  return getLevel(state, shipType.skill) >= shipType.unlockLevel;
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
