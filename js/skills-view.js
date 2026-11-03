// =============================================================
// js/skills-view.js
// -------------------------------------------------------------
// THE SKILLS VIEWSCREEN (Dan, 3 Nov): a bank of gauges at the top
// of the Skills screen, one per skill.
//
//   outer arc    the level, out of 99, in the skill's menu-group
//                colour (Mining amber, Trade teal, Refining and
//                Manufacturing copper, Exploration violet,
//                Diplomacy green)
//   inner arc    progress to the next level
//   dot          lit while something is earning that skill XP
//                right now (a ship on the job, a slot working)
//
// After the gauges, dashed sockets for skills still to come, so
// the player can see the game has more to give.
//
// In the readout column:
//   Next unlock  the unlock expected soonest, with a time worked
//                out from how fast each skill has been earning XP
//                while the game's been open
//   Coming up    the next unlock in each skill
//
// Each gauge is its own small <svg> in an HTML grid, rather than
// one big drawing, so on a phone they wrap into rows of two.
// =============================================================

import { SKILLS } from "../data/content.js";
import { getLevelProgress, XP_TABLE, MAX_LEVEL } from "./skills.js";
import { gameNow } from "./clock.js";
import { formatDuration, formatNumber } from "./ui.js";
import { make, setText } from "./svg.js";

// Each skill's colour: the CSS colour name of its menu group
const SKILL_COLOURS = {
  mining: "var(--amber)",
  trade: "var(--ships)",
  refining: "var(--production)",
  manufacturing: "var(--production)",
  exploration: "var(--expansion)",
  diplomacy: "var(--factions)",
};

// Skills planned for later phases (design doc, Skills table).
// Only names: they show as empty sockets.
const COMING_SKILLS = [
  { name: "Station Building", phase: "Expansion phase" },
  { name: "Combat", phase: "Combat phase" },
  { name: "Research", phase: "Depth phase" },
];


// -------------------------------------------------------------
// GAUGE GEOMETRY
// A gauge is a 270-degree arc, open at the bottom. An SVG circle
// can draw part of itself with "stroke-dasharray": one dash as long
// as the part we want, then a gap longer than the whole circle.
// Turning the circle 135 degrees starts the dash bottom-left.
// -------------------------------------------------------------
const SIZE = 140;                     // each gauge's drawing is 140 x 140
const MIDDLE = SIZE / 2;
const OUTER_R = 56;
const INNER_R = 44;
const SWEEP = 0.75;                   // 270 degrees = three quarters of a circle

// arcLength(radius, fraction): how long the dash must be to fill
// "fraction" (0 to 1) of the gauge
function arcLength(radius, fraction) {
  return 2 * Math.PI * radius * SWEEP * Math.max(0, Math.min(1, fraction));
}

// One arc of a gauge, as a circle drawn partly
function makeArc(svg, radius, className) {
  return make("circle", {
    class: className,
    cx: MIDDLE, cy: MIDDLE, r: radius,
    transform: `rotate(135 ${MIDDLE} ${MIDDLE})`,
    "stroke-dasharray": `0 10000`,
  }, svg);
}

function setArc(arc, radius, fraction) {
  const dash = `${arcLength(radius, fraction).toFixed(1)} 10000`;
  if (arc.getAttribute("stroke-dasharray") !== dash) arc.setAttribute("stroke-dasharray", dash);
}


// -------------------------------------------------------------
// isEarning(state, skillId)
// Is anything earning this skill XP right now? Read from the
// jobs: a barge mining, a freighter hauling, a refinery or
// workshop slot working (not waiting for metal), a scout out.
// Diplomacy XP only comes when a contract is handed in, so it
// never shows as earning.
// -------------------------------------------------------------
export function isEarning(state, skillId) {
  const jobType = {
    mining: "mining",
    trade: "haul",
    refining: "refine",
    manufacturing: "workshop",
    exploration: "scout",
  }[skillId];
  if (!jobType) return false;
  // Refinery and workshop jobs say "working" or "waiting" (for
  // ore or metal); haul jobs "travelling" or "waiting" (at home
  // for a full hold). Mining and scout jobs have no status: if
  // they exist, the ship is out working.
  return state.jobs.some((job) => job.type === jobType && job.status !== "waiting");
}


