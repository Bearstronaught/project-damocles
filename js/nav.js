// =============================================================
// js/nav.js
// -------------------------------------------------------------
// THE MAIN MENU: switching screens, the sidebar, the phone bar
// and its drawer, and the dots that say "something new here".
//
// The menu has two looks (agreed 30 Oct):
//   On a computer: a sidebar down the left, grouped under small
//     headings. It can shrink to just its icons, and remembers
//     that choice.
//   On a phone: a bar along the bottom with the main screens,
//     plus More, which slides the full sidebar in from the left
//     as a "drawer".
//
// Which look you get is decided by the screen width, in
// style.css. This file only needs to know which one is showing
// for a few things (the drawer only exists on a phone).
//
// A screen can have TWO buttons (one in the sidebar, one on the
// phone bar), so everything here works on "every button with
// this data-screen", never just the first one found.
// =============================================================

// The screens that exist. The first is the default. A new
// screen needs its name here, a <section data-screen="..."> and
// a button in index.html.
const SCREENS = ["command", "fleet", "shipyard", "industry", "exploration", "skills", "save"];

// Screens that aren't open YET, e.g. Exploration before the first
// sale (see setScreenOpen). Their buttons are hidden, and asking
// for one (an old bookmark) shows Command instead. Exploration
// starts closed so a new game never flashes it on screen.
const closedScreens = new Set(["exploration"]);

// The width (in CSS pixels) where the sidebar turns into the
// phone bar. Must match the @media rules in style.css.
// matchMedia lets JavaScript ask the same question CSS asks.
const PHONE_LAYOUT = window.matchMedia("(max-width: 799px)");

// Where the "shrink the sidebar" choice is remembered. It's kept
// in the browser, not the save: it's about this screen, not the
// game (like the nav dots).
const COLLAPSED_KEY = "project-damocles-nav-collapsed";

// The screens with a dot showing right now, e.g. {"shipyard"}.
// A Set is a list where each thing appears at most once.
const screensWithDots = new Set();


// Shortcut: find an element on the page by its id="..." name.
function byId(id) {
  return document.getElementById(id);
}

// Every menu button that opens this screen (sidebar and phone bar).
function buttonsFor(screen) {
  return document.querySelectorAll(`.nav-btn[data-screen="${screen}"]`);
}


// -------------------------------------------------------------
// setupNavigation()
// Runs once at start-up: wires up every menu button, the shrink
// button, the drawer, and the address bar.
//
// The screen name goes in the address bar after a # (like
// index.html#fleet), so refreshing keeps you on the same screen
// and the browser's Back button works.
// -------------------------------------------------------------
export function setupNavigation() {
  // Every button with a data-screen opens that screen. On a phone
  // the drawer then closes, so you see the screen you picked.
  for (const button of document.querySelectorAll(".nav-btn[data-screen]")) {
    button.addEventListener("click", () => {
      const name = button.dataset.screen;   // dataset.screen = data-screen="..."
      showScreen(name);
      location.hash = name;
      closeDrawer();
    });
  }

  // When the # changes some other way (the Back button, or
  // typing it in the address bar), show the matching screen.
  window.addEventListener("hashchange", showScreenFromAddress);

  setupCollapse();
  setupDrawer();

  // Screens that start closed have their buttons hidden at once.
  for (const screen of closedScreens) {
    for (const button of buttonsFor(screen)) button.hidden = true;
    const group = document.querySelector(`[data-group-for="${screen}"]`);
    if (group) group.hidden = true;
  }

  // Show the right screen straight away on page load.
  showScreenFromAddress();
}

function showScreenFromAddress() {
  // location.hash is "#fleet"; .slice(1) drops the "#".
  let name = location.hash.slice(1);

  // Old bookmarks to the Ships screen go to Fleet now.
  if (name === "ships") {
    name = "fleet";
  }

  // Unknown, empty or not open yet? Fall back to the first screen.
  if (!SCREENS.includes(name) || closedScreens.has(name)) {
    name = SCREENS[0];
  }
  showScreen(name);
}


// -------------------------------------------------------------
// setScreenOpen(screen, open)
// Shows or hides a screen's menu buttons (sidebar and phone bar).
// ui.js calls this 4 times a second, so it only does anything
// when the answer changes. A group whose only screen is closed
// (Expansion, before Exploration opens) hides its heading too.
// -------------------------------------------------------------
export function setScreenOpen(screen, open) {
  if (closedScreens.has(screen) !== open) return;   // no change

  if (open) {
    closedScreens.delete(screen);
  } else {
    closedScreens.add(screen);
  }
  for (const button of buttonsFor(screen)) {
    button.hidden = !open;
  }
  const group = document.querySelector(`[data-group-for="${screen}"]`);
  if (group) group.hidden = !open;

  if (open) {
    // Opened while you were looking for it in the address bar
    // (a refresh on #exploration): take you there now.
    if (location.hash.slice(1) === screen) showScreen(screen);
  } else if (!document.querySelector(`section[data-screen="${screen}"]`).hidden) {
    // Closed while you're on it (a Reset): go back to Command.
    showScreen(SCREENS[0]);
  }
}


