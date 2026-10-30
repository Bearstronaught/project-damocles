// =============================================================
// js/contracts.js
// -------------------------------------------------------------
// THE CONTRACTS BOARD: jobs posted by the belt independents
// (design doc, Contracts board - agreed 30 Oct).
//
// The board has a few SLOTS (3). Each slot holds one contract, or
// is waiting for the next one to be posted. Contracts never fail
// or expire. When one is finished or discarded, its slot gets a
// new contract CONTRACTS.refillMinutes later.
//
// Kinds of contract (CONTRACT_KINDS in content.js):
//   deliver   hand goods over from the hold (a button press)
//   charter   lend a mining ship: its hauls from \
//             one field go to the client        |  these finish by
//   survey    survey one target                 |  themselves, as the
//   deepScan  run some deep scans              /   work gets done
// (Mining and smelting quotas, where you kept the goods, were
// replaced by charters on 30 Oct: Dan felt "you keep the ore"
// didn't work as a story.)
//
// Every contract is posted by a FACTION (CONTRACT_FACTIONS), and
// finishing it pays credits and REPUTATION with that faction.
// Reputation is kept per faction: state.contracts.reputation is
// e.g. { independents: 120 }. A higher tier with a faction makes
// ITS contracts bigger and better paid (REPUTATION_TIERS).
//
// HOW IT STAYS FAIR OFFLINE: contracts are posted and finished
// inside the game's one timeline (jobs.js, processJobs), at the
// moment they're due, and which contract gets posted comes from
// a dice roll fixed for the save (like deep scan finds). So an
// hour away gives exactly the same board as an hour played.
//
// A contract looks like this:
//   {
//     number: 12,                     the 12th contract this save
//     faction: "independents",        who posted it (CONTRACT_FACTIONS)
//     kindId: "mining_quota",         a CONTRACT_KINDS key
//     itemId: "nickel_ore",           what it's about (or null)
//     fieldId: "outer_belt",          mining quotas only (or null)
//     targetId: null,                 survey requests only
//     amount: 280,                    tonnes, surveys or scans
//     baseline: 1200,                 the counter when it was posted:
//                                     progress = counter now - baseline
//     credits: 1340,                  what it pays
//     reputation: 10,                 and the reputation it earns
//     client: "A belt co-op",
//     shipId: "ship-2",               charters only: the ship lent
//                                     (null until the player picks one)
//     delivered: 120,                 charters only: tonnes handed over
//   }
// =============================================================

import { CONTRACT_KINDS, CONTRACT_CLIENTS, CONTRACT_FACTIONS, REPUTATION_TIERS, CONTRACTS, FIELDS, RECIPES, WORKSHOP_RECIPES, ITEMS, SURVEY_TARGETS, SHIP_TYPES } from "../data/content.js";
import { getLevel, isFieldUnlocked, addXp } from "./skills.js";
import { getSellable } from "./bonded.js";
import { isRefineryOpen, isRecipeUnlocked } from "./refinery.js";
import { isWorkshopOpen, isWorkshopRecipeUnlocked } from "./workshop.js";
import { isSurveyed, isExplorationOpen, rollFor } from "./exploration.js";


// -------------------------------------------------------------
// createContracts()
// A fresh board (new games, and old saves upgraded in save.js):
// every slot empty and never posted (readyAt null = post as soon
// as the board opens).
// -------------------------------------------------------------
export function createContracts() {
  const slots = [];
  for (let i = 0; i < CONTRACTS.slots; i++) {
    slots.push({ contract: null, readyAt: null });
  }
  // Reputation starts at 0 with every faction.
  const reputation = {};
  for (const factionId of Object.keys(CONTRACT_FACTIONS)) {
    reputation[factionId] = 0;
  }
  return { slots, posted: 0, completed: 0, reputation };
}

// -------------------------------------------------------------
// isBoardOpen(state)
// The belt independents start posting at a Mining level.
// -------------------------------------------------------------
export function isBoardOpen(state) {
  return getLevel(state, "mining") >= CONTRACTS.openAtMiningLevel;
}


