// =============================================================
// js/welcome-popup.js
// -------------------------------------------------------------
// THE WELCOME-BACK POP-UP: draws the report after time away
// (agreed 5 Nov). The sums come from welcome-back.js and the
// words from main.js; this file only puts them on screen.
//
// Layout:
//   - a heading, with the time away and the Treasury change
//   - LEFT: "Needs attention" first (amber), then one short
//     line per role that did something
//   - RIGHT: every level-up, with what each level unlocked,
//     in its own scrolling list. Left out if nothing levelled.
//   - Continue (or Escape) closes it
// On a narrow screen (a phone) the two sides stack, summary
// first, and the whole pop-up scrolls as one (style.css).
//
// It looks like the survey report (report.js) and sits at the
// same height above the page, but it is its own pop-up: the
// survey reports wait until this one is closed.
// =============================================================

// The pop-up on screen now (null when there isn't one), what to
// do once it closes, and where the keyboard focus was before.
let openPopup = null;
let afterClose = null;
let focusBefore = null;


// -------------------------------------------------------------
// showWelcomeBack(report)
// report = {
//   title:     "Welcome back, commander",
//   subtitle:  "Away 9h 42m · Treasury +184,300 cr",
//   attention: ["Workshop slot 2 ran out of orders", ...],
//   roles:     [{ name: "Mining", detail: "41 trips · 3.8 kt iron ore" }, ...],
//   levels:    [{ heading: "Mining 21 → 23",
//                 lines: ["22: New ship: Excavator", ...],
//                 perk: "Perk now: +11.5% drill speed" }, ...],
//   onClose:   a function to run after it closes (optional)
// }
// If a pop-up is already open (say, two catch-ups in a row),
// the old one is replaced by the new one.
// -------------------------------------------------------------
export function showWelcomeBack(report) {
  if (openPopup) {
    closePopup();
  }

  openPopup = buildPopup(report);
  afterClose = report.onClose || null;
  focusBefore = document.activeElement;
  document.body.appendChild(openPopup);

  // Keyboard and screen-reader users land on Continue.
  openPopup.querySelector(".welcome-continue").focus();
}


// -------------------------------------------------------------
// buildPopup(report)
// Builds the whole pop-up from separate pieces using
// textContent, never one HTML string with the words inside,
// so nothing in a ship's name can be read as HTML.
// -------------------------------------------------------------
function buildPopup(report) {
  // The dark cover over the page (same style as the survey report)
  const cover = document.createElement("div");
  cover.className = "report-cover";

  // The box in the middle
  const box = document.createElement("div");
  box.className = "panel report-box welcome-box";
  box.setAttribute("role", "dialog");          // a pop-up...
  box.setAttribute("aria-modal", "true");      // ...that sits over the page
  box.setAttribute("aria-labelledby", "welcome-title");

  // --- Heading: title, and time away + Treasury underneath ---
  const head = make("div", "panel-head welcome-head");
  const title = make("h2", "panel-title", report.title);
  title.id = "welcome-title";
  const subtitle = make("p", "welcome-subtitle", report.subtitle);
  head.append(title, subtitle);

  // --- The two sides ---
  const columns = make("div", "welcome-columns");
  columns.appendChild(buildSummarySide(report));

  // The level-ups side only when something levelled up
  // (agreed 5 Nov: with no level-ups, it's left out).
  if (report.levels.length > 0) {
    columns.appendChild(buildLevelsSide(report.levels));
  } else {
    columns.classList.add("single");   // one column, full width
  }

  // --- Continue ---
  const button = make("button", "btn btn-primary report-close welcome-continue", "Continue");
  button.addEventListener("click", closePopup);

  box.append(head, columns, button);
  cover.appendChild(box);
  return cover;
}


// -------------------------------------------------------------
// buildSummarySide(report)
// The left side: Needs attention, then one line per role.
// -------------------------------------------------------------
function buildSummarySide(report) {
  const side = make("div", "welcome-summary");

  // Needs attention comes first, in amber (Dan, 5 Nov:
  // "should be the priority at the top").
  if (report.attention.length > 0) {
    const box = make("div", "welcome-attention");
    box.appendChild(make("h3", "welcome-attention-title", "Needs attention"));
    const list = make("ul", "welcome-attention-list");
    for (const line of report.attention) {
      list.appendChild(make("li", "", line));
    }
    box.appendChild(list);
    side.appendChild(box);
  }

  // One short block per role that did something
  for (const role of report.roles) {
    const block = make("div", "welcome-role");
    block.append(
      make("h3", "welcome-role-name", role.name),
      make("p", "welcome-role-detail", role.detail),
    );
    side.appendChild(block);
  }

  // Nothing at all happened (a quiet early save, everything docked)
  if (report.roles.length === 0) {
    side.appendChild(make("p", "welcome-role-detail", "Nothing finished while you were away."));
  }

  return side;
}


// -------------------------------------------------------------
// buildLevelsSide(levels)
// The right side: a scrolling list of each skill's level-ups,
// every level's unlocks, and the perk the skill is at now.
// -------------------------------------------------------------
function buildLevelsSide(levels) {
  const side = make("div", "welcome-levels");
  side.appendChild(make("h3", "welcome-levels-title", "Level-ups"));

  for (const skill of levels) {
    const block = make("div", "welcome-level");
    block.appendChild(make("p", "welcome-level-heading", skill.heading));

    // Each unlock on its own line, e.g. "22: New ship: Excavator"
    for (const line of skill.lines) {
      block.appendChild(make("p", "welcome-level-line", line));
    }
    // The perk at the level reached, quieter
    block.appendChild(make("p", "welcome-level-perk", skill.perk));

    side.appendChild(block);
  }
  return side;
}


// -------------------------------------------------------------
// closePopup()
// Takes the pop-up away, gives the focus back, then runs
// whatever was waiting (the survey reports). That runs a moment
// later, so the same Escape press can't also close the report
// that opens next.
// -------------------------------------------------------------
function closePopup() {
  if (!openPopup) return;
  openPopup.remove();
  openPopup = null;

  if (focusBefore && focusBefore.focus) focusBefore.focus();
  focusBefore = null;

  const next = afterClose;
  afterClose = null;
  if (next) setTimeout(next, 0);
}

// Escape closes it too (only while it's open).
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && openPopup) {
    closePopup();
  }
});


// -------------------------------------------------------------
// make(tag, className, text)
// A small helper: one element, with a class and some text.
// -------------------------------------------------------------
function make(tag, className, text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}
