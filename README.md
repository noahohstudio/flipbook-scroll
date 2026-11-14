# Flipbook Scroll

An endless strip of frames from a moment. Scroll it slowly and they're photographs. Push it faster and faster, and the moment plays, the way a flipbook does.

**[See it live](https://noahohstudio.github.io/flipbook-scroll/)** · from the lab at [noaoh.com](https://noaoh.com)

![Four frames from "Picking fruit with Erika"](preview.jpg)

## How it works

Nothing about the effect is faked. The strip just moves, and it's drawn at every screen refresh.

- **The screen is the flipbook.** A flipbook works because each page lands where the last one was. A screen does the same on its own when the strip travels exactly one card between refreshes: every spot on the screen gets the next card each time, so the pictures stand still and play. That speed is the strip's top speed, its one guardrail, so pushing as hard as you like lands right on it. On the way up you see what a camera would: the pictures blur, seem to drift backwards like wagon wheels on film, drift slower and slower, and stand still, playing.
- **At its own length.** At top speed a card passes every refresh, so each frame fills as many cards in a row as the screen refreshes per frame of the clip: 4 for a 30-frame-a-second clip on a 120 Hz screen, 2 at 60 Hz. The moment plays in exactly the time it was filmed in.
- **Weight.** A scroll pushes the strip; it doesn't move it. It's heavy to get going, winds up slowly into top speed, and every start and stop eases. While you're pushing it holds its speed; let go and friction rises over half a second, like a hand coming off a wheel. Pushing the other way brakes it, but only so hard.
- **Centered.** At top speed the strip's speed is trimmed by under 1%, so the standing frames drift to the middle of the screen. That's the only help it gets.
- **Smooth.** Frames are AVIF, downloaded up front but decoded just ahead of where the strip is going, at the size they're drawn, off the page's own thread. Each refresh moves the strip exactly as far as the last.

## Run it

It's plain HTML and JavaScript, with no build step and no dependencies. Serve the folder over HTTP (the page fetches its frames) and open it:

```
npx serve
```

or `python3 -m http.server`. `?video=rain` (or `rooftop`, `picking-fruit`, `hiking`) opens a given moment; `?mode=card` is the self-playing overview card.

## How the frames are made

```
node cut.mjs <clip> <key> "<Title>" [--from s] [--to s]
```

`cut.mjs` keeps every frame of a phone clip, turns phone HDR into ordinary color, encodes each frame as AVIF (AV1 at CRF 30 with variance boost, from lossless frames), writes them to `frames/<key>/`, and lists the clip in `frames/videos.js`. It needs ffmpeg built with libsvtav1.

## Files

- `index.html`: the page, and the menu of moments
- `flipbook.js`: the strip: its motion (`Strip`) and drawing (`mount`)
- `frames.js`: loads and decodes a moment's frames
- `cut.mjs`: cuts a clip into frames
- `frames/`: the moments

## License

The code is MIT licensed. The footage, the frames in `frames/` and the people in them, is © Noah Oh, all rights reserved, and isn't covered by that license. See [LICENSE](LICENSE).
