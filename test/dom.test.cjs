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
// a 0.4s loop restarted the media element 2.5x a second and broke up
// wireless CarPlay; the keep-alive has to be long
check("keep-alive loops no faster than every 10s", (() => { const m = js.match(/const sr = 8000, n = sr \* (\d+)/); return !!m && +m[1] >= 10; })());
check("audio session pinned to playback", /audioSession\.type = "playback"/.test(js));
check("output passes through the soft limiter", /limiter\.connect\(ctx\.destination\)/.test(js));
check("test sound leaves a running session's carrier alone", /if \(running\) return;\s*carrierOff\(\)/.test(js));
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

/* 7. audio recovery. Web Audio does not exist in jsdom, but the state machine
   that decides when to rebuild is ordinary logic, and its failure mode — cues
   dying until the app is closed and reopened — is too quiet to leave untested.
   A second page is loaded with a context whose state the test can drive. */
(async () => {
  const built = [];
  const sources = [];
  function fake() {  // a constructor: the app calls `new AudioContext()`
    /* the audio clock tracks the page clock, as a healthy one does, so the
       tests can move both together and check where cues land on it */
    const born = w2.performance.now() / 1000;
    const c = {
      state: "running", sampleRate: 44100, destination: {}, baseLatency: 0.02,
      get currentTime() { return w2.performance.now() / 1000 - born; },
      close: () => { c.state = "closed"; c.closed = true; return Promise.resolve(); },
      resume: () => { if (c.state === "suspended") c.state = "running"; return Promise.resolve(); },
      createGain: () => ({ gain: { value: 0, setValueCurveAtTime() {} }, connect() {}, disconnect() {} }),
      createWaveShaper: () => ({ curve: null, connect() {} }),
      createBiquadFilter: () => ({ type: "", frequency: { value: 0, setValueAtTime() {}, setValueCurveAtTime() {} }, Q: { value: 0 }, connect() {} }),
      createOscillator: () => ({ type: "", frequency: { value: 0, setValueAtTime() {}, setValueCurveAtTime() {} }, connect() {}, start() {}, stop() {} }),
      createBufferSource: () => {
        const src = { buffer: null, loop: false, connect() {}, start(t) { src.when = t; }, stop(t) { src.stopAt = t; } };
        sources.push(src);
        return src;
      },
      createBuffer: () => ({ getChannelData: () => new Float32Array(8) }),
      decodeAudioData: () => Promise.resolve({}),
    };
    built.push(c);
    return c;
  }
  // the canvas screen-hold fallback is unimplemented in jsdom and caught by the
  // app; drop jsdom's complaints about it so real failures stay readable
  const quiet = new (require("jsdom").VirtualConsole)();
  quiet.sendTo(console, { omitJSDOMErrors: true });
  const dom2 = new JSDOM(html, { runScripts: "outside-only", url: "https://example.com/", pretendToBeVisual: true, virtualConsole: quiet });
  const w2 = dom2.window, d2 = dom2.window.document;
  w2.URL.createObjectURL = () => "blob:stub";
  w2.AudioContext = fake;
  w2.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w2.HTMLMediaElement.prototype.pause = () => {};
  w2.scrollTo = () => {};
  w2.eval(js);

  const tap = (el) => el.dispatchEvent(new w2.MouseEvent("click", { bubbles: true }));
  const wake = () => d2.dispatchEvent(new w2.Event("visibilitychange"));
  Object.defineProperty(d2, "visibilityState", { get: () => "visible", configurable: true });

  tap(d2.querySelectorAll("#patterns .card")[0]);
  tap(d2.getElementById("stage"));
  check("a session builds an audio context", built.length === 1);

  built[0].state = "suspended";
  wake();
  check("a suspended context is resumed, not replaced", built.length === 1 && built[0].state === "running");

  // the state iOS leaves behind after a call or Siri, which resume() will not clear
  built[0].state = "interrupted";
  wake();
  await new Promise((r) => setTimeout(r, 0));
  check("an interrupted context is closed", built[0].closed === true);
  check("an interrupted context is rebuilt", built.length === 2 && built[1].state === "running");
  check("the session keeps running through a rebuild", !d2.getElementById("session").hidden);
  check("the stall is reported while it lasts", d2.getElementById("audioState").textContent.startsWith("sound"));

  /* 8. the cue queue. Cues are queued ahead on the audio clock so a locked
     phone keeps sounding; coming back from a long freeze must not stack
     every missed cue at once, and pausing must pull what is queued. */
  let clock = 1000;
  Object.defineProperty(w2.performance, "now", { value: () => clock * 1000, configurable: true });
  const frames = () => new Promise((r) => setTimeout(r, 80));
  const audioNow = () => built[built.length - 1].currentTime;
  tap(d2.getElementById("stage"));  // stop
  tap(d2.getElementById("stage"));  // start on the fake clock
  clock += 3.2; await frames();
  check("cues are queued well ahead on the audio clock", sources.some((x) => x.when > audioNow() + 20));

  const before = sources.length;
  clock += 120; await frames();
  const fresh = sources.slice(before);
  check("returning from a long freeze does not stack missed cues", fresh.filter((x) => x.when < audioNow() + 0.5).length <= 2);
  check("and queues ahead again from where the session now is", fresh.some((x) => x.when > audioNow() + 20));
  check("the session is still running after the freeze", d2.getElementById("hint").classList.contains("running"));

  const ahead = sources.filter((x) => x.when > audioNow() + 1 && x.stopAt !== 0);
  tap(d2.getElementById("stage"));  // pause
  check("pausing pulls every cue queued ahead", ahead.length > 0 && ahead.every((x) => x.stopAt === 0));

  tap(d2.getElementById("stage"));  // start again; 5 minute default
  clock += 330; await frames();
  check("a session ends on time from its timeline", d2.getElementById("hint").textContent === "Tap to go again");

  check("the sound panel reports audio details", (() => {
    tap(d2.getElementById("back"));
    if (d2.getElementById("soundHome").hidden) tap(d2.getElementById("soundToggle"));
    const el = d2.querySelector("#soundHome .diag-line");
    return !!el && /kHz/.test(el.textContent) && /slips \d+/.test(el.textContent);
  })());

  // 9. storage that is corrupt or hand-edited must not stop the page loading
  const dom3 = new JSDOM(html, { runScripts: "outside-only", url: "https://example.com/", pretendToBeVisual: true, virtualConsole: quiet });
  dom3.window.localStorage.setItem("breatheasy", '{"voice":"robot","tone":7,"minutes":"x","vol":9,"custom":{"in":99}');
  dom3.window.URL.createObjectURL = () => "blob:stub";
  dom3.window.scrollTo = () => {};
  try { dom3.window.eval(js); check("corrupt prefs do not break the page", dom3.window.document.querySelectorAll("#patterns .card").length === 8); }
  catch (e) { check("corrupt prefs do not break the page (" + e.message + ")", false); }
  const dom4 = new JSDOM(html, { runScripts: "outside-only", url: "https://example.com/", pretendToBeVisual: true, virtualConsole: quiet });
  dom4.window.localStorage.setItem("breatheasy", '{"voice":"robot","tone":7,"minutes":"x","vol":9}');
  dom4.window.URL.createObjectURL = () => "blob:stub";
  dom4.window.scrollTo = () => {};
  try { dom4.window.eval(js); check("invalid prefs fall back to defaults", dom4.window.document.getElementById("soundSummary").textContent === "Ocean \u00b7 soft voice"); }
  catch (e) { check("invalid prefs fall back to defaults (" + e.message + ")", false); }

  console.log(failures ? `\n${failures} FAILURES` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
})();
