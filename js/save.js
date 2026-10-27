// =============================================================
// js/save.js
// -------------------------------------------------------------
// SAVING, LOADING AND OFFLINE PROGRESS.
//
// The game state is turned into text (JSON) and stored in the
// browser's "localStorage" - a small notepad each website gets.
// It survives closing the tab or restarting the computer, but
// lives only in THIS browser on THIS device.
// =============================================================

import { RULES } from "../data/content.js";
import { SAVE_VERSION } from "./state.js";
import { processJobs } from "./jobs.js";

// The label our save is stored under in localStorage.
const SAVE_KEY = "project-damocles-save";


// -------------------------------------------------------------
// saveGame(state)
// Writes the state into the browser's storage.
// -------------------------------------------------------------
export function saveGame(state) {
  state.lastSavedAt = Date.now();
  const text = JSON.stringify(state);   // object -> text

  // "try" means: attempt this, and if it fails, don't crash
  // the game - run the "catch" part instead. Storage can fail
  // in private browsing or if the browser blocks it.
  try {
    localStorage.setItem(SAVE_KEY, text);
  } catch (error) {
    console.warn("Could not save the game:", error);
  }
}


// -------------------------------------------------------------
// loadGame()
// Reads the save from storage. Returns the state, or null if
// there's no save (or it's broken).
// -------------------------------------------------------------
export function loadGame() {
  let text = null;
  try {
    text = localStorage.getItem(SAVE_KEY);
  } catch (error) {
    console.warn("Could not read the save:", error);
  }

  if (!text) {
    return null;   // no save yet - the caller starts a new game
  }

  return parseSave(text);
}


// -------------------------------------------------------------
// deleteSave()
// Wipes the save (used by the "Reset" button).
// -------------------------------------------------------------
export function deleteSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch (error) {
    console.warn("Could not delete the save:", error);
  }
}


// -------------------------------------------------------------
// parseSave(text)
// Turns save text back into a state object, upgrading old
// versions if needed. Returns null if the text is broken.
// (Kept separate from loadGame so it can be tested without a
// browser, and reused later for "import save".)
// -------------------------------------------------------------
export function parseSave(text) {
  let state;
  try {
    state = JSON.parse(text);   // text -> object
  } catch (error) {
    console.warn("Save was not valid, starting fresh:", error);
    return null;
  }

  return upgradeSave(state);
}


// -------------------------------------------------------------
// upgradeSave(state)
// Brings an old save up to the current format.
// There's only version 1 so far, so nothing to do yet. When we
// change the format, a step like this goes here:
//
//   if (state.version === 1) {
//     state.newThing = 0;   // add whatever v2 needs
//     state.version = 2;
//   }
//
// Each step upgrades one version, so a very old save climbs
// through them all in order.
// -------------------------------------------------------------
function upgradeSave(state) {
  if (state.version > SAVE_VERSION) {
    // A save from a NEWER version of the game than this one.
    console.warn("Save is from a newer version of the game.");
  }
  return state;
}


// -------------------------------------------------------------
// applyOfflineProgress(state, now)
// Catches the game up on time spent away.
//
// The 24-hour cap: if the player was away longer, only 24 hours
// count. We process jobs up to (last save + 24h), then slide
// every job's start time forward by the extra time, so the
// ships carry on from "now" rather than having a huge backlog.
//
// Returns a summary for the "welcome back" message:
//   { secondsAway, secondsCounted, results }
// -------------------------------------------------------------
export function applyOfflineProgress(state, now) {
  const awayMs = now - state.lastSavedAt;
  const capMs = RULES.offlineCapHours * 60 * 60 * 1000;   // hours -> ms

  // Count whichever is smaller: actual time away, or the cap.
  const countedMs = Math.min(awayMs, capMs);
  const countUpTo = state.lastSavedAt + countedMs;

  // Same function the game uses every tick - just with a
  // bigger jump in time.
  const results = processJobs(state, countUpTo);

  // Time beyond the cap is skipped: push jobs forward by it.
  const skippedMs = awayMs - countedMs;
  if (skippedMs > 0) {
    for (const job of state.jobs) {
      job.startedAt += skippedMs;
    }
  }

  return {
    secondsAway: Math.floor(awayMs / 1000),
    secondsCounted: Math.floor(countedMs / 1000),
    results: results,
  };
}