// =============================================================
// REPUTATION
// =============================================================

// -------------------------------------------------------------
// getReputation(state, factionId)
// The player's reputation points with one faction (0 if none yet,
// e.g. a faction added in an update after the save was made).
// -------------------------------------------------------------
export function getReputation(state, factionId) {
  return state.contracts.reputation[factionId] || 0;
}

// -------------------------------------------------------------
// getTier(state, factionId)
// The player's reputation tier with one faction, e.g.
//   { index: 1, name: "Known", from: 100, size: 1.5,
//     next: { name: "Trusted", from: 300, ... } }   (next: null at the top)
// -------------------------------------------------------------
export function getTier(state, factionId) {
  const reputation = getReputation(state, factionId);
  let index = 0;
  REPUTATION_TIERS.forEach((tier, i) => {
    if (reputation >= tier.from) index = i;
  });
  return { index, ...REPUTATION_TIERS[index], next: REPUTATION_TIERS[index + 1] || null };
}


// =============================================================
// WHAT A CONTRACT CAN ASK FOR
// =============================================================

// -------------------------------------------------------------
// getSubjects(state, kindId)
// Everything this kind of contract could be about RIGHT NOW, as a
// list of { itemId, fieldId, targetId } (unused ones null). An
// empty list means the player can't do this kind yet, so it isn't
// posted. Things already on the board are left out (so the board
// doesn't show the same contract twice) unless "allowRepeats" is
// true: early on there may only be one or two things the player
// can do, and an empty board would be worse than a repeat.
// -------------------------------------------------------------
export function getSubjects(state, kindId, allowRepeats = false) {
  const kind = CONTRACT_KINDS[kindId];
  let subjects = [];

  if (kind.kind === "deliver" || kind.kind === "charter") {
    // Goods the player can get: ore from fields they can mine,
    // metal from recipes they have, products likewise.
    if (kind.goods === "ore") {
      for (const [fieldId, field] of Object.entries(FIELDS)) {
        if (isFieldUnlocked(state, fieldId)) {
          // A charter is about one field; a delivery just the ore.
          subjects.push({ itemId: field.yields, fieldId: kind.kind === "charter" ? fieldId : null, targetId: null });
        }
      }
    }
    if (kind.goods === "metal" && isRefineryOpen(state)) {
      for (const recipeId of Object.keys(RECIPES)) {
        if (isRecipeUnlocked(state, recipeId)) {
          subjects.push({ itemId: RECIPES[recipeId].output, fieldId: null, targetId: null });
        }
      }
    }
    if (kind.goods === "product" && isWorkshopOpen(state)) {
      for (const recipeId of Object.keys(WORKSHOP_RECIPES)) {
        if (isWorkshopRecipeUnlocked(state, recipeId)) {
          subjects.push({ itemId: WORKSHOP_RECIPES[recipeId].output, fieldId: null, targetId: null });
        }
      }
    }
  }

  if (kind.kind === "survey" && isExplorationOpen(state)) {
    // Targets not yet surveyed, at most a couple of levels above the
    // player (something to work towards), whose earlier stage is done.
    const reach = getLevel(state, "exploration") + CONTRACTS.surveyLevelsAhead;
    for (const [targetId, target] of Object.entries(SURVEY_TARGETS)) {
      if (!isSurveyed(state, targetId) && target.unlockLevel <= reach &&
          (!target.requires || isSurveyed(state, target.requires))) {
        subjects.push({ itemId: null, fieldId: null, targetId });
      }
    }
  }

  if (kind.kind === "charter" && !state.ships.some((ship) => SHIP_TYPES[ship.type].role === "mining")) {
    subjects = [];   // nothing to lend (every barge sold)
  }

  if (kind.kind === "deepScan") {
    // Only with a scout to run them.
    if (state.ships.some((ship) => SHIP_TYPES[ship.type].role === "scout")) {
      subjects.push({ itemId: null, fieldId: null, targetId: null });
    }
  }

  if (allowRepeats) return subjects;

  // Leave out anything already on the board (same kind and subject).
  const onBoard = state.contracts.slots.map((slot) => slot.contract).filter(Boolean);
  subjects = subjects.filter((subject) => !onBoard.some((c) =>
    c.kindId === kindId && c.itemId === subject.itemId && c.fieldId === subject.fieldId && c.targetId === subject.targetId));
  return subjects;
}


