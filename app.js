/* Breath Easy — eyes-free breathing cues for the car.
   No framework, no build step, no network calls after first load. */

/* Named for what you need, not for the count. `alt` is the technique's own
   name, kept as a subtitle so the pattern stays findable by it. Everyday
   patterns lead; the two you only reach for in a specific bind — an acute
   stress reset and a breathlessness pattern — sit at the end. */
const PATTERNS = [
  { id: "coherent", name: "Relax", alt: "Coherent", phases: [["in", 5.5], ["out", 5.5]],
    use: "Nothing wrong, just a long drive. Leave it running.",
    why: "About 5.5 breaths a minute. Best default for a long drive — steady, no holds, no strain." },
  { id: "box", name: "Focus", alt: "Box", phases: [["in", 4], ["hold", 4], ["out", 4], ["holdOut", 4]],
    use: "Merging, bad weather, the last hour of a long shift.",
    why: "Used by first responders before high-stakes work. Equal counts are easy to hold onto in traffic." },
  { id: "exhale", name: "Unwind", alt: "Long Exhale", phases: [["in", 4], ["out", 6]],
    use: "Stop-start traffic, a tailgater, a call that went badly.",
    why: "Exhale longer than inhale and the vagus nerve slows the heart. The highest-yield pattern here." },
  { id: "triangle", name: "Gentle Hold", alt: "Triangle", phases: [["in", 4], ["hold", 4], ["out", 4]],
    use: "New to counted breathing, or holds make you uneasy.",
    why: "One hold instead of two — less air hunger while you get used to counted breathing." },
  { id: "478", name: "Deep Calm", alt: "4 \u00b7 7 \u00b7 8", phases: [["in", 4], ["hold", 7], ["out", 8]],
    use: "A quiet stretch of road, or parked. Stop if you feel light-headed.",
    why: "The 7-count hold is the longest here. Fine for most people seated; skip it if it makes you swimmy." },
  { id: "slow6", name: "Slow Down", alt: "Slow Six", phases: [["in", 6], ["out", 6]],
    use: "When Relax starts to feel easy and you want more.",
    why: "Five breaths a minute. Let the belly do the work, not the shoulders." },
  { id: "sigh", name: "Reset", alt: "Physiological Sigh", phases: [["in", 1.5, 0.75], ["top", 1], ["out", 5], ["holdOut", 1]],
    use: "Something just happened. Two or three rounds takes the edge off.",
    why: "A double inhale reinflates collapsed air sacs, then a long exhale dumps CO\u2082. The body's own reset." },
  { id: "pursed", name: "Recover", alt: "Pursed Lip", phases: [["in", 2], ["out", 4]],
    use: "Breathless or wheezy. Exhale through pursed lips, like cooling soup.",
    why: "Back-pressure keeps small airways open. Standard in COPD and asthma care." },
];

const LABEL = { in: "Inhale", top: "Sip more", hold: "Hold", out: "Exhale", holdOut: "Hold" };
const CLIP = { in: "inhale", top: "top", hold: "hold", holdOut: "hold", out: "exhale" };
const VOICES = {
  soft: { label: "Soft", dir: "audio/soft" },
  warm: { label: "Warm", dir: "audio/warm" },
};
const CLIP_NAMES = ["inhale", "exhale", "hold", "top", "ready", "done"];
const DURATIONS = [2, 5, 10, 20, 0];
const COLOR = { amber: "#E8A33D", amberDim: "#7A5A22", ice: "#78AEC2", muted: "#8C837A", edge: "#2A2521" };

/* Limits on the custom builder, all three breath-safety rather than taste:
   no hold may outrun the ~10s ceiling, a breath may not be shorter than 2s,
   and no cycle may run quicker than the briskest shipped pattern (Recover,
   6s). Deep breathing at a fast rate is how you blow off CO2 and grey out,
   so the cycle floor matters more than either single slider. */
const CUSTOM_MAX = 10;
const CUSTOM_MIN_BREATH = 2;
const CUSTOM_MIN_CYCLE = 6;
const CUSTOM_DEFAULT = { name: "", in: 4, hold: 4, out: 4, holdOut: 4 };

/* ── preferences ──────────────────────────────────────────────── */
/* Storage can be corrupt, hand-edited, or unavailable outright (private
   browsing, blocked site data). None of those may stop the page loading. */
const PREF_DEFAULTS = { tone: "ocean", voice: "soft", minutes: 5, vol: 0.85 };
let stored = {};
try { stored = JSON.parse(localStorage.getItem("breatheasy") || "{}") || {}; } catch (e) {}
const prefs = Object.assign({}, PREF_DEFAULTS, typeof stored === "object" ? stored : {});
const savePrefs = () => { try { localStorage.setItem("breatheasy", JSON.stringify(prefs)); } catch (e) {} };

/* localStorage is user-editable, so the limits are re-applied on load rather
   than trusted to the slider attributes that wrote them. */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(+v) ? +v : lo));
if (!["ocean", "hum", "none"].includes(prefs.tone)) prefs.tone = PREF_DEFAULTS.tone;
if (!(prefs.voice in VOICES) && prefs.voice !== "off") prefs.voice = PREF_DEFAULTS.voice;
if (!DURATIONS.includes(prefs.minutes)) prefs.minutes = PREF_DEFAULTS.minutes;
prefs.vol = clamp(prefs.vol, 0, 1);
prefs.custom = Object.assign({}, CUSTOM_DEFAULT, prefs.custom);
prefs.custom.name = String(prefs.custom.name || "").slice(0, 24);
prefs.custom.in = clamp(prefs.custom.in, CUSTOM_MIN_BREATH, CUSTOM_MAX);
prefs.custom.out = clamp(prefs.custom.out, CUSTOM_MIN_BREATH, CUSTOM_MAX);
prefs.custom.hold = clamp(prefs.custom.hold, 0, CUSTOM_MAX);
prefs.custom.holdOut = clamp(prefs.custom.holdOut, 0, CUSTOM_MAX);

