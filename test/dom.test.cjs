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

// 1. every element the script reaches for must exist in the markup
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const wanted = new Set([...js.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]));
for (const id of wanted) check(`element #${id} exists`, ids.has(id));

// 2. every asset referenced anywhere must exist on disk
const refs = new Set([...(html + js + read("sw.js")).matchAll(/["'](?:\.\/)?((?:audio|icons)\/[^"']+\.(?:mp3|png))["']/g)].map((m) => m[1]));
for (const r of refs) check(`asset ${r} exists`, fs.existsSync(path.join(root, r)));

// 3. everything in the service worker cache list must exist
for (const a of [...read("sw.js").matchAll(/"\.\/([^"]+)"/g)].map((m) => m[1])) {
  check(`cached ${a} exists`, fs.existsSync(path.join(root, a)));
}

// 4. constraints that have regressed before
check("arc large-flag flips at two thirds", /value > 2 \/ 3/.test(js));
check("cue envelopes are raised cosine", /hann\(72/.test(js));
check("bluetooth keep-alive present", /keepAudio/.test(js));
check("a2dp carrier present", /frequency\.value = 32/.test(js));
check("no breath hold longer than 10s", ![...js.matchAll(/\["hold(?:Out)?", (\d+(?:\.\d+)?)\]/g)].some((m) => +m[1] > 10));

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
click(d.getElementById("soundToggle"));
check("settings panel builds", d.querySelectorAll("#soundHome .seg").length >= 6);
click(cards[1]);
check("session opens on the tapped pattern", !d.getElementById("session").hidden && d.getElementById("stageName").textContent === "Box");
check("duration chips render", d.querySelectorAll("#durations .seg").length === 5);
check("gauge track drawn", !!d.getElementById("track").getAttribute("d"));

console.log(failures ? `\n${failures} FAILURES` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
