# Project Damocles

A space-based idle game. Grow from one mining barge into a galaxy-spanning empire through mining, trade, industry and exploration.

**Current state:** walking skeleton. One ship mines one asteroid field on a timer, ore sells for credits, and progress continues while the game is closed (up to 24 hours).

## Running the game

The game uses JavaScript *modules* (files that `import` from each other). Browsers only allow modules when the page comes from a web server, so double-clicking `index.html` shows a blank page. Use a tiny local server instead:

1. Open this folder in **VS Code**.
2. Install the free **Live Server** extension (by Ritwick Dey).
3. Right-click `index.html` and choose **Open with Live Server**.

The game opens in your browser and reloads itself whenever you save a file.

## Running the tests

The game rules (mining, selling, saving, offline progress) have automated checks that run without a browser. With [Node.js](https://nodejs.org) installed:

```
node tests/logic-tests.js
```

Each check prints `PASS` or `FAIL`. One check feeds in a deliberately broken save, so a "Save was not valid" warning in the middle is expected.

## How the code is organised

```
index.html          the page layout
css/style.css       the amber "tactical display" look
data/content.js     game content: items, ship types, fields, rules (numbers live here)
js/main.js          starting point: loads the save, runs the game loop, autosaves
js/state.js         what the player owns: credits, cargo, ships, jobs
js/jobs.js          timed work (mining trips) and finishing jobs that are due
js/trade.js         selling goods for credits
js/save.js          save, load, version upgrades, offline progress
js/ui.js            drawing the screen and handling button clicks
tests/              automated checks for the game rules
```

A good reading order for learning: `data/content.js` → `js/state.js` → `js/jobs.js` → `js/main.js`.

**The key idea:** a job never counts down. It stores *when it started* and *how long it takes*, and the game compares that with the clock. That's why the same code handles both live play and time spent away.

## Design

The full design lives in the Project Damocles design doc (Claude Docs).
