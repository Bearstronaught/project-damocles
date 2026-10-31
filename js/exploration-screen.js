// =============================================================
// js/exploration-screen.js
// -------------------------------------------------------------
// THE EXPLORATION SCREEN: what's been surveyed, what's next,
// the story of the wreck so far, and the deep scans.
//
// Like ui.js, it's built once (buildExplorationScreen) and then
// its words are updated 4 times a second (renderExploration),
// only where something changed. The rules themselves live in
// exploration.js; this file only shows them.
//
// Surveys are LAUNCHED here, one button per target (Dan, 31 Oct):
// left alone, scouts deep scan. Scouts can still be sent out from
// their cards on the Command screen, like every other ship.
// =============================================================

import { SURVEY_TARGETS, DEEP_SCAN, ITEMS, SHIP_TYPES } from "../data/content.js";
import { getTargetStatus, getScoutPlan, getSurveyCount, DEEP_SCAN_ID, isExplorationOpen, isLaunched, getScoutOnTarget } from "./exploration.js";
import { getLevel } from "./skills.js";
import { formatNumber, formatTonnes, formatDuration, formatXp, formatPercent } from "./ui.js";

// The wreck's stages, in order (their IDs start "wreck_").
const WRECK_STAGES = Object.keys(SURVEY_TARGETS).filter((id) => id.startsWith("wreck_"));


// Shortcut: find an element on the page by its id="..." name.
function byId(id) {
  return document.getElementById(id);
}

// Changes an element's text or HTML only when it's different.
function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}
function setHtml(element, html) {
  if (element.innerHTML !== html) element.innerHTML = html;
}


// -------------------------------------------------------------
// describeFind(find)
// A find's reward in a few words, e.g. "400 cr",
// "100 t nickel ore", or "2 t wreck alloy + 500 cr".
// "find" is anything with credits, item and tonnes (a target's
// numbers, or a find from exploration.js).
// -------------------------------------------------------------
export function describeFind(find) {
  const parts = [];
  if (find.item && find.tonnes > 0) {
    parts.push(`${formatTonnes(find.tonnes)} ${ITEMS[find.item].name.toLowerCase()}`);
  }
  if (find.credits > 0) {
    parts.push(`${formatNumber(find.credits)} cr`);
  }
  return parts.join(" + ");
}


// =============================================================
// BUILD (once)
// =============================================================

// -------------------------------------------------------------
// buildExplorationScreen(actions)
// One row per survey target, one line per wreck stage. Their
// words are filled in by renderExploration. Each target row has
// a button: Launch survey, or Cancel while it waits for a scout
// (renderExploration says which, and hides it when neither fits).
// -------------------------------------------------------------
export function buildExplorationScreen(actions) {
  const list = byId("target-list");
  list.innerHTML = "";
  for (const targetId of Object.keys(SURVEY_TARGETS)) {
    const row = document.createElement("li");
    row.className = "target-row";
    row.id = "target-" + targetId;
    row.innerHTML = `
      <div class="target-head">
        <span class="target-name">${SURVEY_TARGETS[targetId].name}</span>
        <span class="target-state" data-part="state"></span>
      </div>
      <div class="target-meta" data-part="meta"></div>
      <p class="target-text" data-part="text"></p>
      <button class="btn btn-small target-launch" data-part="launch" hidden></button>
    `;
    // The button's job is written on it as data-mode ("launch" or
    // "cancel") each time the screen is drawn, so one click handler
    // does whichever it currently says.
    const button = row.querySelector("[data-part=launch]");
    button.addEventListener("click", () => {
      // Read the mode ONCE, before acting: launching redraws the
      // screen straight away, which turns this same button into
      // Cancel, and a second check would then cancel it again.
      const mode = button.dataset.mode;
      if (mode === "launch") actions.launchSurvey(targetId);
      else if (mode === "cancel") actions.cancelSurvey(targetId);
    });
    list.appendChild(row);
  }

  const wreck = byId("wreck-list");
  wreck.innerHTML = "";
  WRECK_STAGES.forEach((targetId, index) => {
    const line = document.createElement("li");
    line.className = "wreck-stage";
    line.id = "wreck-" + targetId;
    line.innerHTML = `
      <span class="wreck-step">${index + 1}</span>
      <p class="wreck-text" data-part="text"></p>
    `;
    wreck.appendChild(line);
  });
}


// =============================================================
// RENDER (4 times a second)
// =============================================================