// -------------------------------------------------------------
// findNextUnlock(state, skillId, unlockLines)
// The next level of a skill that unlocks something, as
// { skillId, level, lines, xpToGo }, or null if none is left.
// "unlockLines(skillId, level)" is main.js's list of what a level
// unlocks (the same words as the level-up banner).
// -------------------------------------------------------------
export function findNextUnlock(state, skillId, unlockLines) {
  const progress = getLevelProgress(state, skillId);
  for (let level = progress.level + 1; level <= MAX_LEVEL; level++) {
    const lines = unlockLines(skillId, level);
    if (lines.length > 0) {
      return { skillId, level, lines, xpToGo: XP_TABLE[level] - progress.xp };
    }
  }
  return null;
}


// -------------------------------------------------------------
// XP RATES
// To guess how long an unlock will take, the view notes each
// skill's XP every 10 seconds of game time and keeps the last 10
// minutes. XP per millisecond = (newest - oldest) / time between.
// Only measured while the game is open, so straight after loading
// there's nothing to go on yet ("measuring").
// -------------------------------------------------------------
const SAMPLE_EVERY = 10 * 1000;
const KEEP_FOR = 10 * 60 * 1000;

function takeSample(samples, state, now) {
  const last = samples[samples.length - 1];
  if (last && now - last.time < SAMPLE_EVERY) return;
  // A clock jump backwards (a loaded save, say): start again
  if (last && now < last.time) samples.length = 0;
  const xp = {};
  for (const skillId of Object.keys(SKILLS)) xp[skillId] = state.skills[skillId].xp;
  samples.push({ time: now, xp });
  while (samples.length > 1 && now - samples[0].time > KEEP_FOR) samples.shift();
}

// XP per millisecond for one skill, or null if not measured yet
function getRate(samples, skillId) {
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (last.time - first.time < 60 * 1000) return null;   // under a minute: too soon to say
  return (last.xp[skillId] - first.xp[skillId]) / (last.time - first.time);
}


// -------------------------------------------------------------
// buildGauges(container)
// Makes one gauge per skill, then the sockets. Gives back the
// parts update() changes, by skill.
// -------------------------------------------------------------
function buildGauges(container) {
  const gauges = {};
  for (const [skillId, skill] of Object.entries(SKILLS)) {
    const box = document.createElement("div");
    box.className = "sv-gauge";
    box.style.setProperty("--skill", SKILL_COLOURS[skillId] || "var(--amber)");

    const svg = make("svg", { viewBox: `0 0 ${SIZE} ${SIZE}`, class: "sv-dial", role: "img" }, box);
    makeArc(svg, OUTER_R, "sv-track");
    makeArc(svg, INNER_R, "sv-track-inner");
    const outer = makeArc(svg, OUTER_R, "sv-level");
    const inner = makeArc(svg, INNER_R, "sv-next");
    const number = make("text", { class: "sv-number", x: MIDDLE, y: MIDDLE + 11, "text-anchor": "middle" }, svg);
    // The earning-now dot, in the gap at the bottom of the arc
    const dot = make("circle", { class: "sv-dot", cx: MIDDLE, cy: MIDDLE + OUTER_R - 2, r: 4 }, svg);

    // Every track starts full length (the unlit part of the gauge)
    setArc(svg.children[0], OUTER_R, 1);
    setArc(svg.children[1], INNER_R, 1);

    const name = document.createElement("span");
    name.className = "sv-name";
    name.textContent = skill.name;
    const note = document.createElement("span");
    note.className = "sv-note";
    box.append(name, note);
    container.appendChild(box);
    gauges[skillId] = { svg, outer, inner, number, dot, note };
  }

  // Sockets for skills still to come
  for (const coming of COMING_SKILLS) {
    const socket = document.createElement("div");
    socket.className = "sv-socket";
    const name = document.createElement("span");
    name.className = "sv-socket-name";
    name.textContent = coming.name;
    const phase = document.createElement("span");
    phase.className = "sv-note";
    phase.textContent = coming.phase;
    socket.append(name, phase);
    container.appendChild(socket);
  }
  return gauges;
}


