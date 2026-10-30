// =============================================================
// tools/release.js
// -------------------------------------------------------------
// STAMPS A VERSION NUMBER ON A RELEASE.
//
// How to use it (needs Node.js), from the project folder:
//     node tools/release.js 0.2.1    set a new version number
//     node tools/release.js          re-stamp the current one
//                                    (after adding a new .js file)
//
// WHY THIS EXISTS
// GitHub Pages tells browsers they may keep a copy of each file
// for up to 10 minutes. After an update, a browser could load the
// NEW index.html with some OLD JavaScript files from its copy, a
// mix that doesn't work (Dan hit this on 30 Oct: the Pathfinder
// never unlocked).
//
// The fix: every file's web address includes the version, like
//     js/ui.js?v=0.2.1
// The server ignores everything after the "?", but the BROWSER
// treats a new address as a new file, so it can't reuse an old
// copy. This script writes those addresses into index.html:
//
//   1. js/version.js gets the new number (the game shows it).
//   2. A <meta name="game-version"> tag in index.html gets it too;
//      main.js compares the two and refuses to start if they ever
//      differ (see checkVersion in main.js).
//   3. An "import map" in index.html: a list that tells the browser
//      "when any file asks for js/ui.js, fetch js/ui.js?v=0.2.1".
//      Our files import each other with plain names (import ... from
//      "./ui.js"), and the import map adds the version to every one
//      of them, so the code itself never needs changing.
//   4. The stylesheet and main.js links get ?v= too.
//
// The tests check index.html matches js/version.js and lists every
// file, so a forgotten stamp shows up as a failed test.
// =============================================================

import { readFileSync, writeFileSync, readdirSync } from "node:fs";

// --- 1. The version number: the new one given, or the current one ---
const versionFile = "js/version.js";
const current = readFileSync(versionFile, "utf8").match(/VERSION = "([^"]+)"/)[1];
const version = process.argv[2] || current;

// Three whole numbers with dots between, like 0.2.1
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`"${version}" isn't a version number like 0.2.1`);
  process.exit(1);
}

writeFileSync(versionFile,
  readFileSync(versionFile, "utf8").replace(/VERSION = "[^"]+"/, `VERSION = "${version}"`));

// --- 2 and 3. The block in index.html between the two markers ---
// Every JavaScript file the game loads: everything in js/ and data/.
// (.sort() keeps the list in the same order every time.)
const files = [
  ...readdirSync("js").filter((name) => name.endsWith(".js")).map((name) => "./js/" + name),
  ...readdirSync("data").filter((name) => name.endsWith(".js")).map((name) => "./data/" + name),
].sort();

const imports = {};
for (const file of files) {
  imports[file] = `${file}?v=${version}`;
}

const block = [
  "<!-- version:start (written by tools/release.js - don't edit by hand) -->",
  `  <meta name="game-version" content="${version}">`,
  `  <script type="importmap">`,
  JSON.stringify({ imports }, null, 2).split("\n").map((line) => "  " + line).join("\n"),
  `  </script>`,
  "  <!-- version:end -->",
].join("\n");

let page = readFileSync("index.html", "utf8");
const start = page.indexOf("<!-- version:start");
const end = page.indexOf("<!-- version:end -->") + "<!-- version:end -->".length;
if (start === -1 || end < start) {
  console.error("index.html has no <!-- version:start --> ... <!-- version:end --> block");
  process.exit(1);
}
page = page.slice(0, start) + block + page.slice(end);

// --- 4. The stylesheet and main.js links ---
page = page.replace(/href="css\/style\.css(\?v=[^"]*)?"/, `href="css/style.css?v=${version}"`);
page = page.replace(/src="js\/main\.js(\?v=[^"]*)?"/, `src="js/main.js?v=${version}"`);

writeFileSync("index.html", page);
console.log(`Stamped version ${version} on ${files.length} files.`);
