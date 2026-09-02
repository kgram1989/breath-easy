# Breath Easy

Eyes-free breathing exercises for the car. A soft wash of sound brightens across the whole inhale and darkens across the whole exhale, and a voice calls each turn — so you start it, put the phone down, and keep your eyes on the road.

No framework, no build step, no dependencies. Works offline once loaded. Nothing is sent anywhere.

## Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "Breath Easy: eyes-free breathing for the car"
git branch -M main
git remote add origin https://github.com/<you>/breath-easy.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Source: Deploy from a branch → `main` / `root`**. It goes live at `https://<you>.github.io/breath-easy/` in a minute or two.

Pages serves over HTTPS, which the service worker and screen wake lock both require.

## Add it to your Home Screen

Worth doing, and not just for the shortcut. Opened from the Home Screen the page runs standalone rather than inside a browser tab, which is what lets `navigator.wakeLock` hold the screen properly. It also works with no signal.

- **iPhone** — open in Safari, Share, Add to Home Screen
- **Android** — Chrome menu, Add to Home screen

## Patterns

Patterns are named for the situation you're in, not the count you're keeping — at speed you know what you need, not how many seconds it takes. The technique's own name sits under it on the card, and the list is ordered by urgency, so the two you grab for mid-drive need no scrolling.

| Name | Technique | Rhythm | For |
|---|---|---|---|
| Relax | Coherent | 5.5 · 5.5 | Baseline calm; the HRV resonance rate |
| Focus | Box | 4 · 4 · 4 · 4 | Alert focus without drowsiness |
| Unwind | Long Exhale | 4 · 6 | Fastest wind-down |
| Reset | Physiological Sigh | 1.5 · 1 · 5 · 1 | Acute stress, two or three rounds |
| Gentle Hold | Triangle | 4 · 4 · 4 | A gentler box |
| Deep Calm | 4 · 7 · 8 | 4 · 7 · 8 | Deep wind-down |
| Recover | Pursed Lip | 2 · 4 | Breathlessness |
| Slow Down | Slow Six | 6 · 6 | Once 5.5 feels easy |

### Deliberately excluded

Wim Hof rounds, breath of fire and kapalabhati, Buteyko air-hunger holds, any retention past about ten seconds, and alternate-nostril breathing. The first four can cause transient hypocapnia — tunnel vision and grey-out are documented — which is unacceptable at speed. The last one needs a hand off the wheel. Nothing shipped holds the breath longer than seven seconds.

## How the audio works

Everything is synthesised in the browser except the voice clips.

- **Ocean** (default) is brown noise through a bandpass that sweeps 300→880 Hz on the inhale and back on the exhale. Noise rather than a tone, because pure tones are what alarms are made of. Level is scaled ×4.4 to compensate for bandpass loss, so it matches Hum in loudness.
- **Hum** is a low sine pair near 196 Hz moving a minor third, for cabins too noisy for the noise cue.
- Every cue uses a raised-cosine envelope and runs about 90% of its phase, so nothing has an onset to flinch at.
- Voice clips are Piper neural TTS at 22.05 kHz. `audio/soft` is `en_GB-jenny_dioco-medium`; `audio/warm` is `en_US-libritts_r-medium`.

### Getting sound into a car stereo

Two problems that aren't obvious:

1. Web Audio on its own often isn't classified as *media*, so the phone plays it locally instead of handing it to Bluetooth or CarPlay. A silent looping `<audio>` element claims the media session and fixes the routing. It also publishes Media Session metadata, so the head unit shows the track and the steering-wheel controls work.
2. Bluetooth A2DP goes dormant between sounds and swallows the front of short cues. An inaudible 32 Hz carrier runs for the whole session to hold the link open.

### Keeping the screen on

`navigator.wakeLock` is tried first. Where it's unavailable, a 2-pixel canvas is fed through `captureStream()` into an off-screen `<video>` — phones won't sleep while video is playing. The session screen reports which one is active, so it can't fail silently.

## Layout

`index.html` is the markup, `styles.css` the styling, `app.js` the whole engine (patterns, audio, gauge, screen hold). `sw.js` caches everything for offline use. Preferences persist in `localStorage`.

## Licence

MIT. Not medical advice.
