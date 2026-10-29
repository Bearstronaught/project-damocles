// =============================================================
// js/playtest.js
// -------------------------------------------------------------
// PLAYTEST TOOLS: the dev panel's cheats.
//
// These are for Dan to test the game quickly: set a skill level,
// add credits or goods, change the game speed (clock.js), jump
// the clock forward. They're hidden behind dev mode (see
// dev-switch.js), and any save that uses one is marked as a
// PLAYTEST save for good, with a badge on screen, so a save
// that was sped up or given free goods is never mistaken for
// a real playthrough (e.g. when timing how long levels take).
//
// Everything here only changes the state; main.js logs it and
// redraws the screen. No browser code, so tests can run it.
// =============================================================

import { ITEMS, SKILLS } from "../data/content.js";
import { XP_TABLE, MAX_LEVEL } from "./skills.js";
import { addItem } from "./state.js";
import { setSpeed, jumpAhead } from "./clock.js";


// One game hour, in ms (for "jump an hour").
export const HOUR_MS = 60 * 60 * 1000;


// -------------------------------------------------------------
// markPlaytest(state)
// Stamps the save as a playtest save. It never comes off (only
// Reset starts an unmarked game).
// -------------------------------------------------------------
export function markPlaytest(state) {
  state.playtest = true;
}


// -------------------------------------------------------------
// devSetLevel(state, skillId, level)
// Sets a skill to the START of a level (its XP becomes exactly
// what that level needs), e.g. Mining 20 = 4,470 XP.
// Works upwards or downwards.
// Returns { ok: true } or { ok: false, reason }.
// -------------------------------------------------------------
export function devSetLevel(state, skillId, level) {
  if (!SKILLS[skillId]) {
    return { ok: false, reason: "There's no such skill." };
  }
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) {
    return { ok: false, reason: `A level is a whole number from 1 to ${MAX_LEVEL}.` };
  }
  state.skills[skillId].xp = XP_TABLE[level];
  markPlaytest(state);
  return { ok: true };
}


// -------------------------------------------------------------
// devAddCredits(state, amount)
// Adds credits (whole numbers above 0 only).
// -------------------------------------------------------------
export function devAddCredits(state, amount) {
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, reason: "Credits to add must be a whole number above 0." };
  }
  state.credits += amount;
  markPlaytest(state);
  return { ok: true };
}


// -------------------------------------------------------------
// devAddGoods(state, itemId, tonnes)
// Puts goods straight into the home hold. The refinery, workshop
// and freighters notice them on the next tick, like any delivery.
// -------------------------------------------------------------
export function devAddGoods(state, itemId, tonnes) {
  if (!ITEMS[itemId]) {
    return { ok: false, reason: "There's no such item." };
  }
  if (!Number.isInteger(tonnes) || tonnes <= 0) {
    return { ok: false, reason: "Tonnes to add must be a whole number above 0." };
  }
  addItem(state, itemId, tonnes);
  markPlaytest(state);
  return { ok: true };
}


// -------------------------------------------------------------
// devSetSpeed(state, speed, realNow)
// Changes the game speed. Going back to 1x doesn't mark the
// save (that's how dev mode switches off); anything faster does.
// -------------------------------------------------------------
export function devSetSpeed(state, speed, realNow = Date.now()) {
  if (!setSpeed(state, speed, realNow)) {
    return { ok: false, reason: "That speed isn't on offer." };
  }
  if (speed !== 1) {
    markPlaytest(state);
  }
  return { ok: true };
}


// -------------------------------------------------------------
// devJumpHour(state)
// Moves the game clock an hour forward. The caller then plays
// the hour out with advanceTo() (main.js).
// -------------------------------------------------------------
export function devJumpHour(state) {
  jumpAhead(state, HOUR_MS);
  markPlaytest(state);
  return { ok: true };
}