/* ── curves ───────────────────────────────────────────────────── */
const ease = (x) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
const hann = (n, peak) => {
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) e[i] = peak * 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return e;
};
const sweepCurve = (n, from, to, mult) => {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = (from + (to - from) * ease(i / (n - 1))) * mult;
  return c;
};
function fullness(type, to, prev, prog) {
  const p = ease(prog);
  if (type === "in") return prev + ((to ?? 1) - prev) * p;
  if (type === "top") return prev + (1 - prev) * p;
  if (type === "hold") return prev;
  if (type === "out") return prev * (1 - p);
  return 0;
}
const endValue = (t, to) => (t === "in" ? (to ?? 1) : t === "top" ? 1 : t === "out" || t === "holdOut" ? 0 : null);

/* ── audio ────────────────────────────────────────────────────── */
let ctx = null, master = null, toneBus = null, noiseBuf = null, carrier = null;
const clips = {};      // decoded buffers, only valid for the live context
const clipBytes = {};  // the encoded mp3s, kept so a rebuild needs no network
let audioStalls = 0, rebuilding = false, rebuilds = 0;

/* Safari 16.4+ lets a page say what kind of audio it makes. Left on "auto",
   iOS files Web Audio as ambient and only treats the page as media while the
   keep-alive element is mid-play — so every hiccup in that element flips the
   session category, and on Bluetooth or wireless CarPlay each flip
   renegotiates the link and drops whatever was sounding. Pinning it to
   "playback" holds the category steady for the whole session. */
function claimAudioSession() {
  try {
    if (navigator.audioSession && navigator.audioSession.type !== "playback") navigator.audioSession.type = "playback";
  } catch (e) {}
}

/* Transparent below -3 dBFS, then a tanh knee that never reaches full scale.
   The voice clips peak at about -2 dBFS and playClip boosts them by up to
   1.6x, so without this every loud syllable hard-clipped. A shaper rather
   than a DynamicsCompressor: no makeup gain, no lookahead, no pumping of the
   noise bed when the voice comes in. The input is halved first because a
   shaper clamps anything outside [-1, 1] to the curve's ends. */
function softLimitCurve() {
  const n = 4097, c = new Float32Array(n), knee = 0.7, room = 1 - knee;
  for (let i = 0; i < n; i++) {
    const u = 2 * ((i / (n - 1)) * 2 - 1), m = Math.abs(u);
    c[i] = Math.sign(u) * (m <= knee ? m : knee + room * Math.tanh((m - knee) / room));
  }
  return c;
}

function buildAudio() {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  /* "playback" asks for larger output buffers. Nothing here needs low
     latency, and a bigger buffer is what rides out the scheduling jitter of
     a Bluetooth link instead of underrunning into a gap. */
  try { ctx = new Ctor({ latencyHint: "playback" }); } catch (e) { ctx = new Ctor(); }
  master = ctx.createGain();
  master.gain.value = 1;
  const pad = ctx.createGain(), limiter = ctx.createWaveShaper();
  pad.gain.value = 0.5;
  limiter.curve = softLimitCurve();
  master.connect(pad); pad.connect(limiter); limiter.connect(ctx.destination);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 2600; lp.Q.value = 0.6;
  toneBus = ctx.createGain();
  toneBus.connect(lp); lp.connect(master);
  noiseBuf = null;  // buffers belong to the context that made them
  ctx.onstatechange = () => { paintAudioState(); paintDiag(); };
}

function audio() {
  if (!ctx) buildAudio();
  /* resume() rejects routinely — iOS refuses it outside a user gesture — and
     an unhandled rejection here is silence with nothing to show for it, so
     the outcome is counted rather than dropped. */
  if (ctx.state !== "running") {
    try { ctx.resume().then(paintAudioState, paintAudioState); } catch (e) {}
  }
  return ctx;
}

/* iOS parks the context in "interrupted" after a call, Siri, or another app
   taking the audio session, and Android can leave it suspended after losing
   audio focus. resume() often will not bring either back — the context has to
   be thrown away and rebuilt. Without this the cues stay dead for the life of
   the page, which is why the only cure used to be closing the whole app. */
async function rebuildAudio() {
  if (rebuilding) return;
  rebuilding = true;
  const old = ctx;
  carrier = null;
  for (const k of Object.keys(clips)) delete clips[k];
  /* Replace before closing: leaving ctx null across the await would let a cue
     landing mid-rebuild build a stray context that this one then orphans. */
  buildAudio();
  rebuilds++;
  try { if (old) await old.close(); } catch (e) {}
  try { await ctx.resume(); } catch (e) {}
  await decodeVoice(prefs.voice);
  if (running) { carrierOn(); keepAudio.play().catch(() => {}); }
  rebuilding = false;
  paintAudioState();
}

/* Runs on the session guard tick and whenever the app comes back to the
   foreground — the two moments the context is most likely to have died. */
function guardAudio() {
  try { if (keepAudio.paused) keepAudio.play().catch(() => {}); } catch (e) {}
  if (!ctx || rebuilding) return;
  if (ctx.state === "running") {
    audioStalls = 0;
    if (running && !carrier) carrierOn();
    paintAudioState();
    return;
  }
  audioStalls++;
  if (ctx.state === "interrupted" || audioStalls >= 2) { audioStalls = 0; rebuildAudio(); }
  else audio();
  paintAudioState();
}

/* Every sound below takes an optional start time on the audio clock, so a
   session can be queued ahead of time, and hands back its nodes — sources to
   stop and the output to disconnect — so a queued cue can be cancelled. */

/* Hum: low sines under a raised cosine. Never starts, just becomes audible. */
function glide(from, to, dur, gain, sub = true, at) {
  try {
    const a = audio(), t = Math.max(at ?? 0, a.currentTime), g = a.createGain(), srcs = [];
    g.gain.setValueCurveAtTime(hann(72, Math.max(0.0002, gain)), t, dur);
    g.connect(toneBus);
    (sub ? [[1, 1], [0.5, 0.45], [1.5, 0.08]] : [[1, 1]]).forEach(([mult, lvl]) => {
      const o = a.createOscillator();
      o.type = "sine";
      if (from === to) o.frequency.setValueAtTime(from * mult, t);
      else o.frequency.setValueCurveAtTime(sweepCurve(96, from, to, mult), t, dur);
      const vg = a.createGain();
      vg.gain.value = lvl;
      o.connect(vg); vg.connect(g);
      o.start(t); o.stop(t + dur + 0.12);
      srcs.push(o);
    });
    return { srcs, out: g, end: t + dur + 0.12 };
  } catch (e) { return null; }
}

