# Awalé promo film

A 30-second product film for Awalé, drawn live in a web page, with an export
panel that writes it out as a video file.

Open `promo/index.html` in a desktop browser. No build, no server, no network:
double-clicking the file works. Chrome and Edge export fastest; Firefox and
Safari work too.

## The film

| Time | Chapter | What it says |
| --- | --- | --- |
| 0–4 s | Hook | One seed falls, 47 more pour into the board. *48 seeds. 12 pits. One winner.* |
| 4–7 s | Title | AWALÉ, and the app's own tagline. |
| 7–14 s | Rules | *Sow. Capture. First to 25 wins.* — played out on a real game (below). |
| 14–16 s | AI | Four levels, Novice to Master. |
| 16–19 s | Online | Matches crossing a globe; nation points and a Côte d'Ivoire – France head to head. |
| 19–21 s | Ranks | The leaderboard. |
| 21–23 s | Learn | Move preview, hints, the 12 challenges. |
| 23–26 s | Anywhere | Laptop and phone; browser, installable, offline, English and French. |
| 26–30 s | Play | Logo, *Play now* and the web address. |

The match in the rules chapter is a real game, found with the app's own engine
and AI (`src/lib/engine.ts`, `src/lib/ai.ts`) and replayed in `film.js` with the
same sowing and capture rules: South wins 26–0 in 13 moves, the last one a
five-pit chain capture. The move list is `GAME` in `film.js`.

The leaderboard names and ratings are sample data, not real players.

The soundtrack uses the game's own sample pack (`public/sounds/v1`): the djembe
loop at 120 bpm, seed drops, scoops, the tap and the victory sting, plus a few
synthesised plucks, booms and whooshes. Scene changes sit on the beat.

## Export options

- **Frame**: 16:9 (YouTube), 9:16 (Reels, TikTok, Shorts), 1:1 and 4:5 (feeds).
  The layout is recomposed for each shape, not cropped: in 9:16 the board stands
  upright, as it does in the app on a phone.
- **Language**: English or French.
- **Web address** shown on the end card.
- **Format**: MP4 or WebM.
- **Resolution**: 480p to 4K (the short side of the frame).
- **Frame rate**: 24, 25, 30, 50 or 60.
- **Quality**: Draft to Master (bitrate scales with size and frame rate).
- **Soundtrack** on or off.
- **PNG** saves the current frame at export size (a thumbnail or poster).

Export renders every frame one by one at the exact size and rate, then encodes
with WebCodecs, so a slow machine takes longer but never drops a frame. The
panel shows which codec this browser will use:

| Format | Video, in order of preference | Audio |
| --- | --- | --- |
| MP4 | H.264 → AV1 → VP9 | AAC → Opus |
| WebM | VP9 → VP8 → AV1 | Opus |

Chrome and Edge on Windows and macOS give H.264 + AAC, which every player and
social network accepts. Some Linux builds of Chromium have no H.264 encoder; the
MP4 is then AV1 or VP9, which modern browsers and VLC play but some editors do
not. In that case, export WebM and convert it, for example:

```bash
ffmpeg -i awale-promo.webm -c:v libx264 -crf 17 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart awale-promo.mp4
```

A browser without WebCodecs falls back to recording the canvas in real time
(MediaRecorder); the panel says so.

URL parameters, handy for links and scripts: `?aspect=9x16&lang=fr&t=12.5&play`.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The studio page: preview player and export panel |
| `film.js` | The film. `render(ctx, t)` draws the frame at `t` seconds and keeps no state between frames |
| `export.js` | WebCodecs encoding, plus the MP4 and WebM muxers (no library) |
| `studio.js` | Player, settings and export wiring |
| `assets/` | Generated data: fonts, sounds, world map. Rebuild with `tools/build-assets.mjs` |

Everything is a classic script (no ES modules), because browsers refuse to load
modules from `file://`. For the same reason fonts, sounds and the map ship as
JavaScript data files rather than being fetched.

Fonts: Cormorant Garamond and Manrope, SIL Open Font License 1.1 (licences in
`assets/`). Map: Natural Earth 1:110m land, public domain, via `world-atlas`.
