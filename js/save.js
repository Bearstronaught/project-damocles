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

import { RULES, SHIP_TYPES } from "../data/content.js";
import { SAVE_VERSION, createExploration } from "./state.js";
import { createContracts } from "./contracts.js";
import { getTripPlan } from "./jobs.js";
import { advanceTo } from "./simulation.js";
import { createClock } from "./clock.js";

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

  // A save that's badly broken inside could make an upgrade step
  // fail. Treat that the same as damaged text, not a crash.
  try {
    return upgradeSave(state);
  } catch (error) {
    console.warn("Save could not be upgraded:", error);
    return null;
  }
}


// =============================================================
// EXPORT AND IMPORT (backups, and moving between devices)
// =============================================================
//
// An exported save is ONE line of text, like:
//   DAMOCLES:eyJ2ZXJzaW9uIjo1LCJjcmVkaXRzIjo...
//
// The part after "DAMOCLES:" is the save's JSON in "base64":
// a way of writing any text using only letters, numbers, + and /.
// That keeps it on one line (easy to copy and paste), and it
// means nobody edits it by accident. (It's NOT a secret - anyone
// can decode base64 - so it's no protection against cheating.
// For a single-player game, that's fine.)

// The label at the start of every exported save.
const EXPORT_PREFIX = "DAMOCLES:";


// -------------------------------------------------------------
// exportSave(state)
// Turns the game into one line of text for the player to keep.
// -------------------------------------------------------------
export function exportSave(state) {
  state.lastSavedAt = Date.now();
  // (Time away after importing counts from state.simulatedUpTo,
  // which the game loop keeps at "now" while you play.)
  const json = JSON.stringify(state);
  return EXPORT_PREFIX + textToBase64(json);
}


// -------------------------------------------------------------
// importSave(text)
// Reads text the player pasted (or loaded from a file).
// Returns { ok: true, state } or { ok: false, reason: "..." },
// so the screen can say what went wrong. Nothing in the
// current game changes here - the caller decides what to do.
// -------------------------------------------------------------
export function importSave(text) {
  // .trim() removes spaces and line breaks from both ends, which
  // often sneak in when copying and pasting.
  const cleaned = (text || "").trim();

  if (cleaned === "") {
    return { ok: false, reason: "Paste a save first." };
  }

  // Exported saves start with the label. As a fallback, plain
  // JSON (what the browser stores) is accepted too.
  let json;
  if (cleaned.startsWith(EXPORT_PREFIX)) {
    try {
      json = base64ToText(cleaned.slice(EXPORT_PREFIX.length));
    } catch (error) {
      return { ok: false, reason: "That save text is damaged (it may have been cut short when copying)." };
    }
  } else if (cleaned.startsWith("{")) {
    json = cleaned;
  } else {
    return { ok: false, reason: "That doesn't look like a Project Damocles save." };
  }

  // parseSave turns the text into a game and upgrades old versions.
  const state = parseSave(json);
  if (!state) {
    return { ok: false, reason: "That save text is damaged (it may have been cut short when copying)." };
  }

  if (!looksLikeASave(state)) {
    return { ok: false, reason: "That doesn't look like a Project Damocles save." };
  }

  if (state.version > SAVE_VERSION) {
    return { ok: false, reason: "That save is from a newer version of the game." };
  }

  return { ok: true, state: state };
}


// -------------------------------------------------------------
// looksLikeASave(state)
// A quick check that the main parts of a save are there and
// the right kind of thing, so a random bit of JSON can't be
// loaded and break the game.
// -------------------------------------------------------------
function looksLikeASave(state) {
  return (
    typeof state === "object" && state !== null &&
    typeof state.version === "number" &&
    typeof state.credits === "number" &&
    typeof state.inventory === "object" && state.inventory !== null &&
    Array.isArray(state.ships) && state.ships.length > 0 &&
    Array.isArray(state.jobs) &&
    typeof state.skills === "object" && state.skills !== null &&
    typeof state.lastSavedAt === "number" &&
    typeof state.simulatedUpTo === "number" &&
    typeof state.simulatedMs === "number" &&
    typeof state.bonded === "object" && state.bonded !== null &&
    typeof state.upgrades === "object" && state.upgrades !== null &&
    typeof state.carry === "object" && state.carry !== null &&
    typeof state.standingOrders === "object" && state.standingOrders !== null &&
    typeof state.clock === "object" && state.clock !== null &&
    typeof state.clock.speed === "number" &&
    typeof state.clock.realAt === "number" &&
    typeof state.clock.gameAt === "number" &&
    typeof state.shipUpgrades === "object" && state.shipUpgrades !== null &&
    typeof state.exploration === "object" && state.exploration !== null &&
    typeof state.exploration.surveyed === "object" && state.exploration.surveyed !== null &&
    typeof state.milestones === "object" && state.milestones !== null &&
    typeof state.contracts === "object" && state.contracts !== null &&
    Array.isArray(state.contracts.slots) &&
    typeof state.contracts.reputation === "object" && state.contracts.reputation !== null &&
    typeof state.stats === "object" && state.stats !== null
  );
}