// =============================================================
// POSTING A CONTRACT
// =============================================================

// -------------------------------------------------------------
// postContract(state, slotIndex)
// Puts a new contract in a slot: a kind the player can do, picked
// by its weight, then what it's about, how big, and who's asking.
// Every choice is a dice roll fixed for this save and this
// contract's number (rollFor, from exploration.js), so it always
// comes out the same. Returns a result for the log, or null if
// nothing can be posted yet (the slot then waits, see
// checkContracts).
// -------------------------------------------------------------
export function postContract(state, slotIndex) {
  const board = state.contracts;
  const slot = board.slots[slotIndex];

  // The kinds the player can do now, each with its subjects. New
  // contracts first; if everything the player can do is already on
  // the board, a repeat (it'll differ in size, pay and client).
  let options = getOptions(state, false);
  if (options.length === 0) options = getOptions(state, true);
  if (options.length === 0) {
    return null;
  }
  const totalWeight = options.reduce((sum, option) => sum + CONTRACT_KINDS[option.kindId].weight, 0);

  // A separate stream of rolls from the deep scans' (seed + 7777),
  // and a fresh number for each contract.
  // Who's posting it. Only one faction posts yet, so it's always
  // the first. (A second faction will need a rule here for which
  // one posts each contract: a roll, or one slot each.)
  const factionId = Object.keys(CONTRACT_FACTIONS)[0];

  const seed = (state.exploration.seed + 7777) >>> 0;
  const number = board.posted;
  const roll = (which) => rollFor(seed, number, which);
  board.posted += 1;

  // 1. Which kind: walk along the weights until the roll lands
  let pick = roll(0) * totalWeight;
  let chosen = options[options.length - 1];
  for (const option of options) {
    pick -= CONTRACT_KINDS[option.kindId].weight;
    if (pick < 0) { chosen = option; break; }
  }
  const kind = CONTRACT_KINDS[chosen.kindId];

  // 2. What it's about
  const subject = chosen.subjects[Math.floor(roll(1) * chosen.subjects.length)];

  // 3. How big: 75% to 125% of the kind's amount, times the size
  //    for your tier with the faction posting it
  const scale = getTier(state, factionId).size * (0.75 + 0.5 * roll(2));
  let amount;
  if (kind.kind === "survey") {
    amount = 1;
  } else if (kind.kind === "deepScan") {
    amount = Math.max(1, Math.round(kind.amount * scale));
  } else {
    amount = Math.max(10, Math.round((kind.amount * scale) / 10) * 10);   // whole tens of tonnes
  }

  // 4. What it pays (rounded to 10 cr)
  let credits;
  if (kind.kind === "survey") {
    credits = kind.pay * (SURVEY_TARGETS[subject.targetId].unlockLevel + 4);
  } else if (kind.kind === "deepScan") {
    credits = kind.pay * amount;
  } else {
    credits = amount * ITEMS[subject.itemId].sellPrice * kind.pay;
  }
  credits = Math.round(credits / 10) * 10;

  const contract = {
    number,
    faction: factionId,
    kindId: chosen.kindId,
    itemId: subject.itemId,
    fieldId: subject.fieldId,
    targetId: subject.targetId,
    amount,
    baseline: getCounter(state, chosen.kindId, subject),
    credits,
    reputation: kind.reputation,
    client: CONTRACT_CLIENTS[Math.floor(roll(3) * CONTRACT_CLIENTS.length)],
  };
  if (kind.kind === "charter") {
    contract.shipId = null;      // the player picks a ship on the card
    contract.delivered = 0;
  }
  slot.contract = contract;
  slot.readyAt = null;
  return { kind: "posted", slot: slotIndex, contract, trips: 1, xpGained: 0, newLevels: [] };
}

