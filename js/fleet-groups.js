// =============================================================
// js/fleet-groups.js
// -------------------------------------------------------------
// SORTING THE FLEET INTO ROLE GROUPS for the Command screen.
//
// The Command screen shows ships under one heading per role
// (Mining, Freight...). Each heading has a one-line summary,
// like "3 ships · 2 working, 1 docked", that still shows when
// the group is collapsed, so a closed group can't hide a ship
// that needs you.
//
// This file only works things out - it never touches the page.
// That keeps it testable without a browser (see the tests).
// =============================================================

import { ROLES, SHIP_TYPES } from "../data/content.js";
import { getJobForShip, getJobPhase } from "./jobs.js";


// -------------------------------------------------------------
// getShipActivity(state, ship, now)
// One word for what a ship is doing right now:
//   "working"   out on a trip (mining or a hub run)
//   "recalled"  told to come home, still flying back
//   "waiting"   a freighter at the dock waiting for ore to load
//   "docked"    no orders at all - this is the one that needs
//               the player
// -------------------------------------------------------------
export function getShipActivity(state, ship, now) {
  const job = getJobForShip(state, ship.id);

  if (!job) {
    return "docked";
  }
  if (job.recall) {
    return "recalled";
  }
  if (getJobPhase(job, now).phase === "waiting") {
    return "waiting";
  }
  return "working";
}


// -------------------------------------------------------------
// getRoleGroups(state, now)
// The player's ships, sorted into role groups.
// Returns a list like:
//   [
//     { roleId: "mining", name: "Mining", ships: [...],
//       counts: { working: 2, recalled: 0, waiting: 0, docked: 1 } },
//     { roleId: "freight", ... },
//   ]
// Groups come in the order ROLES lists them, and a role with no
// ships is left out (an empty "Freight" heading would just be
// clutter). Ships inside a group keep the order they were bought.
// -------------------------------------------------------------
export function getRoleGroups(state, now) {
  const groups = [];

  for (const [roleId, role] of Object.entries(ROLES)) {
    // .filter keeps only the ships whose type has this role
    const ships = state.ships.filter((ship) => SHIP_TYPES[ship.type].role === roleId);
    if (ships.length === 0) {
      continue;
    }

    // Count how many ships are doing each thing.
    const counts = { working: 0, recalled: 0, waiting: 0, docked: 0 };
    for (const ship of ships) {
      counts[getShipActivity(state, ship, now)] += 1;
    }

    groups.push({ roleId, name: role.name, ships, counts });
  }

  return groups;
}


// -------------------------------------------------------------
// describeGroup(group)
// The summary text for a group's heading, e.g.
//   "3 ships · 2 working, 1 docked"
//   "1 ship · 1 waiting for ore"
// Only the activities with at least one ship are mentioned, in
// a fixed order so the line doesn't jump about.
// (The role name itself, "Mining", is shown separately.)
// -------------------------------------------------------------
const ACTIVITY_WORDS = [
  ["working", "working"],
  ["recalled", "heading home"],
  ["waiting", "waiting for ore"],
  ["docked", "docked"],
];

export function describeGroup(group) {
  const total = group.ships.length;
  const shipWord = total === 1 ? "ship" : "ships";

  const parts = [];
  for (const [activity, words] of ACTIVITY_WORDS) {
    const count = group.counts[activity];
    if (count > 0) {
      parts.push(`${count} ${words}`);
    }
  }

  return `${total} ${shipWord} · ${parts.join(", ")}`;
}