// -------------------------------------------------------------
// textToBase64(text) and base64ToText(base64)
// The browser's own btoa/atob only handle plain English letters,
// so the text is first turned into bytes (UTF-8), which copes
// with any character - in case ship names ever get accents.
// -------------------------------------------------------------
function textToBase64(text) {
  const bytes = new TextEncoder().encode(text);   // text -> bytes
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);          // bytes -> a string btoa accepts
  }
  return btoa(binary);
}

function base64ToText(base64) {
  const binary = atob(base64);                    // throws if it isn't base64
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);         // bytes -> text
}


// -------------------------------------------------------------
// upgradeSave(state)
// Brings an old save up to the current format.
//
// Each step upgrades ONE version, so a very old save climbs
// through them all in order: 1 -> 2 -> 3 and so on. When we
// change the save format again, add the next step at the bottom.
// -------------------------------------------------------------
function upgradeSave(state) {
  // --- Version 1 -> 2: skills and the ship-number counter ---
  if (state.version === 1) {
    // Players from version 1 start Mining at 0 XP.
    state.skills = { mining: { xp: 0 } };

    // The next ship's number comes after the ships they own.
    state.nextShipNumber = state.ships.length + 1;

    state.version = 2;
  }

  // --- Version 2 -> 3: three-phase trips timed by ship stats ---
  // Old jobs remember the old 20-second trip length, and a
  // repeating job would keep it forever. Re-time them with the
  // new rules. (The ship's current trip simply starts counting
  // against the new, longer length.)
  if (state.version === 2) {
    for (const job of state.jobs) {
      if (job.type !== "mining") continue;
      const ship = state.ships.find((s) => s.id === job.shipId);
      if (!ship) continue;
      const plan = getTripPlan(state, ship.type, job.fieldId);
      job.outboundMs = plan.outboundMs;
      job.miningMs = plan.miningMs;
      job.returnMs = plan.returnMs;
      job.unloadMs = plan.unloadMs;
      job.durationMs = plan.durationMs;
      job.orePerTrip = plan.orePerTrip;
    }
    state.version = 3;
  }

  // --- Version 3 -> 4: command upgrades and ship destinations ---
  if (state.version === 3) {
    // Nobody had upgrades before they existed.
    state.commandUpgrades = 0;

    // Every ship used to mine the Inner Belt, so start there.
    for (const ship of state.ships) {
      ship.destination = "inner_belt";
    }

    // Older players may already own more ships than the new
    // command cap allows. That's fine: they keep them all, and
    // simply can't buy more until they upgrade or sell one.
    state.version = 4;
  }

  // --- Version 4 -> 5: the Trade skill ---
  if (state.version === 4) {
    // Earlier sales didn't earn XP, so everyone starts Trade at 0.
    state.skills.trade = { xp: 0 };
    state.version = 5;
  }

  // --- Version 5 -> 6: cargo in tonnes, everything x10 ---
  // Cargo and credits were both multiplied by 10 (so a Prospector
  // carries 120 t and costs 15,000 cr). Multiply the player's
  // money and stock by 10 too, so they're worth exactly the same.
  // XP and levels didn't change.
  if (state.version === 5) {
    state.credits *= 10;
    // "|| {}" and "|| []": if a part is missing, use an empty one
    // rather than crashing (the save is checked properly later).
    for (const itemId of Object.keys(state.inventory || {})) {
      state.inventory[itemId] *= 10;
    }
    // Ore on board a freighter mid-run counts too.
    for (const job of state.jobs || []) {
      if (job.type === "haul" && job.cargo) {
        for (const itemId of Object.keys(job.cargo)) {
          job.cargo[itemId] *= 10;
        }
      }
    }
    state.version = 6;
  }

  // --- Version 6 -> 7: the Refining skill ---
  // Nobody has refined anything yet, so Refining starts at 0 XP.
  // (The new metals start at 0 t on their own: the cargo hold
  // treats a missing item as 0.)
  if (state.version === 6) {
    state.skills.refining = { xp: 0 };
    state.version = 7;
  }

  // --- Version 7 -> 8: one simulation clock ---
  // Older saves only knew when they were last SAVED. The game is
  // always played up to the moment it saves, so that's also how
  // far it had been played. The run clock starts at 0.
  if (state.version === 7) {
    state.simulatedUpTo = state.lastSavedAt;
    state.simulatedMs = 0;
    state.version = 8;
  }

  // --- Version 8 -> 9: the Manufacturing skill ---
  // Nobody has manufactured anything yet, so Manufacturing starts
  // at 0 XP. (The new products start at 0 t on their own: the
  // cargo hold treats a missing item as 0.)
  if (state.version === 8) {
    state.skills.manufacturing = { xp: 0 };
    state.version = 9;
  }

  // --- Version 9 -> 10: bonded stock ---
  // Nobody has bonded anything yet.
  if (state.version === 9) {
    state.bonded = {};
    state.version = 10;
  }

  // --- Version 10 -> 11: upgrades and part-tonnes ---
  // Nobody owns any upgrades yet.
  if (state.version === 10) {
    state.upgrades = {};
    state.carry = {};
    state.version = 11;
  }

  // --- Version 11 -> 12: standing orders ---
  if (state.version === 11) {
    state.standingOrders = {};
    state.version = 12;
  }

  // --- Version 12 -> 13: the game clock and the playtest mark ---
  // Older saves ran on real time at 1x, so the game clock starts
  // equal to real time: both anchors at the moment it was last
  // played up to. Nothing has used the playtest tools yet.
  if (state.version === 12) {
    state.clock = createClock(state.simulatedUpTo);
    state.playtest = false;
    state.version = 13;
  }

  // --- Version 13 -> 14: ship upgrades, and loading time ---
  // Nobody owns a ship upgrade yet. Trips already under way were
  // planned before loading time existed, so they get none (0 ms)
  // and finish exactly when they would have. Every trip after
  // that is planned with loading time. A mining trip also now
  // remembers its load: a full hold, as there were no upgrades.
  if (state.version === 13) {
    state.shipUpgrades = {};
    for (const job of state.jobs) {
      if (job.type === "mining") {
        if (job.unloadMs === undefined) job.unloadMs = 0;
        if (job.orePerTrip === undefined) {
          const ship = state.ships.find((s) => s.id === job.shipId);
          job.orePerTrip = SHIP_TYPES[ship.type].cargoCapacity;
        }
      }
      if (job.type === "haul" && job.loadMs === undefined) {
        job.loadMs = 0;
      }
    }
    state.version = 14;
  }

  // --- Version 14 -> 15: Exploration ---
  // Nobody has explored yet. The Pathfinder unlocks once the
  // player has sold ore, which anyone with an older save has
  // already done if they've earned any credits or Mining XP, so
  // they get the milestone straight away.
  if (state.version === 14) {
    state.skills.exploration = { xp: 0 };
    state.exploration = createExploration();
    state.milestones = {};
    if (state.credits > 0 || state.skills.mining.xp > 0 || state.ships.length > 1) {
      state.milestones.firstSale = true;
    }
    state.version = 15;
  }

  // --- Version 15 -> 16: the contracts board ---
  // A fresh board: it posts its first contracts as soon as the
  // player's Mining level allows (straight away for most players).
  // The running totals start at 0: work contracts only count work
  // done after they're posted anyway.
  if (state.version === 15) {
    state.contracts = createContracts();
    state.stats = { mined: {}, refined: {} };
    state.version = 16;
  }

  // --- Version 16 -> 17: reputation per faction ---
  // Reputation was one number (all of it with the belt
  // independents, the only faction then). Now it's a score per
  // faction, and every contract says which faction posted it.
  if (state.version === 16) {
    const points = state.contracts.reputation || 0;
    state.contracts.reputation = { independents: points };
    for (const slot of state.contracts.slots) {
      if (slot.contract) slot.contract.faction = "independents";
    }
    state.version = 17;
  }

  // (Future: if (state.version === 17) { ...; state.version = 18; })

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
// This is no longer special: it's the same advanceTo() the game
// loop calls 4 times a second (see simulation.js), which also
// applies the 24-hour cap and the clock guards. It's kept as its
// own name because "apply offline progress" says what it's FOR.
//
// Returns a summary for the "welcome back" message:
//   { secondsAway, secondsCounted, results }
// -------------------------------------------------------------
export function applyOfflineProgress(state, now) {
  return advanceTo(state, now);
}