// The kinds that could be posted, each with its subjects:
//   [{ kindId: "ore_requisition", subjects: [...] }, ...]
function getOptions(state, allowRepeats) {
  const options = [];
  for (const kindId of Object.keys(CONTRACT_KINDS)) {
    const subjects = getSubjects(state, kindId, allowRepeats);
    if (subjects.length > 0) options.push({ kindId, subjects });
  }
  return options;
}

// -------------------------------------------------------------
// getCounter(state, kindId, subject)
// The running total a work contract counts from, e.g. all the
// nickel ore ever brought home from the Outer Belt. Progress is
// this number now minus what it was when the contract was posted.
// (Deliveries, charters and surveys don't count anything: 0.)
// -------------------------------------------------------------
function getCounter(state, kindId, subject) {
  const kind = CONTRACT_KINDS[kindId].kind;
  if (kind === "deepScan") return state.exploration.deepScans;
  return 0;
}


// =============================================================
// PROGRESS AND FINISHING
// =============================================================

// -------------------------------------------------------------
// getProgress(state, contract)
// How far along it is: { have, need }, e.g. { have: 120, need: 280 }.
// For a delivery, "have" is what's in the hold to hand over
// (bonded stock doesn't count: it's never sold).
// -------------------------------------------------------------
export function getProgress(state, contract) {
  const kind = CONTRACT_KINDS[contract.kindId].kind;
  let have;
  if (kind === "deliver") have = getSellable(state, contract.itemId);
  else if (kind === "survey") have = isSurveyed(state, contract.targetId) ? 1 : 0;
  else if (kind === "charter") have = contract.delivered;
  else have = getCounter(state, contract.kindId, contract) - contract.baseline;
  return { have: Math.min(have, contract.amount), need: contract.amount };
}

// -------------------------------------------------------------
// canDeliver(state, slotIndex)
// Can the player hand this delivery over now? { ok, reason }
// -------------------------------------------------------------
export function canDeliver(state, slotIndex) {
  const contract = state.contracts.slots[slotIndex]?.contract;
  if (!contract) return { ok: false, reason: "No contract here." };
  if (CONTRACT_KINDS[contract.kindId].kind !== "deliver") {
    return { ok: false, reason: "This one finishes by itself when the work is done." };
  }
  const have = getSellable(state, contract.itemId);
  if (have < contract.amount) {
    return { ok: false, reason: `Need ${contract.amount - have} t more ${ITEMS[contract.itemId].name.toLowerCase()}.` };
  }
  return { ok: true };
}

// -------------------------------------------------------------
// deliverContract(state, slotIndex, now)
// The player hands a delivery over: the goods leave the hold and
// the contract pays. Returns the result (see completeContract),
// or null if it couldn't be delivered.
// -------------------------------------------------------------
export function deliverContract(state, slotIndex, now) {
  if (!canDeliver(state, slotIndex).ok) return null;
  const contract = state.contracts.slots[slotIndex].contract;
  state.inventory[contract.itemId] -= contract.amount;
  return completeContract(state, slotIndex, now);
}

// -------------------------------------------------------------
// discardContract(state, slotIndex, now)
// The player doesn't want it: it goes, and a new one is posted
// after the usual wait. Returns true if one was discarded.
// -------------------------------------------------------------
export function discardContract(state, slotIndex, now) {
  const slot = state.contracts.slots[slotIndex];
  if (!slot || !slot.contract) return false;
  // A chartered ship is simply free again: hauls already handed
  // over stay handed over (and unpaid), the rest are yours.
  slot.contract = null;
  slot.readyAt = now + CONTRACTS.refillMinutes * 60 * 1000;
  return true;
}

