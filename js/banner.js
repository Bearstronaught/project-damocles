// =============================================================
// js/banner.js
// -------------------------------------------------------------
// LEVEL-UP BANNERS: "MINING LEVEL 5" slides down from the top
// of the screen for about 3 seconds, with anything it unlocked
// listed underneath.
//
// Rules (from the design doc):
//   - it never blocks the game (it floats over the page)
//   - clicking it dismisses it early
//   - several level-ups queue up and show one after another
//   - the log line is still written as before (main.js does that)
//   - with "reduced motion" turned on, it fades instead of
//     sliding (handled in css/style.css)
// =============================================================

const SHOW_MS = 3000;   // how long each banner stays on screen
const MOVE_MS = 350;    // how long it takes to slide in or out
                        // (matches the transition in style.css)

// Banners waiting their turn. Each one is
//   { title: "Mining level 5", unlocks: ["New ship: ..."] }
const queue = [];

// Is a banner on screen right now?
let showing = false;


// -------------------------------------------------------------
// showLevelBanner(title, unlocks)
// Adds a banner to the queue. If nothing is showing, it
// appears straight away; otherwise it waits its turn.
//   title    e.g. "Mining level 5"
//   unlocks  a list of lines, e.g. ["New field: Outer Belt"]
//            (an empty list is fine)
// -------------------------------------------------------------
export function showLevelBanner(title, unlocks = []) {
  queue.push({ title, unlocks });
  if (!showing) {
    showNext();
  }
}


// -------------------------------------------------------------
// showNext()
// Takes the next banner off the queue and runs it:
// slide in -> wait -> slide out -> remove -> next one.
// -------------------------------------------------------------
function showNext() {
  // .shift() takes the FIRST item off the list (oldest first).
  const next = queue.shift();
  if (!next) {
    showing = false;   // queue empty: we're done
    return;
  }
  showing = true;

  const banner = makeBanner(next);
  getBannerArea().appendChild(banner);

  // Wait one frame before adding "shown", so the browser has
  // drawn the banner in its starting spot (above the screen).
  // Otherwise it would appear in place with no slide.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => banner.classList.add("shown"));
  });

  // Put the banner away, then move on to the next one.
  // "finished" makes sure this only happens once, even if the
  // player clicks just as the timer runs out.
  let finished = false;
  function dismiss() {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    banner.classList.remove("shown");          // slide (or fade) out
    setTimeout(() => {
      banner.remove();                          // take it off the page
      showNext();
    }, MOVE_MS);
  }

  const timer = setTimeout(dismiss, SHOW_MS + MOVE_MS);
  banner.addEventListener("click", dismiss);
}


// -------------------------------------------------------------
// makeBanner({ title, unlocks })
// Builds the banner's HTML element (not yet on the page).
// Built from separate pieces with textContent, never as one
// HTML string, so text can never be read as HTML.
// -------------------------------------------------------------
function makeBanner({ title, unlocks }) {
  const banner = document.createElement("div");
  banner.className = "level-banner";
  // Tells screen readers to read it out when it appears,
  // without interrupting what they're already saying.
  banner.setAttribute("role", "status");
  banner.title = "Click to dismiss";

  const kicker = document.createElement("div");
  kicker.className = "level-banner-kicker";
  kicker.textContent = "Level up";

  const heading = document.createElement("div");
  heading.className = "level-banner-title";
  heading.textContent = title;

  banner.append(kicker, heading);

  if (unlocks.length > 0) {
    const list = document.createElement("ul");
    list.className = "level-banner-unlocks";
    for (const line of unlocks) {
      const item = document.createElement("li");
      item.textContent = line;
      list.appendChild(item);
    }
    banner.appendChild(list);
  }

  return banner;
}


// -------------------------------------------------------------
// getBannerArea()
// The invisible strip across the top of the screen that holds
// banners. Made the first time it's needed.
// -------------------------------------------------------------
function getBannerArea() {
  let area = document.getElementById("level-banner-area");
  if (!area) {
    area = document.createElement("div");
    area.id = "level-banner-area";
    area.className = "level-banner-area";
    document.body.appendChild(area);
  }
  return area;
}
