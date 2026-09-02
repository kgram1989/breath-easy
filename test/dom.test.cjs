/* Loads the real page in a DOM and clicks through it.
   Catches the class of bug that syntax checks miss: dead references,
   missing element ids, and asset paths that point at nothing. */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
let failures = 0;
const check = (name, ok) => { if (!ok) { console.error("FAIL  " + name); failures++; } else console.log("ok    " + name); };

const html = read("index.html");
const js = read("app.js");
const sw = read("sw.js");

// 1. every element the script reaches for must exist in the markup
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const wanted = new Set([...js.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]));
for (const id of wanted) check(`element #${id} exists`, ids.has(id));

// 2. every asset referenced anywhere must exist on disk
const refs = new Set([...(html + js + sw).matchAll(/["'](?:\.\/)?((?:audio|icons)\/[^"']+\.(?:mp3|png))["']/g)].map((m) => m[1]));
for (const r of refs) check(`asset ${r} exists`, fs.existsSync(path.join(root, r)));

// 3. everything in the service worker cache list must exist
for (const a of [...sw.matchAll(/"\.\/([^"]+)"/g)].map((m) => m[1])) {
  check(`cached ${a} exists`, fs.existsSync(path.join(root, a)));
}

// 4. constraints that have regressed before
check("arc large-flag flips at two thirds", /value > 2 \/ 3/.test(js));
check("cue envelopes are raised cosine", /hann\(72/.test(js));
check("bluetooth keep-alive present", /keepAudio/.test(js));
check("a2dp carrier present", /frequency\.value = 32/.test(js));
check("no breath hold longer than 10s", ![...js.matchAll(/\["hold(?:Out)?", (\d+(?:\.\d+)?)\]/g)].some((m) => +m[1] > 10));
check("custom sliders cap at 10s", /CUSTOM_MAX = 10\b/.test(js));
check("custom breaths floor at 2s", /CUSTOM_MIN_BREATH = 2\b/.test(js));
check("custom cycle floors at 6s", /CUSTOM_MIN_CYCLE = 6\b/.test(js));
// cache-first over the shell pinned the app to its first build; reload could
// not escape it, because the worker was answering the reload
check("shell is fetched network-first", /await fetch\(e\.request, \{ cache: "no-cache" \}\)/.test(sw));
check("only audio and icons are cache-first", sw.includes("const IMMUTABLE = /\\/(audio|icons)\\//"));
check("a new worker triggers a reload", /controllerchange/.test(js));
check("that reload never interrupts a session", /reloading \|\| running/.test(js));

// 5. the page actually runs and responds to taps
const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://example.com/", pretendToBeVisual: true });
const w = dom.window;
w.URL.createObjectURL = () => "blob:stub";
w.AudioContext = function () { throw new Error("stubbed"); };
w.HTMLMediaElement.prototype.play = () => Promise.resolve();
w.HTMLMediaElement.prototype.pause = () => {};
w.scrollTo = () => {};
try { w.eval(js); check("page loads without throwing", true); }
catch (e) { check("page loads without throwing (" + e.message + ")", false); }

const d = w.document;
const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
const cards = d.querySelectorAll("#patterns .card");
check("eight patterns render", cards.length === 8);
const alts = [...d.querySelectorAll("#patterns .card-alt")];
check("every card names its technique", alts.length === 8 && alts.every((e) => e.textContent.trim()));
click(d.getElementById("soundToggle"));
check("settings panel builds", d.querySelectorAll("#soundHome .seg").length >= 6);
click(cards[1]);
check("session opens on the tapped pattern", !d.getElementById("session").hidden && d.getElementById("stageName").textContent === "Focus");
check("duration chips render", d.querySelectorAll("#durations .seg").length === 5);
check("gauge track drawn", !!d.getElementById("track").getAttribute("d"));

// 6. the custom builder, and the limits it enforces in the markup it writes
click(d.getElementById("back"));
click(d.getElementById("customToggle"));
const sliders = [...d.querySelectorAll("#customPanel input[type=range]")];
check("custom builder has four sliders", sliders.length === 4);
check("no custom slider exceeds 10s", sliders.every((s) => +s.max === 10));
check("custom breath sliders floor at 2s", sliders.filter((s) => +s.min === 2).length === 2);
check("custom pattern can be named", !!d.querySelector("#customPanel input[type=text]"));
sliders.forEach((s) => { s.value = s.min; s.dispatchEvent(new w.Event("input", { bubbles: true })); });
check("a too-quick cycle cannot be started", d.querySelector("#customPanel .test").disabled === true);
sliders[2].value = 6;
sliders[2].dispatchEvent(new w.Event("input", { bubbles: true }));
check("a legal cycle can be started", d.querySelector("#customPanel .test").disabled === false);

// holds are at 0 here, so this also covers dropping empty phases from the pattern
const nameField = d.querySelector("#customPanel input[type=text]");
nameField.value = "School run";
nameField.dispatchEvent(new w.Event("input", { bubbles: true }));
click(d.querySelector("#customPanel .test"));
check("custom session opens under its own name",
  !d.getElementById("session").hidden && d.getElementById("stageName").textContent === "School run");
check("custom session reports its rate", /breaths a minute/.test(d.getElementById("whyLine").textContent));

console.log(failures ? `\n${failures} FAILURES` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