// -------------------------------------------------------------
// completeContract(state, slotIndex, time)
// Pays out a finished contract and starts the wait for the next.
// Returns a result for the log:
//   { kind: "contract", slot, contract, credits, reputation,
//     tierBefore, tierAfter, ... }   (tiers with that contract's faction)
// -------------------------------------------------------------
function completeContract(state, slotIndex, time) {
  const board = state.contracts;
  const slot = board.slots[slotIndex];
  const contract = slot.contract;
  const factionId = contract.faction;
  const tierBefore = getTier(state, factionId).name;

  state.credits += contract.credits;
  board.reputation[factionId] = getReputation(state, factionId) + contract.reputation;
  board.completed += 1;
  // Diplomacy XP: the kind's XP, times the size for your tier with
  // that faction (bigger contracts, more XP). A Diplomacy level
  // can add a slot to the board (see getSlotCount).
  const xp = getContractXp(state, contract);
  const newLevels = addXp(state, "diplomacy", xp);

  slot.contract = null;
  slot.readyAt = time + CONTRACTS.refillMinutes * 60 * 1000;

  return {
    kind: "contract",
    slot: slotIndex,
    contract,
    credits: contract.credits,
    reputation: contract.reputation,
    tierBefore,
    tierAfter: getTier(state, factionId).name,
    trips: 1,
    skillId: "diplomacy",
    xpGained: xp,
    newLevels,
  };
}

// The Diplomacy XP a contract earns when it's finished (see above).
export function getContractXp(state, contract) {
  return CONTRACT_KINDS[contract.kindId].xp * getTier(state, contract.faction).size;
}


// =============================================================
// CHARTERS: lending a mining ship (30 Oct)
// -------------------------------------------------------------
// The player picks one of their mining ships on the contract's
// card. From its NEXT departure the ship works the contract's
// field, and every haul it brings home goes to the client until
// the contract's tonnes are handed over (any extra on the last
// trip goes into your hold). Then the contract pays and the ship
// carries on mining that field as normal. While it's chartered it
// can't be sent elsewhere or sold. Which ship is chartered lives
// only on the contract (contract.shipId), so there's one place
// that says so.
// =============================================================

// -------------------------------------------------------------
// getCharter(state, shipId)
// The charter this ship is lent to, or null.
// -------------------------------------------------------------
export function getCharter(state, shipId) {
  for (const slot of state.contracts.slots) {
    if (slot.contract && slot.contract.shipId === shipId) return slot.contract;
  }
  return null;
}

// -------------------------------------------------------------
// canCharter(state, slotIndex, shipId)
// Can this ship be lent to this charter? { ok, reason }
// -------------------------------------------------------------
export function canCharter(state, slotIndex, shipId) {
  const contract = state.contracts.slots[slotIndex]?.contract;
  if (!contract || CONTRACT_KINDS[contract.kindId].kind !== "charter") {
    return { ok: false, reason: "This isn't a charter." };
  }
  if (contract.shipId) return { ok: false, reason: "A ship is already on this charter." };
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return { ok: false, reason: "Pick a ship." };
  if (SHIP_TYPES[ship.type].role !== "mining") return { ok: false, reason: "Only mining ships can be chartered." };
  if (getCharter(state, shipId)) return { ok: false, reason: `${ship.name} is already on a charter.` };
  return { ok: true };
}

// -------------------------------------------------------------
// charterShip(state, slotIndex, shipId)
// Lends the ship. Its destination becomes the charter's field, so
// a docked ship is ready to go and a working one heads there from
// its next trip (jobs.js, planNextTrip). Returns { ok, reason }.
// -------------------------------------------------------------
export function charterShip(state, slotIndex, shipId) {
  const check = canCharter(state, slotIndex, shipId);
  if (!check.ok) return check;
  const contract = state.contracts.slots[slotIndex].contract;
  contract.shipId = shipId;
  state.ships.find((s) => s.id === shipId).destination = contract.fieldId;
  return { ok: true };
}

// -------------------------------------------------------------
// takeCharterHaul(state, contractNumber, tonnes)
// A chartered ship has docked with "tonnes" of ore. The client
// takes what's still owed; returns how many tonnes they took (the
// rest goes into your hold, in jobs.js). 0 if the charter has gone
// (discarded mid-trip): then it's all yours.
// -------------------------------------------------------------
export function takeCharterHaul(state, contractNumber, tonnes) {
  for (const slot of state.contracts.slots) {
    const contract = slot.contract;
    if (contract && contract.number === contractNumber && contract.shipId) {
      const taken = Math.min(tonnes, contract.amount - contract.delivered);
      contract.delivered += taken;
      return taken;
    }
  }
  return 0;
}


