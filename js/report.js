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
// If another survey finishes while a report is open (say two
// scouts dock together), it's added to the open report rather
// than stacking a second pop-up on top. Time away works the same
// way: everything surveyed comes in one report.
// =============================================================

// The report on screen now (null when there isn't one), and the
// element that had the keyboard focus before it opened, to give
// the focus back when it closes.
let openReport = null;
let focusBefore = null;


// -------------------------------------------------------------
// showSurveyReport(entries)
// Shows (or adds to) the report. Each entry is one survey:
//   { title: "The wreck: first pass",
//     find:  "Found fragments of an alloy nobody can identify: 2 t wreck alloy",
//     lore:  "A hull, kilometres long, ..." }
// -------------------------------------------------------------
export function showSurveyReport(entries) {
  if (entries.length === 0) return;

  if (!openReport) {
    openReport = buildReport();
    document.body.appendChild(openReport);
    focusBefore = document.activeElement;
    // Keyboard and screen-reader users land on the Close button
    openReport.querySelector("button").focus();
  }

  const body = openReport.querySelector(".report-body");
  for (const entry of entries) {
    body.appendChild(buildEntry(entry));
  }

  // "1 survey" / "3 surveys" in the corner
  const count = body.children.length;
  openReport.querySelector(".panel-tag").textContent = count + (count === 1 ? " survey" : " surveys");
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
  box.querySelector("button").addEventListener("click", closeReport);
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

// Escape closes it too. (Only while one is open.)
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && openReport) {
    closeReport();
  }
});
