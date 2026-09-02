# Breath Easy

Eyes-free breathing cues for driving. Static site: `index.html`, `styles.css`, `app.js`. No framework, no build step, no runtime dependencies. Open `index.html` and it runs.

## Commands

```bash
npm run dev     # serve at localhost:8000 (audio and service worker need a server, not file://)
npm test        # jsdom smoke test — run before every commit
npm run voices  # regenerate voice clips (needs piper + ffmpeg; see tools/build-voices.sh)
```

## Layout

| Path | What |
|---|---|
| `app.js` | Everything: patterns, audio engine, gauge, screen hold, UI |
| `styles.css` | Night-dashboard theme, amber on near-black |
| `audio/soft/`, `audio/warm/` | Six voice clips per voice, 22.05 kHz mono MP3 |
| `sw.js` | Service worker: shell network-first, media cache-first; **update `MEDIA_ASSETS` when adding files** |
| `test/dom.test.cjs` | Loads the real page in jsdom and clicks through it |

## Constraints that took a long time to get right

Do not "simplify" these. Each one is load-bearing and the failure mode is silent.

**Gauge arc flag.** The dial sweeps 270°, so SVG's large-arc-flag must flip at `value > 2/3`, not `> 0.5`. With `0.5` the arc snaps the wrong way round between 50% and 67% of every breath.

**Cues are noise, not tones.** Pure sines read as alarms — this was tested and rejected by the user twice. Ocean is brown noise through a bandpass sweeping 300→880 Hz. Peak gain is scaled ×4.4 because the bandpass costs that much level; that constant is measured, not guessed. Hum exists only for cabins too noisy for the noise cue.

**Every envelope is a raised cosine.** No attack, no onset. A cue must become audible, not start. Cues run ~90% of their phase.

**No per-second ticking during holds.** A metronome under a breath hold is the opposite of calming.

**Silent looping `<audio>` element.** Not decoration. Web Audio alone often isn't classified as media, so phones play it locally instead of routing to Bluetooth or CarPlay. This element claims the media session.

**A dead AudioContext must be rebuilt, not resumed.** iOS parks the context in `interrupted` after a call, Siri, or another app claiming the audio session, and Android can leave it suspended after losing audio focus; `resume()` frequently will not recover either. The context is therefore rebuilt after two failed guard ticks, or immediately on `interrupted`. This was a real bug: cues died mid-drive and the only cure was closing and reopening the app, because `ctx` was only ever assigned when null. Two things the rebuild depends on — build the replacement *before* closing the old one, or a cue landing mid-rebuild builds a stray context that gets orphaned; and keep the encoded mp3 bytes in memory, because decoded buffers die with their context and re-decoding must work with no signal (`decodeAudioData` detaches what you hand it, so it gets a copy). Sound state is reported next to the screen-hold line for the same reason screen-hold is.

**Inaudible 32 Hz carrier during sessions.** Bluetooth A2DP goes dormant between sounds and swallows the front of short cues. The carrier holds the link open.

**The shell is never cache-first.** A service worker only reinstalls when its own bytes change, so a cache-first handler over `index.html` and `app.js` pins the app to the first build that ever loaded — and neither reloading nor a new tab can break out, because the worker is what answers them. This shipped once and took a while to spot, because every local check with the worker unregistered looked perfect. `index.html`, `app.js`, `styles.css` and the manifest go network-first with a cache fallback; only `audio/` and `icons/`, which never change once shipped, are cache-first. The shell fetch also passes `cache: "no-cache"`, because Pages serves it with a ten-minute max-age.

**Screen hold has two strategies.** `navigator.wakeLock` first; a canvas `captureStream()` fed to an off-screen `<video>` as fallback. Report which is active in the UI — an earlier version failed silently and the bug went unnoticed for days.

**Breath-safety.** No pattern may hold longer than ~10 seconds, use rapid or forced breathing, or need a hand off the wheel. Wim Hof, kapalabhati, and Buteyko holds are excluded on purpose — hypocapnia causes grey-out. If asked to add patterns, check them against this before writing code.

**The custom builder enforces breath-safety in code, not in the UI.** `CUSTOM_MAX` (10s) caps every slider, `CUSTOM_MIN_BREATH` (2s) floors the inhale and exhale, and `CUSTOM_MIN_CYCLE` (6s, the rate of the briskest shipped pattern) blocks Start outright. The cycle floor is the one that matters most — deep breathing at a fast rate is the grey-out path, and neither slider catches it alone. Because `localStorage` is user-editable, the same limits are re-clamped on load rather than trusted to the `min`/`max` attributes that wrote them. A custom pattern drops any hold set to zero instead of running a 0-second phase, which would churn the engine's catch-up loop.

## Conventions

- Vanilla JS, no dependencies in the shipped site. `jsdom` is dev-only.
- Timing comes from `performance.now()` in a `requestAnimationFrame` loop; repaint is throttled to ~32 ms. Never drive breathing timing from CSS transitions or `setInterval`.
- Colours come from CSS custom properties in `:root`; `app.js` keeps a small `COLOR` map for SVG only.
- Prefs persist in `localStorage` under the key `breatheasy`.
- Adding an audio file or icon means adding it to `sw.js` `MEDIA_ASSETS`, or it won't work offline.

## Testing

`npm test` renders the page in jsdom, asserts all eight patterns build, opens the settings panel, navigates into a session, and checks the gauge draws. It also verifies every `getElementById` target exists in the markup and every asset path exists on disk — those were real bugs, not hypothetical ones.

Web Audio and `captureStream` don't exist in jsdom, so audio paths are stubbed. Anything touching sound needs manual checking on a phone, connected to a car stereo, parked.