// =============================================================
// HOW MANY SLOTS: the Diplomacy skill (30 Oct)
// -------------------------------------------------------------
// The board starts with CONTRACTS.slots (3), shared by every
// faction. Each Diplomacy level in CONTRACTS.slotLevels adds one.
// =============================================================

export function getSlotCount(state) {
  const level = getLevel(state, "diplomacy");
  return CONTRACTS.slots + CONTRACTS.slotLevels.filter((needed) => level >= needed).length;
}


// =============================================================
// THE BOARD ON THE TIMELINE (called by jobs.js, processJobs)
// =============================================================

// -------------------------------------------------------------
// checkContracts(state, time)
// Runs after every event in the timeline (and once at the start):
//   - work contracts whose work is now done are paid out
//   - slots never posted to (a new board) get a contract now
// Returns a list of results (finished and posted contracts).
// -------------------------------------------------------------
export function checkContracts(state, time) {
  const results = [];
  if (!isBoardOpen(state)) return results;

  // A Diplomacy level may have added a slot: a new, empty one is
  // posted to straight away (below).
  while (state.contracts.slots.length < getSlotCount(state)) {
    state.contracts.slots.push({ contract: null, readyAt: null });
  }

  state.contracts.slots.forEach((slot, index) => {
    const contract = slot.contract;
    if (contract && CONTRACT_KINDS[contract.kindId].kind !== "deliver") {
      const progress = getProgress(state, contract);
      if (progress.have >= progress.need) {
        results.push(completeContract(state, index, time));
      }
    }
  });

  // Empty slots that have never had a contract (readyAt null) are
  // filled at once. (Slots waiting after a finished or discarded
  // contract are posted at their readyAt, by boardEvent below.)
  state.contracts.slots.forEach((slot, index) => {
    if (!slot.contract && slot.readyAt === null) {
      const posted = postContract(state, index);
      if (posted) results.push(posted);
    }
  });
  return results;
}

// -------------------------------------------------------------
// nextBoardEvent(state, now)
// The earliest slot due a new contract at or before "now", as
// { slot, time }, or null. jobs.js plays it at that exact time,
// in order with ships docking and batches finishing.
// -------------------------------------------------------------
export function nextBoardEvent(state, now) {
  if (!isBoardOpen(state)) return null;
  let best = null;
  state.contracts.slots.forEach((slot, index) => {
    if (!slot.contract && slot.readyAt !== null && slot.readyAt <= now &&
        (best === null || slot.readyAt < best.time)) {
      best = { slot: index, time: slot.readyAt };
    }
  });
  return best;
}

// -------------------------------------------------------------
// boardEvent(state, slotIndex)
// A slot's wait is over: post its new contract. If there's nothing
// the player can do yet, the slot is left to post as soon as there
// is (readyAt null, picked up by checkContracts).
// -------------------------------------------------------------
export function boardEvent(state, slotIndex) {
  const posted = postContract(state, slotIndex);
  if (!posted) {
    state.contracts.slots[slotIndex].readyAt = null;
  }
  return posted;
}

// -------------------------------------------------------------
// describeContract(contract)
// The client's request in words, from the kind's text, e.g.
// "A belt co-op needs 150 t of iron ore. Hand it over from your hold."
// "formatTonnes" is passed in from ui.js (so this file has no
// screen code in it).
// -------------------------------------------------------------
export function describeContract(contract, formatTonnes) {
  const kind = CONTRACT_KINDS[contract.kindId];
  const amount = kind.kind === "deepScan" ? String(contract.amount)
    : kind.kind === "survey" ? "1" : formatTonnes(contract.amount);
  return kind.text
    .replace("{client}", contract.client)
    .replace("{amount}", amount)
    .replace("{item}", contract.itemId ? ITEMS[contract.itemId].name.toLowerCase() : "")
    .replace("{field}", contract.fieldId ? FIELDS[contract.fieldId].name : "")
    .replace("{target}", contract.targetId ? SURVEY_TARGETS[contract.targetId].name : "");
}