/* Ocean: brown noise through a moving bandpass. Brightens as you fill.
   Peak is scaled up because the bandpass costs about 4.4x in level. */
function swell(from, to, dur, gain, q = 2.2, at) {
  try {
    const a = audio(), t = Math.max(at ?? 0, a.currentTime);
    if (!noiseBuf) {
      const len = Math.floor(a.sampleRate * 3);
      noiseBuf = a.createBuffer(1, len, a.sampleRate);
      const d = noiseBuf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.06 * (Math.random() * 2 - 1)) / 1.06;
        d[i] = last * 2.2;
      }
    }
    const src = a.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const bp = a.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = q;
    if (from === to) bp.frequency.setValueAtTime(from, t);
    else bp.frequency.setValueCurveAtTime(sweepCurve(96, from, to, 1), t, dur);
    const g = a.createGain();
    g.gain.setValueCurveAtTime(hann(72, Math.max(0.0002, gain)), t, dur);
    src.connect(bp); bp.connect(g); g.connect(toneBus);
    src.start(t); src.stop(t + dur + 0.08);
    return { srcs: [src], out: g, end: t + dur + 0.08 };
  } catch (e) { return null; }
}

function carrierOn() {
  try {
    const a = audio();
    if (carrier) return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = "sine"; o.frequency.value = 32; g.gain.value = 0.0009;
    o.connect(g); g.connect(master); o.start();
    carrier = o;
  } catch (e) {}
}
function carrierOff() { try { carrier && carrier.stop(); } catch (e) {} carrier = null; }

let voiceState = "idle";
async function loadVoice(id) {
  if (!id || id === "off" || (clips[id] && CLIP_NAMES.every((k) => clips[id][k]))) return;
  voiceState = "loading"; renderPanels();
  /* Only clips that actually arrived are kept, and any that did not are
     asked for again next time — otherwise one dropped request on a weak
     signal would leave that word missing for the life of the page. */
  const bytes = clipBytes[id] || (clipBytes[id] = {});
  await Promise.all(CLIP_NAMES.filter((k) => !bytes[k]).map(async (k) => {
    try {
      const res = await fetch(`${VOICES[id].dir}/${k}.mp3`);
      if (res.ok) bytes[k] = await res.arrayBuffer();
    } catch (e) {}
  }));
  await decodeVoice(id);
  voiceState = clips[id] ? "ready" : "failed";
  renderPanels();
}

/* Decoded buffers die with their context, so a rebuild has to decode again.
   decodeAudioData detaches whatever it is handed, hence the copy — the
   encoded bytes have to survive for the next rebuild, which may happen on a
   road with no signal. */
async function decodeVoice(id) {
  if (!id || id === "off" || !clipBytes[id]) return;
  const a = audio(), bank = {};
  await Promise.all(Object.entries(clipBytes[id]).map(async ([k, raw]) => {
    try { bank[k] = await a.decodeAudioData(raw.slice(0)); } catch (e) {}
  }));
  if (Object.keys(bank).length) clips[id] = bank;
}
const hasClip = (key) => !!(clips[prefs.voice] && clips[prefs.voice][key]);
function playClip(key, at) {
  const bank = clips[prefs.voice];
  if (!bank || !bank[key]) return null;
  try {
    const a = audio(), s = a.createBufferSource(), g = a.createGain(), t = Math.max(at ?? 0, a.currentTime);
    s.buffer = bank[key];
    g.gain.value = Math.min(1.6, 0.55 + prefs.vol * 1.1);
    s.connect(g); g.connect(master); s.start(t);
    return { srcs: [s], out: g, end: t + bank[key].duration };
  } catch (e) { return null; }
}

/* The wash under one phase. The voice is queued separately (see pump), as
   it may still be decoding when the washes are first queued. */
function toneCue(type, secs, at) {
  const duck = prefs.voice !== "off" ? 0.78 : 1;
  const v = prefs.vol * duck, span = secs * 0.94;
  if (prefs.tone === "ocean") {
    if (type === "in") return swell(300, 880, span, v * 0.75, 2.2, at);
    if (type === "top") return swell(880, 1020, span, v * 0.6, 2.2, at);
    if (type === "out") return swell(880, 300, span, v * 0.75, 2.2, at);
    if (type === "hold") return swell(880, 820, span, v * 0.3, 1.6, at);
    return swell(300, 290, span, v * 0.3, 1.6, at);
  }
  if (prefs.tone === "hum") {
    if (type === "in") return glide(196, 233, span, v * 0.17, true, at);
    if (type === "top") return glide(233, 262, span, v * 0.14, true, at);
    if (type === "out") return glide(233, 196, span, v * 0.17, true, at);
    if (type === "hold") return glide(233, 233, span, v * 0.07, true, at);
    return glide(196, 196, span, v * 0.07, true, at);
  }
  return null;
}

/* Silent looping media so the OS treats this as playback and hands it to
   Bluetooth or CarPlay, and so the link never goes dormant between cues.

   It runs 30 seconds per loop. It used to be 0.4s, which meant the media
   element hit its end and restarted two and a half times a second — and on
   iOS each restart briefly drops the element out of "playing", which can
   renegotiate a Bluetooth or wireless CarPlay link mid-syllable. Wired
   CarPlay rides that out; wireless audibly did not. 8 kHz keeps it ~470 KB. */
const keepAudio = document.createElement("audio");
keepAudio.loop = true; keepAudio.playsInline = true;
(function () {
  try {
  const sr = 8000, n = sr * 30, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVEfmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true);
  v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, (i % 3) - 1, true);
  keepAudio.src = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  } catch (e) {}
})();
/* Media elements keep firing timeupdate in the background on iOS, which
   makes it one more chance to top up the cue queue while the phone is locked. */
keepAudio.addEventListener("timeupdate", () => pump());