// -------------------------------------------------------------
// renderExploration(state)
// Updates the whole screen. Returns what the Exploration tab's
// nav dot is about: surveys ready to launch, e.g.
//   { "target:ice_moon": 1 }
// (ui.js's screenAlert lights the dot until the tab is visited.)
// -------------------------------------------------------------
export function renderExploration(state) {
  const ready = {};
  if (!isExplorationOpen(state)) {
    return ready;   // the tab is hidden until the first sale
  }

  const hasScout = state.ships.some((ship) => SHIP_TYPES[ship.type].role === "scout");
  // Trip times are worked out for a Pathfinder (the only scout so far).
  const scoutType = "pathfinder";

  // --- The survey targets ---
  for (const [targetId, target] of Object.entries(SURVEY_TARGETS)) {
    const row = byId("target-" + targetId);
    const status = getTargetStatus(state, targetId);
    const plan = getScoutPlan(state, scoutType, targetId);
    const scout = getScoutOnTarget(state, targetId);   // a scout on its way, or null
    const launched = isLaunched(state, targetId);

    // The state on the right of the name
    let stateText;
    if (status === "surveyed") stateText = "Surveyed";
    else if (scout) stateText = `${scout.name} on the way`;
    else if (launched) stateText = "Launched: next scout";
    else if (status === "locked") stateText = `Exploration ${target.unlockLevel}`;
    else if (status === "needs") stateText = `After ${SURVEY_TARGETS[target.requires].name}`;
    else stateText = "Ready to launch";
    setText(row.querySelector("[data-part=state]"), stateText);

    // The button: Launch survey when it's ready, Cancel while it
    // waits for a scout, hidden otherwise. Without a scout yet,
    // launching still works: the first one bought will go there.
    const button = row.querySelector("[data-part=launch]");
    let mode = "";
    if (status === "available" && !scout) mode = launched ? "cancel" : "launch";
    button.hidden = mode === "";
    button.dataset.mode = mode;
    setText(button, mode === "cancel" ? "Cancel" : "Launch survey");
    button.classList.toggle("btn-primary", mode === "launch");

    // Trip length, XP and what it pays (the pay shows once it's
    // been found; before that, only that something's there).
    const meta = status === "surveyed"
      ? `Found: ${describeFind(target)}`
      : `${formatDuration(plan.durationMs)} trip · ${formatXp(target.xp)} XP`;
    setText(row.querySelector("[data-part=meta]"), meta);

    // The words: what it is, or what was found and its lore.
    const text = status === "surveyed"
      ? `<span class="target-find">Found ${target.find}.</span> <span class="lore">${target.lore}</span>`
      : (status === "locked" ? "" : target.description);
    setHtml(row.querySelector("[data-part=text]"), text);

    // Classes for the look: surveyed (done), locked, active
    row.classList.toggle("surveyed", status === "surveyed");
    row.classList.toggle("locked", status === "locked" || status === "needs");
    row.classList.toggle("active", Boolean(scout));
    row.classList.toggle("launched", launched && !scout);

    // The tab's dot: a survey ready to launch that hasn't been
    // launched yet.
    if (status === "available" && !launched && !scout) {
      ready["target:" + targetId] = 1;
    }
  }

  const count = getSurveyCount(state);
  setText(byId("explore-tag"), `${count.done} of ${count.total} surveyed`);
  byId("explore-note").hidden = hasScout;

  // --- The wreck's story so far ---
  let stagesDone = 0;
  for (const targetId of WRECK_STAGES) {
    const line = byId("wreck-" + targetId);
    const target = SURVEY_TARGETS[targetId];
    const done = getTargetStatus(state, targetId) === "surveyed";
    if (done) stagesDone++;
    line.classList.toggle("done", done);
    setText(line.querySelector("[data-part=text]"), done
      ? target.lore
      : `Not yet surveyed. ${target.name} needs Exploration ${target.unlockLevel}.`);
  }
  setText(byId("wreck-tag"), `${stagesDone} of ${WRECK_STAGES.length} stages`);

  // --- Deep scans ---
  const deepPlan = getScoutPlan(state, scoutType, DEEP_SCAN_ID);
  const explore = state.exploration;
  const scanning = state.jobs.filter((job) => job.type === "scout" && job.targetId === DEEP_SCAN_ID).length;
  setHtml(byId("deep-stats"), `
    <dt>Trip</dt>      <dd>${formatDuration(deepPlan.durationMs)} · ${formatXp(DEEP_SCAN.xp)} XP</dd>
    <dt>Finds</dt>     <dd>About ${formatPercent(DEEP_SCAN.findChance)} of scans</dd>
    <dt>Run so far</dt><dd>${formatNumber(explore.deepScans)} scans · ${formatNumber(explore.deepFinds)} finds</dd>
    <dt>Scanning</dt>  <dd>${scanning === 0 ? "No scouts" : scanning + (scanning === 1 ? " scout" : " scouts")}</dd>
  `);

  // The level perk, under the targets
  setText(byId("explore-level"), `Exploration ${getLevel(state, "exploration")}`);

  return ready;
}
