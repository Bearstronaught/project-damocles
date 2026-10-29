// =============================================================
// js/dev-switch.js
// -------------------------------------------------------------
// THE HIDDEN SWITCH for dev mode (the playtest tools).
//
// Two secret ways to flip it on or off:
//   - on a keyboard: type the letters d-a-m-o-c-l-e-s anywhere
//     on the page (not inside a text box)
//   - on a phone: tap the game title 7 times quickly
//
// The switch is stored in the browser (localStorage), NOT in the
// save. So dev mode belongs to this browser on this device: an
// exported save never turns it on for someone else.
// =============================================================

// The label the switch is stored under in localStorage.
const DEV_KEY = "project-damocles-dev";

// The letters to type.
const SECRET_WORD = "damocles";

// Title taps: how many, and the longest pause allowed between
// two taps before the count starts again.
const TAPS_NEEDED = 7;
const TAP_GAP_MS = 1000;


// -------------------------------------------------------------
// isDevModeOn()
// True if dev mode is switched on in this browser.
// -------------------------------------------------------------
export function isDevModeOn() {
  // Storage can be blocked (private browsing), so "try" it and
  // treat any failure as "off".
  try {
    return localStorage.getItem(DEV_KEY) === "on";
  } catch (error) {
    return false;
  }
}

// -------------------------------------------------------------
// setDevMode(on)
// Remembers the switch in this browser.
// -------------------------------------------------------------
export function setDevMode(on) {
  try {
    if (on) {
      localStorage.setItem(DEV_KEY, "on");
    } else {
      localStorage.removeItem(DEV_KEY);
    }
  } catch (error) {
    console.warn("Could not store dev mode:", error);
  }
}


// -------------------------------------------------------------
// watchForSecret(titleElement, onFlip)
// Starts listening for the word and the taps. Each time either
// is completed, onFlip() is called (main.js does the flipping).
// -------------------------------------------------------------
export function watchForSecret(titleElement, onFlip) {
  // --- Typing the word ---
  // "typed" holds the last few letters pressed, e.g. "xdamocl".
  let typed = "";

  document.addEventListener("keydown", (event) => {
    // Ignore keys typed into a box (renaming a ship "Damocles"
    // shouldn't flip anything) or held with Ctrl/Alt/Cmd
    // (shortcuts like Ctrl+S aren't typing).
    const tag = event.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    // Only single letters count (not Shift, Enter, arrows...).
    if (event.key.length !== 1) return;

    // Add the letter, and keep only as many as the word is long.
    // .slice(-8) keeps the LAST 8 characters.
    typed = (typed + event.key.toLowerCase()).slice(-SECRET_WORD.length);

    if (typed === SECRET_WORD) {
      typed = "";   // start fresh so it doesn't fire twice
      onFlip();
    }
  });

  // --- Tapping the title ---
  let taps = 0;
  let lastTapAt = 0;

  titleElement.addEventListener("click", () => {
    const now = Date.now();
    // Too slow since the last tap? Start counting again.
    if (now - lastTapAt > TAP_GAP_MS) {
      taps = 0;
    }
    taps += 1;
    lastTapAt = now;

    if (taps >= TAPS_NEEDED) {
      taps = 0;
      onFlip();
    }
  });
}