/* ── screen hold ──────────────────────────────────────────────── */
let lock = null, holdVideo = null, paintTimer = null, holdState = "none";
async function holdScreen() {
  let got = "none";
  try {
    if ("wakeLock" in navigator && !lock) {
      lock = await navigator.wakeLock.request("screen");
      lock.addEventListener("release", () => { lock = null; });
    }
    if (lock) got = "lock";
  } catch (e) {}
  if (got === "none") {
    try {
      if (!holdVideo) {
        const c = document.createElement("canvas");
        c.width = c.height = 2;
        if (!c.captureStream) throw new Error("no captureStream");
        const g = c.getContext("2d");
        let flip = 0;
        paintTimer = setInterval(() => {
          flip ^= 1; g.fillStyle = flip ? "#000000" : "#010101"; g.fillRect(0, 0, 2, 2);
        }, 400);
        holdVideo = document.createElement("video");
        holdVideo.muted = holdVideo.defaultMuted = true;
        holdVideo.loop = true;
        holdVideo.setAttribute("muted", "");
        holdVideo.setAttribute("playsinline", "");
        holdVideo.style.cssText = "position:fixed;right:0;bottom:0;width:2px;height:2px;opacity:.01;pointer-events:none;z-index:-1";
        holdVideo.srcObject = c.captureStream(5);
        document.body.appendChild(holdVideo);
      }
      await holdVideo.play();
      if (!holdVideo.paused) got = "video";
    } catch (e) {}
  }
  holdState = got;
  paintHold();
}
function releaseScreen() {
  try { lock && lock.release(); } catch (e) {}
  lock = null;
  try { holdVideo && holdVideo.pause(); } catch (e) {}
  holdState = "none";
  paintHold();
}

/* ── state ────────────────────────────────────────────────────── */
let pattern = PATTERNS[0];
let running = false, done = false;
let sessionStart = 0, lastPaint = 0, lastGuard = 0, raf = null, ticker = null;

const $ = (id) => document.getElementById(id);

/* ── gauge ────────────────────────────────────────────────────── */
const R = 112, CX = 150, CY = 150;
const pt = (t, rad = R) => {
  const th = ((135 + t * 270) * Math.PI) / 180;
  return [CX + rad * Math.cos(th), CY + rad * Math.sin(th)];
};
(function buildGauge() {
  const [sx, sy] = pt(0), [ex, ey] = pt(1);
  $("track").setAttribute("d", `M ${sx} ${sy} A ${R} ${R} 0 1 1 ${ex} ${ey}`);
  const g = $("ticks");
  for (let i = 0; i <= 20; i++) {
    const t = i / 20, long = i % 5 === 0;
    const [x1, y1] = pt(t, R + 10), [x2, y2] = pt(t, R + (long ? 20 : 15));
    const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
    l.setAttribute("x1", x1); l.setAttribute("y1", y1);
    l.setAttribute("x2", x2); l.setAttribute("y2", y2);
    l.setAttribute("stroke-width", long ? 2 : 1.2);
    l.setAttribute("stroke-linecap", "round");
    g.appendChild(l);
  }
})();

/* Runs ~30 times a second for the whole drive, on a phone that is often
   hot in a windscreen mount and also rendering CarPlay. Only the arc and
   needle move every frame; colour, glow, ticks and text are rewritten only
   when they actually change, rather than ~25 DOM writes per frame. */
const painted = { stroke: null, lit: -1, label: null, count: null };
function paintGauge(value, type, label, count) {
  const inhaling = type === "in" || type === "top";
  const stroke = !running ? COLOR.muted : inhaling ? COLOR.amber : type === "out" ? COLOR.ice : COLOR.amberDim;
  const [vx, vy] = pt(Math.max(0.0001, value));
  const [sx, sy] = pt(0);
  const fill = $("fill"), n = $("needle"), pl = $("phaseLabel");
  // large-arc flag flips past 180 degrees of a 270 degree sweep, i.e. two thirds
  fill.setAttribute("d", `M ${sx} ${sy} A ${R} ${R} 0 ${value > 2 / 3 ? 1 : 0} 1 ${vx} ${vy}`);
  n.setAttribute("cx", vx); n.setAttribute("cy", vy);
  const glow = `${stroke}|${running}`;
  if (painted.stroke !== glow) {
    painted.stroke = glow; painted.lit = -1;
    fill.setAttribute("stroke", stroke);
    fill.style.filter = running ? `drop-shadow(0 0 10px ${stroke}66)` : "none";
    n.setAttribute("fill", stroke);
    n.style.filter = `drop-shadow(0 0 12px ${stroke})`;
    pl.setAttribute("fill", stroke);
  }
  const ticks = $("ticks").children;
  let lit = 0;
  while (lit < ticks.length && lit / 20 <= value) lit++;
  if (painted.lit !== lit) {
    painted.lit = lit;
    for (let i = 0; i < ticks.length; i++) ticks[i].setAttribute("stroke", i < lit ? stroke : COLOR.edge);
  }
  if (painted.label !== label) { painted.label = label; pl.textContent = label; }
  if (painted.count !== count) { painted.count = count; $("phaseCount").textContent = count; }
}

function paintHold() {
  const el = $("holdState");
  el.hidden = !running;
  el.textContent = holdState === "none" ? "screen not held" : "screen held";
  el.classList.toggle("warn", holdState === "none");
}

/* Same reasoning as the screen-hold line: audio that has died is worth saying
   out loud, rather than leaving the driver wondering whether they missed a
   cue. Only shown once a guard tick has actually seen trouble, so a normal
   suspend on the way into a session never flashes it. */