// -------------------------------------------------------------
// showScreen(name)
// Shows one screen, hides the rest, and highlights its buttons.
// -------------------------------------------------------------
export function showScreen(name) {
  // Show the matching screen and hide the others.
  // ("hidden" is a built-in HTML switch for hiding things.)
  for (const screen of document.querySelectorAll(".screen")) {
    screen.hidden = screen.dataset.screen !== name;
  }

  // Highlight the matching menu buttons (both copies).
  for (const button of document.querySelectorAll(".nav-btn[data-screen]")) {
    const isCurrent = button.dataset.screen === name;
    button.classList.toggle("active", isCurrent);
    // aria-current tells screen readers which page is open
    if (isCurrent) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  }

  // On a phone, More lights up when the screen you're on is one
  // that's only in the drawer (Shipyard, Skills, Save...), so the
  // bar always shows where you are.
  byId("nav-more").classList.toggle("active", !isOnPhoneBar(name));
}

// Is there a button for this screen on the phone bar?
function isOnPhoneBar(screen) {
  return document.querySelector(`.bottom-bar .nav-btn[data-screen="${screen}"]`) !== null;
}


// -------------------------------------------------------------
// navAlert(screen, on)
// Lights (or clears) the teal dot on a screen's buttons. ui.js
// decides WHEN (screenAlert: something new to buy); this just
// draws it, on both copies of the button.
//
// The More button gets a dot too, when any screen that's only in
// the drawer has one. Otherwise a dot on, say, Shipyard would be
// invisible on a phone until you happened to open the drawer.
// -------------------------------------------------------------
export function navAlert(screen, on) {
  for (const button of buttonsFor(screen)) {
    button.classList.toggle("has-alert", on);
  }

  if (on) {
    screensWithDots.add(screen);
  } else {
    screensWithDots.delete(screen);
  }

  let drawerOnlyDot = false;
  for (const name of screensWithDots) {
    if (!isOnPhoneBar(name)) {
      drawerOnlyDot = true;
    }
  }
  byId("nav-more").classList.toggle("has-alert", drawerOnlyDot);
}


// =============================================================
// SHRINKING THE SIDEBAR (computer only)
// =============================================================

// -------------------------------------------------------------
// setupCollapse()
// The arrows button at the top of the sidebar shrinks it to just
// its icons (hover an icon to see its name), giving the screens
// more room on a laptop. The choice is remembered.
// -------------------------------------------------------------
function setupCollapse() {
  const button = byId("sidebar-collapse");

  // Put it back the way it was last time.
  setCollapsed(loadCollapsed());

  button.addEventListener("click", () => {
    const collapsed = !document.body.classList.contains("nav-collapsed");
    setCollapsed(collapsed);
    saveCollapsed(collapsed);
  });
}

function setCollapsed(collapsed) {
  // style.css does the actual shrinking when the body has this class.
  document.body.classList.toggle("nav-collapsed", collapsed);

  // Keep the button's label honest for screen readers and hover.
  const button = byId("sidebar-collapse");
  const label = collapsed ? "Expand menu" : "Shrink menu";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.setAttribute("aria-expanded", String(!collapsed));
}

// Browser storage can be blocked (private windows, some
// settings), so every read and write is wrapped in try/catch.
// If it fails, the sidebar just starts full width.
function loadCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "yes";
  } catch (error) {
    return false;
  }
}

function saveCollapsed(collapsed) {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "yes" : "no");
  } catch (error) {
    // Blocked storage: it just won't be remembered.
  }
}


// =============================================================
// THE DRAWER (phone only)
// =============================================================

// -------------------------------------------------------------
// setupDrawer()
// More opens the full menu from the left. It closes when you:
// pick a screen, tap the dark area beside it, tap the cross,
// press Escape, or widen the window to the computer layout.
// -------------------------------------------------------------
function setupDrawer() {
  byId("nav-more").addEventListener("click", () => {
    if (isDrawerOpen()) {
      closeDrawer();
    } else {
      openDrawer();
    }
  });

  byId("sidebar-close").addEventListener("click", closeDrawer);
  byId("drawer-backdrop").addEventListener("click", closeDrawer);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isDrawerOpen()) {
      closeDrawer();
      byId("nav-more").focus();   // put the keyboard back where it was
    }
  });

  // Turning a phone sideways (or widening a browser window) can
  // switch to the computer layout with the drawer still open.
  // "change" fires each time the phone/computer answer flips.
  PHONE_LAYOUT.addEventListener("change", () => {
    if (!PHONE_LAYOUT.matches) {
      closeDrawer();
    }
  });
}

function isDrawerOpen() {
  return document.body.classList.contains("drawer-open");
}

function openDrawer() {
  document.body.classList.add("drawer-open");     // style.css slides it in
  byId("drawer-backdrop").hidden = false;
  byId("nav-more").setAttribute("aria-expanded", "true");

  // Move the keyboard focus into the drawer, onto the screen
  // you're on, so keyboard and screen-reader users land in it.
  const current = document.querySelector(".sidebar .nav-btn.active") || byId("sidebar-close");
  current.focus();
}

function closeDrawer() {
  // Safe to call when it's already closed (picking a screen on a
  // computer calls this too, and nothing happens).
  document.body.classList.remove("drawer-open");
  byId("drawer-backdrop").hidden = true;
  byId("nav-more").setAttribute("aria-expanded", "false");
}
