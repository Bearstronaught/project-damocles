// =============================================================
// js/report.js
// -------------------------------------------------------------
// THE SURVEY REPORT: a pop-up that shows what a scout found and
// its line of lore, and stays until the player closes it
// (Dan, 30 Oct: the lore was easy to miss in the log).
//
// Unlike the level-up banners, which slide away by themselves,
// this one needs dismissing: the Close button, or Escape.
// The game keeps running underneath; it only covers the screen.
//
// Every survey gets its OWN report, never merged (Dan, 31 Oct).
// If several are waiting (two scouts docked together, or time
// away), they wait in a queue and show one after another: the
// button reads "Next" until the last one, which reads "Close".
// =============================================================

// The report on screen now (null when there isn't one), and the
// element that had the keyboard focus before it opened, to give
// the focus back when it closes.
let openReport = null;
let focusBefore = null;

// Surveys waiting their turn, oldest first, and how many have
// been shown in this run of reports (for the "2 of 3" tag).
const waiting = [];
let shownCount = 0;


// -------------------------------------------------------------
// showSurveyReport(entries)
// Queues one report per survey. Each entry is one survey:
//   { title: "The wreck: first pass",
//     find:  "Found fragments of an alloy nobody can identify: 2 t wreck alloy",
//     lore:  "A hull, kilometres long, ..." }
// If no report is open, the first one shows straight away.
// -------------------------------------------------------------
export function showSurveyReport(entries) {
  if (entries.length === 0) return;
  waiting.push(...entries);

  if (!openReport) {
    openReport = buildReport();
    document.body.appendChild(openReport);
    focusBefore = document.activeElement;
    shownCount = 0;
    showNextEntry();
    // Keyboard and screen-reader users land on the button
    openReport.querySelector("button").focus();
  } else {
    updateCounter();   // the open one now says "1 of 3", "Next"
  }
}

// -------------------------------------------------------------
// showNextEntry()
// Swaps the open report's contents for the next survey waiting.
// -------------------------------------------------------------
function showNextEntry() {
  const body = openReport.querySelector(".report-body");
  body.replaceChildren(buildEntry(waiting.shift()));
  shownCount += 1;
  updateCounter();
}

// -------------------------------------------------------------
// updateCounter()
// The tag in the corner ("Survey report", or "2 of 3" when several
// are waiting) and the button ("Next" while more are waiting).
// -------------------------------------------------------------
function updateCounter() {
  const total = shownCount + waiting.length;
  openReport.querySelector(".panel-tag").textContent = total === 1 ? "1 survey" : `${shownCount} of ${total}`;
  openReport.querySelector("button").textContent = waiting.length > 0 ? "Next" : "Close";
}


// -------------------------------------------------------------
// buildReport()
// The empty pop-up: a dark cover over the page, and a panel in
// the middle with a heading, room for entries, and Close.
// Built from separate pieces with textContent (never one HTML
// string with the words in), so text can't be read as HTML.
// -------------------------------------------------------------
function buildReport() {
  const cover = document.createElement("div");
  cover.className = "report-cover";

  const box = document.createElement("div");
  box.className = "panel report-box";
  // role="dialog" + aria-modal tell screen readers this is a
  // pop-up that has to be dealt with before the page behind it.
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-labelledby", "report-title");
  box.innerHTML = `
    <div class="panel-head">
      <h2 class="panel-title" id="report-title">Survey report</h2>
      <span class="panel-tag"></span>
    </div>
    <div class="report-body"></div>
    <button class="btn btn-primary report-close">Close</button>
  `;
  box.querySelector("button").addEventListener("click", nextOrClose);
  cover.appendChild(box);
  return cover;
}

// One survey's section: its name, what was found, and the lore.
function buildEntry({ title, find, lore }) {
  const section = document.createElement("section");
  section.className = "report-entry";

  const heading = document.createElement("h3");
  heading.className = "report-target";
  heading.textContent = title;

  const findLine = document.createElement("p");
  findLine.className = "report-find";
  findLine.textContent = find;

  const loreLine = document.createElement("p");
  loreLine.className = "report-lore";
  loreLine.textContent = lore;

  section.append(heading, findLine, loreLine);
  return section;
}


// -------------------------------------------------------------
// nextOrClose()
// The button (and Escape): the next survey if one is waiting,
// otherwise close the pop-up.
// -------------------------------------------------------------
function nextOrClose() {
  if (waiting.length > 0) {
    showNextEntry();
  } else {
    closeReport();
  }
}

// -------------------------------------------------------------
// closeReport()
// Takes the pop-up away and gives the keyboard focus back.
// -------------------------------------------------------------
function closeReport() {
  if (!openReport) return;
  openReport.remove();
  openReport = null;
  if (focusBefore && focusBefore.focus) focusBefore.focus();
  focusBefore = null;
}

// Escape does the same as the button: next survey, or close.
// (Only while one is open.)
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && openReport) {
    nextOrClose();
  }
});