function paintAudioState() {
  const el = $("audioState");
  if (!el) return;
  const ok = !!ctx && ctx.state === "running" && !keepAudio.paused;
  el.hidden = !running || ok || (audioStalls === 0 && !rebuilding);
  el.textContent = rebuilding ? "sound restarting" : "sound stalled";
  el.classList.add("warn");
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/* ── timeline ─────────────────────────────────────────────────── */
/* The session is a fixed timeline on the performance.now() clock: a 3s
   lead-in, then the pattern repeating, ending on the first cycle boundary
   past the chosen duration. Everything — which phase it is, what the gauge
   shows, when each cue sounds — is a pure function of the time, so nothing
   needs to have been watching to know where the session is. */
const LEAD = 3;
let plan = null;

function makePlan(p, startWall) {
  const offs = [];
  let acc = 0;
  for (const [, secs] of p.phases) { offs.push(acc); acc += secs; }
  /* The fill a phase starts from is wherever the last phase that moved it
     left off. Every pattern ends emptied, so this wraps cleanly to cycle 0. */
  const prev = p.phases.map((_, i) => {
    for (let k = 1; k <= p.phases.length; k++) {
      const [t, , to] = p.phases[(i - k + p.phases.length) % p.phases.length];
      const ev = endValue(t, to);
      if (ev !== null) return ev;
    }
    return 0;
  });
  return { phases: p.phases, offs, prev, cycle: acc, t0: startWall + LEAD };
}
const phaseCount = () => plan.phases.length;
const phaseStartAt = (n) => plan.t0 + Math.floor(n / phaseCount()) * plan.cycle + plan.offs[n % phaseCount()];
function phaseIndexAt(w) {
  if (w < plan.t0) return 0;
  const c = Math.floor((w - plan.t0) / plan.cycle), within = w - plan.t0 - c * plan.cycle;
  let i = phaseCount() - 1;
  while (i > 0 && plan.offs[i] > within) i--;
  return c * phaseCount() + i;
}
const endAt = () => (prefs.minutes > 0
  ? plan.t0 + Math.ceil(prefs.minutes * 60 / plan.cycle - 1e-9) * plan.cycle
  : Infinity);

/* ── scheduler ────────────────────────────────────────────────── */
/* Cues are queued up to HORIZON seconds ahead on the audio clock, not fired
   from the frame loop. The frame loop stops dead when the phone locks or the
   app goes to the background; the audio engine does not. So a locked phone
   keeps breathing with you for as long as is queued, and every time the page
   gets to run at all — a frame, the 1s ticker, the keep-alive's timeupdate —
   the queue is topped back up. None of those three time anything: cue times
   come from the timeline, and the audio clock plays them sample-accurately.

   A cue whose phase began more than STALE ago is skipped, never played late.
   That is what stops a pile-up when the page wakes after a long freeze: the
   rhythm simply picks up at the next turn. */
const HORIZON = 45, STALE = 0.5, SLIP = 0.25;
let queue = [], schedCtx = null, nTone = 0, nVoice = 0;
let leadQueued = false, readyPlayed = false, doneQueued = false;
let clockSlips = 0, lagBase = null, lostLag = 0;

function enqueue(kind, n, wallAt, off, node) {
  if (node) queue.push({ kind, n, at: wallAt + off, off, end: node.end, srcs: node.srcs, out: node.out });
}

/* Called on pause, on any sound-setting change, and when the audio clock has
   slipped against the timeline. Anything already sounding plays out exactly
   as before — only cues that have not started yet are pulled, which can be
   done without a click. */
function cancelQueued(now, keepDone) {
  queue = queue.filter((q) => {
    if (q.at <= now || (keepDone && q.kind === "done")) return true;
    for (const s of q.srcs) { try { s.stop(0); } catch (e) {} }
    try { q.out.disconnect(); } catch (e) {}
    if (q.kind === "tone") nTone = Math.min(nTone, q.n);
    else if (q.kind === "voice") nVoice = Math.min(nVoice, q.n);
    else if (q.kind === "done") doneQueued = false;
    return false;
  });
}

function doneCue(at) {
  const parts = [playClip("done", at),
    prefs.tone === "ocean" ? swell(620, 240, 3.4, prefs.vol * 0.5, 2.2, at)
      : prefs.tone === "hum" ? glide(233, 174.6, 3.4, prefs.vol * 0.12, true, at) : null].filter(Boolean);
  return parts.length ? { srcs: parts.flatMap((x) => x.srcs), out: { disconnect: () => parts.forEach((x) => x.out.disconnect()) },
    end: Math.max(...parts.map((x) => x.end)) } : null;
}

function pump() {
  if (!running) return;
  const wall = performance.now() / 1000;

  if (wall - lastGuard > 1.5) {
    lastGuard = wall;
    guardAudio();
    try { if (holdVideo && holdVideo.paused) holdVideo.play().catch(() => {}); } catch (e) {}
    paintDiag();
  }
  if (wall >= endAt()) { finish(); return; }
  if (!ctx || rebuilding || ctx.state !== "running") return;

  const now = ctx.currentTime, off = now - wall;
  if (schedCtx !== ctx) {
    // a rebuilt context: everything queued died with the old one
    queue = []; schedCtx = ctx; doneQueued = false;
    nTone = nVoice = phaseIndexAt(wall);
    lagBase = { wall, now };
  } else if (queue.some((q) => q.at > now && Math.abs(q.off - off) > SLIP)) {
    /* The audio clock fell behind the timeline: a dropout long enough to
       lose a quarter second, or a suspend and resume. Re-queue against the
       clock as it now stands, and count it — that count is the most direct
       evidence there is of the link breaking up. */
    clockSlips++;
    lostLag += (wall - lagBase.wall) - (now - lagBase.now);
    lagBase = { wall, now };
    cancelQueued(now);
  }
  queue = queue.filter((q) => q.end > now);

  if (!leadQueued) {
    leadQueued = true;
    if (wall - sessionStart < 1) {
      enqueue("lead", -1, sessionStart, off, prefs.tone === "ocean" ? swell(240, 420, 2.6, prefs.vol * 0.35, 2.2, sessionStart + off)
        : prefs.tone === "hum" ? glide(174.6, 196, 2.6, prefs.vol * 0.09, true, sessionStart + off) : null);
    }
  }
  /* On the first session, or straight after a rebuild, the clips are still
     decoding — so "Let's begin" waits up to a second for them rather than
     being skipped outright. */
  if (!readyPlayed && wall - sessionStart < 1 && hasClip("ready")) {
    readyPlayed = true;
    enqueue("ready", -1, Math.max(wall, sessionStart), off, playClip("ready", Math.max(wall, sessionStart) + off));
  }

  const until = Math.min(wall + HORIZON, endAt()), first = phaseIndexAt(wall - STALE);
  for (nTone = Math.max(nTone, first); phaseStartAt(nTone) < until; nTone++) {
    const at = phaseStartAt(nTone);
    if (at < wall - STALE) continue;
    const [type, secs] = plan.phases[nTone % phaseCount()];
    enqueue("tone", nTone, at, off, toneCue(type, secs, at + off));
  }
  // the voice waits on its clips; the washes never wait on the voice
  for (nVoice = Math.max(nVoice, first); phaseStartAt(nVoice) < until; nVoice++) {
    const at = phaseStartAt(nVoice);
    if (at < wall - STALE || prefs.voice === "off") continue;
    if (!clips[prefs.voice]) break;
    enqueue("voice", nVoice, at, off, playClip(CLIP[plan.phases[nVoice % phaseCount()][0]], at + off));
  }
  if (!doneQueued && endAt() < wall + HORIZON) {
    doneQueued = true;
    enqueue("done", -1, endAt(), off, doneCue(endAt() + off));
  }
}

/* A sound setting changed mid-session: what is already queued was built with
   the old one, so pull it and queue again from the next turn. */
function soundChanged() {
  if (!running || !ctx || schedCtx !== ctx) return;
  cancelQueued(ctx.currentTime);
  pump();
}

/* ── frame loop: paints only ──────────────────────────────────── */
function step() {
  pump();
  if (!running) return;
  const wall = performance.now() / 1000;
  if (wall - lastPaint > 0.032) { lastPaint = wall; paintSession(wall); }
  raf = requestAnimationFrame(step);
}

function paintSession(wall) {
  const since = wall - sessionStart;
  if (since < LEAD) { paintGauge(0, "holdOut", "Get set", Math.ceil(LEAD - since)); return; }
  const n = phaseIndexAt(wall), i = n % phaseCount();
  const [type, secs, to] = plan.phases[i], el = wall - phaseStartAt(n);
  paintGauge(fullness(type, to, plan.prev[i], el / secs), type, LABEL[type], Math.max(1, Math.ceil(secs - el)));
  const cycles = Math.floor((wall - plan.t0) / plan.cycle);
  const left = prefs.minutes > 0 ? Math.max(0, prefs.minutes * 60 - (since - LEAD)) : since - LEAD;
  $("clock").textContent = `${prefs.minutes > 0 ? mmss(left) + " left" : mmss(left)} · ${cycles} ${cycles === 1 ? "round" : "rounds"}`;
}

function start() {
  /* A tap is a user gesture, the one moment a browser reliably lets audio
     back in — so a context found dead here is rebuilt now rather than waited
     out on the guard tick. */
  audioStalls = 0;
  claimAudioSession();
  if (ctx && ctx.state === "interrupted") rebuildAudio(); else audio();
  loadVoice(prefs.voice);
  holdScreen();
  carrierOn();
  keepAudio.play().catch(() => {});
  sessionStart = performance.now() / 1000;
  plan = makePlan(pattern, sessionStart);
  queue = []; schedCtx = null; nTone = nVoice = 0;
  leadQueued = false; readyPlayed = false; doneQueued = false; lastGuard = 0;
  clockSlips = 0; lostLag = 0;
  running = true; done = false;
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
  $("hint").textContent = "Tap anywhere to pause";
  $("hint").classList.add("running");
  paintHold();
  paintAudioState();
  pump();
  clearInterval(ticker);
  ticker = setInterval(pump, 1000);
  raf = requestAnimationFrame(step);
}

/* The closing cue was queued ahead like any other, so it has usually already
   sounded by the time the page notices; it is only played here if the page
   was frozen too long for it to have been queued at all. */
function finish() {
  const queued = doneQueued;
  stop(true);
  if (!queued) doneCue();
}

function stop(finished) {
  running = false; done = !!finished;
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  clearInterval(ticker); ticker = null;
  if (ctx && schedCtx === ctx) cancelQueued(ctx.currentTime, finished);
  carrierOff();
  try { keepAudio.pause(); } catch (e) {}
  releaseScreen();
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
  $("hint").textContent = finished ? "Tap to go again" : "Tap anywhere to begin";
  $("hint").classList.remove("running");
  paintGauge(0, "holdOut", finished ? "Complete" : "Tap to start", finished ? "✓" : "—");
  paintAudioState();
  paintDiag();
}

/* ── settings panel, shared by both screens ───────────────────── */
function segRow(options, current, onPick) {
  const row = document.createElement("div");
  row.className = "row";
  options.forEach(([id, label]) => {
    const b = document.createElement("button");
    b.className = "seg";
    b.textContent = label;
    b.setAttribute("aria-pressed", String(current === id));
    b.onclick = () => { onPick(id); savePrefs(); renderPanels(); soundChanged(); };
    row.appendChild(b);
  });
  return row;
}

function buildPanel() {
  const p = document.createElement("div");
  p.className = "panel";

  const c1 = document.createElement("div"); c1.className = "cap"; c1.textContent = "Cue";
  p.append(c1, segRow([["ocean", "Ocean"], ["hum", "Hum"], ["none", "Silent"]], prefs.tone, (v) => { prefs.tone = v; }));

  const c2 = document.createElement("div"); c2.className = "cap"; c2.textContent = "Voice";
  p.append(c2, segRow([["soft", "Soft"], ["warm", "Warm"], ["off", "None"]], prefs.voice, (v) => {
    prefs.voice = v;
    if (v !== "off") { audio(); loadVoice(v).then(() => { if (!running) playClip("inhale"); }); }
  }));

  const c3 = document.createElement("div"); c3.className = "cap"; c3.textContent = "Volume";
  const vr = document.createElement("div"); vr.className = "row";
  const mk = (sign, path) => {
    const b = document.createElement("button");
    b.className = "icon-btn";
    b.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="${path}"/></svg>`;
    b.onclick = () => {
      prefs.vol = Math.min(1, Math.max(0, +(prefs.vol + sign * 0.1).toFixed(1)));
      savePrefs(); renderPanels(); soundChanged();
    };
    return b;
  };
  const meter = document.createElement("div");
  meter.className = "meter";
  meter.innerHTML = `<i style="width:${prefs.vol * 100}%"></i>`;
  vr.append(mk(-1, "M5 12h14"), meter, mk(1, "M12 5v14M5 12h14"));
  p.append(c3, vr);

  const test = document.createElement("button");
  test.className = "test";
  test.textContent = "Test through the car";
  test.onclick = testSound;
  p.appendChild(test);

  const note = document.createElement("p");
  note.className = "panel-note";
  note.textContent = 'Do this parked. A brightening wash with "breathe in", then a darkening one with "breathe out".'
    + (voiceState === "loading" ? " Loading voice\u2026" : voiceState === "failed" ? " Voice clips failed to load — cues still work." : "");
  p.appendChild(note);

  const diag = document.createElement("div");
  diag.className = "diag";
  const line = document.createElement("p");
  line.className = "diag-line";
  const copy = document.createElement("button");
  copy.className = "diag-copy";
  copy.textContent = "Copy audio details";
  copy.onclick = () => {
    const text = `${diagText()}\n${navigator.userAgent}`;
    try {
      navigator.clipboard.writeText(text).then(() => { copy.textContent = "Copied"; }, () => { copy.textContent = "Copy failed"; });
    } catch (e) { copy.textContent = "Copy unavailable"; }
  };
  line.textContent = diagText();
  diag.append(line, copy);
  p.appendChild(diag);
  return p;
}

/* What the audio engine is actually doing, for when the car misbehaves.
   "slips" counts the times the audio clock lost a quarter second or more
   against the session timeline — a real dropout, not a guess — and "lost" is
   how much time those, plus any smaller drift, add up to. Both reset each
   session. */
function diagText() {
  if (!ctx) return "Audio not started yet \u2014 press Test or start a session.";
  const ms = (x) => (typeof x === "number" && x > 0 ? `${Math.round(x * 1000)} ms` : "n/a");
  let lost = lostLag;
  if (running && lagBase && schedCtx === ctx) lost += (performance.now() / 1000 - lagBase.wall) - (ctx.currentTime - lagBase.now);
  return [
    `${(ctx.sampleRate / 1000).toFixed(1)} kHz`, `context ${ctx.state}`,
    `buffer ${ms(ctx.baseLatency)}`, `output ${ms(ctx.outputLatency)}`,
    `session ${navigator.audioSession ? navigator.audioSession.type : "n/a"}`,
    `keep-alive ${keepAudio.paused ? "paused" : "playing"}`, `carrier ${carrier ? "on" : "off"}`,
    `queued ${running ? queue.length : 0}`, `slips ${clockSlips}`,
    `lost ${Math.max(0, Math.round(lost * 1000))} ms`, `rebuilds ${rebuilds}`,
  ].join(" \u00b7 ");
}
function paintDiag() {
  const text = diagText();
  document.querySelectorAll(".diag-line").forEach((el) => { if (el.textContent !== text) el.textContent = text; });
}

function renderPanels() {
  $("soundSummary").textContent =
    `${{ ocean: "Ocean", hum: "Hum", none: "Silent" }[prefs.tone]} \u00b7 ${prefs.voice === "off" ? "no voice" : VOICES[prefs.voice].label.toLowerCase() + " voice"}`;
  for (const slot of ["soundHome", "soundSession"]) {
    const el = $(slot);
    if (!el.hidden) { el.innerHTML = ""; el.appendChild(buildPanel()); }
  }
  paintCustomSummary();
  renderDurations();
}

/* \u2500\u2500 custom pattern \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
/* A zero-length phase would make the engine's catch-up loop churn, so an
   unset hold is dropped from the pattern rather than run as 0 seconds. */
function customPattern() {
  const c = prefs.custom, phases = [["in", c.in]];
  if (c.hold > 0) phases.push(["hold", c.hold]);
  phases.push(["out", c.out]);
  if (c.holdOut > 0) phases.push(["holdOut", c.holdOut]);
  const cycle = phases.reduce((a, x) => a + x[1], 0);
  return {
    id: "custom", name: c.name.trim() || "Custom", phases,
    alt: phases.map((x) => x[1]).join(" \u00b7 "),
    use: "",
    why: `Your own rhythm \u2014 ${cycle}s a cycle, about ${(60 / cycle).toFixed(1)} breaths a minute.`,
  };
}

function paintCustomSummary() {
  const p = customPattern();
  $("customSummary").textContent = `${prefs.custom.name.trim() || "Build your own"} \u00b7 ${p.alt}`;
}

function buildCustom() {
  const panel = document.createElement("div");
  panel.className = "panel";

  const nameCap = document.createElement("div");
  nameCap.className = "cap"; nameCap.textContent = "Name this one";
  const name = document.createElement("input");
  name.className = "name-input"; name.type = "text"; name.maxLength = 24;
  name.placeholder = "Custom"; name.value = prefs.custom.name;
  name.setAttribute("aria-label", "Name this pattern");
  panel.append(nameCap, name);

  const bar = document.createElement("div");
  bar.className = "rhythm";
  const note = document.createElement("p");
  note.className = "panel-note";
  const go = document.createElement("button");
  go.className = "test"; go.textContent = "Start";

  /* Only the readouts and the preview are repainted as a slider moves \u2014
     rebuilding the panel mid-drag would drop the thumb. */
  const sync = () => {
    const p = customPattern(), cycle = p.phases.reduce((a, x) => a + x[1], 0);
    bar.innerHTML = p.phases.map((x) => `<i class="r-${x[0]}" style="flex:${x[1] / cycle}"></i>`).join("");
    const ok = cycle >= CUSTOM_MIN_CYCLE;
    note.textContent = ok
      ? `${cycle}s a cycle \u00b7 about ${(60 / cycle).toFixed(1)} breaths a minute.`
        + (prefs.custom.out < prefs.custom.in ? " An exhale longer than the inhale settles you faster." : "")
      : `Too quick \u2014 a cycle has to run at least ${CUSTOM_MIN_CYCLE} seconds. Lengthen the inhale or the exhale.`;
    note.classList.toggle("warn-note", !ok);
    go.disabled = !ok;
    paintCustomSummary();
  };

  [["in", "Inhale", CUSTOM_MIN_BREATH], ["hold", "Hold", 0],
   ["out", "Exhale", CUSTOM_MIN_BREATH], ["holdOut", "Hold after", 0]].forEach(([key, label, min]) => {
    const cap = document.createElement("div");
    cap.className = "cap"; cap.textContent = label;
    const row = document.createElement("div");
    row.className = "row";
    const slider = document.createElement("input");
    slider.type = "range"; slider.min = min; slider.max = CUSTOM_MAX; slider.step = 0.5;
    slider.value = prefs.custom[key];
    slider.setAttribute("aria-label", `${label} seconds`);
    const val = document.createElement("span");
    val.className = "slider-val";
    val.textContent = `${prefs.custom[key]}s`;
    slider.oninput = () => {
      prefs.custom[key] = clamp(slider.value, min, CUSTOM_MAX);
      val.textContent = `${prefs.custom[key]}s`;
      savePrefs(); sync();
    };
    row.append(slider, val);
    panel.append(cap, row);
  });

  name.oninput = () => { prefs.custom.name = name.value; savePrefs(); sync(); };
  go.onclick = () => { const p = customPattern(); if (!go.disabled) openSession(p); };

  panel.append(bar, note, go);
  sync();
  return panel;
}

function testSound() {
  claimAudioSession();
  audio();
  keepAudio.play().catch(() => {});
  carrierOn();
  loadVoice(prefs.voice);
  setTimeout(() => {
    if (prefs.tone === "ocean") swell(300, 880, 4.0, Math.max(0.25, prefs.vol * 0.75));
    else if (prefs.tone === "hum") glide(196, 233, 4.0, Math.max(0.06, prefs.vol * 0.17));
    playClip("inhale");
  }, 300);
  setTimeout(() => {
    if (prefs.tone === "ocean") swell(880, 300, 4.4, Math.max(0.25, prefs.vol * 0.75));
    else if (prefs.tone === "hum") glide(233, 196, 4.4, Math.max(0.06, prefs.vol * 0.17));
    playClip("exhale");
  }, 4700);
  /* Only tidy up if no session started meanwhile — this used to kill the
     carrier out from under a session begun within 10s of a test, leaving the
     link to go dormant for the whole drive. It also left the keep-alive
     looping forever, holding the media session with nothing playing. */
  setTimeout(paintDiag, 600);
  setTimeout(() => {
    if (running) return;
    carrierOff();
    try { keepAudio.pause(); } catch (e) {}
  }, 9500);
}

/* ── home list ────────────────────────────────────────────────── */
(function buildPatterns() {
  const wrap = $("patterns");
  PATTERNS.forEach((p) => {
    const total = p.phases.reduce((a, x) => a + x[1], 0);
    const b = document.createElement("button");
    b.className = "card";
    b.innerHTML = `
      <span class="card-head">
        <span class="card-name"></span>
        <span class="card-rhythm"></span>
      </span>
      <span class="card-alt"></span>
      <span class="card-use"></span>
      <span class="rhythm">${p.phases.map((x) => `<i class="r-${x[0]}" style="flex:${x[1] / total}"></i>`).join("")}</span>`;
    b.querySelector(".card-name").textContent = p.name;
    b.querySelector(".card-rhythm").textContent = p.phases.map((x) => x[1]).join(" \u00b7 ");
    b.querySelector(".card-alt").textContent = p.alt;
    b.querySelector(".card-use").textContent = p.use;
    b.onclick = () => openSession(p);
    wrap.appendChild(b);
  });
})();

function renderDurations() {
  const row = $("durations");
  row.innerHTML = "";
  DURATIONS.forEach((m) => {
    const b = document.createElement("button");
    b.className = "seg";
    b.style.fontFamily = "var(--mono)";
    b.textContent = m === 0 ? "\u221e" : `${m}m`;
    b.setAttribute("aria-pressed", String(prefs.minutes === m));
    b.onclick = () => { prefs.minutes = m; savePrefs(); renderPanels(); soundChanged(); };
    row.appendChild(b);
  });
  const gear = document.createElement("button");
  gear.className = "icon-btn";
  gear.setAttribute("aria-label", "Sound settings");
  gear.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10.09 3V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
  gear.onclick = () => {
    const slot = $("soundSession");
    slot.hidden = !slot.hidden;
    $("whyLine").hidden = !slot.hidden;
    renderPanels();
  };
  row.appendChild(gear);
}

/* ── navigation ───────────────────────────────────────────────── */
function openSession(p) {
  pattern = p;
  $("home").hidden = true;
  $("session").hidden = false;
  $("stageName").textContent = p.name;
  $("whyLine").textContent = p.why;
  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: `${p.name} · ${p.alt}`, artist: "Breath Easy",
        album: prefs.minutes > 0 ? `${prefs.minutes} minutes` : "Open ended",
      });
      navigator.mediaSession.setActionHandler("play", () => { if (!running) start(); });
      navigator.mediaSession.setActionHandler("pause", () => { if (running) stop(false); });
    } catch (e) {}
  }
  stop(false);
  renderDurations();
  try { window.scrollTo(0, 0); } catch (e) {}
}

$("back").onclick = () => { stop(false); $("session").hidden = true; $("home").hidden = false; };
$("stage").onclick = () => (running ? stop(false) : start());
$("soundToggle").onclick = () => {
  const slot = $("soundHome");
  slot.hidden = !slot.hidden;
  $("soundToggle").setAttribute("aria-expanded", String(!slot.hidden));
  renderPanels();
};
$("customToggle").onclick = () => {
  const slot = $("customPanel");
  slot.hidden = !slot.hidden;
  $("customToggle").setAttribute("aria-expanded", String(!slot.hidden));
  if (!slot.hidden) { slot.innerHTML = ""; slot.appendChild(buildCustom()); }
};

/* Coming back from another app is the likeliest moment for the context to
   have been suspended or interrupted out from under the session. */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && running) { holdScreen(); guardAudio(); pump(); }
});
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !$("session").hidden) { e.preventDefault(); running ? stop(false) : start(); }
});

renderPanels();
stop(false);

/* A new worker claims the page as soon as it activates, but the page it
   claims is still running the old code — so reload once to pick it up. Never
   mid-session: a reload would cut the cues with the car still moving. */
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading || running) return;
    reloading = true;
    location.reload();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || running) return;
    navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
      .then((reg) => reg.update())
      .catch(() => {});
  });
}