// -------------------------------------------------------------
// setupSkillsView(getState, unlockLines)
// Starts the gauges. "unlockLines(skillId, level)" comes from
// main.js: what one level unlocks, as short lines.
// -------------------------------------------------------------
export function setupSkillsView(getState, unlockLines) {
  const container = document.getElementById("sv-gauges");
  const screen = document.querySelector('section.screen[data-screen="skills"]');
  if (!container || !screen) return;

  const gauges = buildGauges(container);
  const total = document.getElementById("sv-total");
  const next = {
    skill: document.getElementById("sv-next-skill"),
    name: document.getElementById("sv-next-name"),
    more: document.getElementById("sv-next-more"),
    time: document.getElementById("sv-next-time"),
  };
  const comingList = document.getElementById("sv-coming");
  const samples = [];
  let lastComing = "";      // the list last drawn, to skip redraws
  let lastSlowCheck = 0;    // the unlock search runs once a second, not every frame
  let soonest = null;
  let upcoming = [];

  function frame() {
    requestAnimationFrame(frame);
    const state = getState();
    const now = gameNow(state);
    takeSample(samples, state, now);      // rates are measured even with the page closed
    if (screen.hidden) return;

    // ----- The gauges -----
    let totalLevel = 0;
    for (const [skillId, gauge] of Object.entries(gauges)) {
      const progress = getLevelProgress(state, skillId);
      totalLevel += progress.level;
      setArc(gauge.outer, OUTER_R, progress.level / MAX_LEVEL);
      setArc(gauge.inner, INNER_R, progress.fraction);
      setText(gauge.number, String(progress.level));
      gauge.svg.setAttribute("aria-label", `${SKILLS[skillId].name} level ${progress.level} of ${MAX_LEVEL}`);
      gauge.dot.classList.toggle("is-on", isEarning(state, skillId));
      setText(gauge.note, progress.isMax ? "Maxed"
        : `${Math.floor(progress.fraction * 100)}% to ${progress.level + 1}`);
    }
    setText(total, `Total level ${totalLevel}`);

    // ----- The readouts: worked out once a second -----
    if (Date.now() - lastSlowCheck < 1000) return;
    lastSlowCheck = Date.now();

    // The next unlock in each skill, with a time to it if we can tell
    upcoming = [];
    for (const skillId of Object.keys(SKILLS)) {
      const unlock = findNextUnlock(state, skillId, unlockLines);
      if (!unlock) continue;
      const rate = getRate(samples, skillId);
      unlock.etaMs = rate && rate > 0 ? unlock.xpToGo / rate : null;
      upcoming.push(unlock);
    }
    // Soonest first; unknown times last, nearest level first among them
    upcoming.sort((a, b) => {
      if (a.etaMs !== null && b.etaMs !== null) return a.etaMs - b.etaMs;
      if (a.etaMs !== null) return -1;
      if (b.etaMs !== null) return 1;
      return a.xpToGo - b.xpToGo;
    });
    soonest = upcoming[0] || null;

    // The Next unlock card
    if (soonest) {
      setText(next.skill, `${SKILLS[soonest.skillId].name} ${soonest.level}`);
      setText(next.name, soonest.lines[0]);
      setText(next.more, soonest.lines.length > 1 ? `+ ${soonest.lines.length - 1} more` : "");
      setText(next.time, soonest.etaMs !== null
        ? `About ${formatDuration(soonest.etaMs)} at your current rate`
        : `${formatNumber(Math.ceil(soonest.xpToGo))} XP to go · rate still being measured`);
    } else {
      setText(next.skill, "");
      setText(next.name, "Nothing left to unlock for now");
      setText(next.more, "");
      setText(next.time, "");
    }

    // The Coming up list, rebuilt only when it changes
    const rows = upcoming.map((u) => ({
      text: u.lines[0],
      skill: `${SKILLS[u.skillId].name} ${u.level}`,
      colour: SKILL_COLOURS[u.skillId],
    }));
    const key = JSON.stringify(rows);
    if (key !== lastComing) {
      lastComing = key;
      comingList.innerHTML = "";
      for (const row of rows) {
        const item = document.createElement("li");
        item.className = "sv-coming-row";
        const text = document.createElement("span");
        text.textContent = row.text;
        const skill = document.createElement("span");
        skill.className = "sv-coming-skill";
        skill.style.color = row.colour;
        skill.textContent = row.skill;
        item.append(text, skill);
        comingList.appendChild(item);
      }
    }
  }
  requestAnimationFrame(frame);
}
