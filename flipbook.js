/*
  Flipbook Scroll: the strip.

  An endless row of photographs, the frames of one moment, on a heavy strip you push sideways. Scroll slowly and
  they're single pictures sliding by. Push it faster and faster and the moment starts to play, the way a flipbook does.

  Nothing about it is faked: the strip just moves, and it's drawn at every screen refresh, always. A flipbook works
  because each page lands where the last one was. A screen does the same on its own when the strip travels exactly
  one card between refreshes: every place on the screen gets the next card each time, so each picture stands still
  and plays. That speed is the strip's top speed, its one guardrail, so pushing as hard as you like lands right on it.
  On the way up you see what a camera would: the pictures blur, seem to drift backwards like wagon wheels on film,
  drift slower and slower, and stand still, playing.

  So that the moment plays at its own length, each frame fills as many cards in a row as the screen refreshes per
  frame of the clip: 4 for a 30-a-second clip on a 120 Hz screen, 2 at 60 Hz.

  At top speed the strip's speed is trimmed by under 1%, so the frames standing there drift to the middle over a
  second or so rather than standing wherever they happened to land. That's the only help it gets (CENTER).

  It has weight: a scroll pushes it, it doesn't move it. It gets going slowly, winds up into top speed over the last
  stretch, and every start and stop eases. While it's being pushed it holds its speed; once let go, friction rises
  over half a second, like a hand coming off a wheel, and it comes to a definite stop. Pushing the other way brakes
  it, but only so hard.

  Strip(options) is the motion alone, with no page; mount(element, options) draws it into a canvas across `element`,
  only as tall as the strip, and returns a small controller.
*/
(function () {
  "use strict";

  const FADE = { out: 450, in: 750, across: 520 }; // ms: all out together; each in; the last card's start after the first's
  const STEP = 1 / 240; // s, the longest physics step; each screen refresh is split into equal steps no longer
  const LOW = 0.45; // s, how long a push lasts at low speed
  const BRAKE = 0.3; // s, the same while you hold it still
  const BREAKAWAY = 0.5; // a push from rest counts for this much, rising to all of it once it's moving
  const REACH = 5500; // px of scrolling that would take it from rest to top speed, if nothing slowed it
  const GRIP = [0.02, 0.14]; // a steady drag, as a share of top speed lost each second: while pushing, once let go
  const LET_GO = [0.35, 0.9]; // s since the last push over which friction rises from the first to the second
  const RELEASED = 0.25; // once let go, how long it coasts compared with while it's being pushed
  const STILL = 10; // px a second: slower than this, with nothing pushing, it stops
  const DRAG = 6; // how much more a px of dragging (on a touch screen) counts than a px of scrolling
  const WINDUP = 0.35; // near top speed a push counts for this much less, so the last stretch builds slowly
  const OVER = 1.2; // how far past top speed a push can try to drive it; the cap holds it at top speed meanwhile
  const KNEE = 0.94; // from this share of top speed it bends smoothly into the cap, reaching it exactly at 2 - KNEE
  const CENTER = 1.2; // 1/s, how quickly frames standing at top speed drift to the middle; 0 leaves them be
  const TRIM = 0.008; // the most the strip's speed is trimmed for it, as a share of top speed

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const smooth = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const mod = (n, m) => ((n % m) + m) % m;
  // The cap, as a share of top speed: straight up to KNEE, then curving smoothly to exactly 1, and flat beyond
  const capped = (u) => (u < KNEE ? u : u < 2 - KNEE ? u - (u - KNEE) ** 2 / (4 * (1 - KNEE)) : 1);
  const sign = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);

  const DEFAULTS = {
    mode: "play", // "play": you drive it. "card": it drives itself, for the lab's overview card
    weight: 0.8, // s for the strip to answer most of a push; the higher, the heavier
    coast: 4, // s it takes to lose most of its speed when it's going fast and being pushed
    push: 1, // how much a scroll adds
    resist: 0.5, // how much a scroll against it counts, as a brake
    stopIn: 0.9, // s, the fastest pushing against it can stop it from top speed
    size: 0.58, // a frame's height, as a share of the element's
    gap: 6, // px between frames
    middle: 0.47, // where the strip sits, as a share of the element's height
    across: 0, // at least this many frames fit across; 0 picks for the screen
    onPlaying: null, // called once, the first time the moment plays
  };

  // The motion: where the strip is and how fast it's going
  function Strip(options) {
    const o = { ...DEFAULTS, ...options };
    let pitch = 1; // px from one frame to the next
    let hz = 60; // the screen's refreshes a second
    let x = 0; // px travelled; positive moves the strip left, on to later frames
    let v = 0; // px a second it's being driven at; it moves at that, capped
    let a = 0; // px a second, a second
    let drive = 0; // the speed it's being pushed toward
    let braking = false; // held still under a pointer
    let brakeLeft = 0; // speed still to take off, from pushing against it
    let clock = 0;
    let lastPush = -Infinity;
    let fast = 0;
    let played = false;

    // One frame per screen refresh
    const top = () => pitch * hz;

    function push(px) {
      if (!px) return;
      const t = top();
      const r = Math.abs(v) / t;
      // Effort is the same at any size: so many px of scrolling for top speed, whatever top speed is in px.
      // From rest it's heavy to get going; near top speed it winds up slowly into it.
      const gain =
        ((o.push * t) / REACH) * (BREAKAWAY + (1 - BREAKAWAY) * smooth(0, 0.3, r)) * (1 - WINDUP * smooth(0.5, 1, r));
      lastPush = clock;
      if (drive && sign(px) !== sign(drive)) {
        // Against it: a brake, used up gradually
        brakeLeft = Math.min(Math.abs(drive), brakeLeft + Math.abs(px) * gain * o.resist);
      } else {
        drive = clamp(drive + px * gain, -OVER * t, OVER * t);
        brakeLeft = 0;
      }
    }

    // The card's own motion: pushed up to top speed for a few seconds, then let go
    const piloted = () => o.mode === "card" && clock % 10 >= 1.6 && clock % 10 < 4.8;

    function physics(dt, trim) {
      const t = top();
      const pinned = piloted();
      if (pinned) drive = OVER * t;

      if (brakeLeft > 0) {
        const take = Math.min(brakeLeft, (t / o.stopIn) * dt);
        brakeLeft -= take;
        drive = sign(drive) * Math.max(0, Math.abs(drive) - take);
        if (!drive) brakeLeft = 0;
      }

      // Friction: it holds its speed longer the faster it goes, and longer while it's being pushed than once it's let
      // go, like a hand coming off a wheel. A steady drag on top brings it to a definite stop rather than a creep.
      if (pinned) lastPush = clock;
      const free = smooth(LET_GO[0], LET_GO[1], clock - lastPush);
      const coast = o.coast * (1 + (RELEASED - 1) * free);
      const tau = braking ? BRAKE : LOW + (Math.max(coast, LOW) - LOW) * smooth(0.05, 0.6, Math.abs(drive) / t);
      if (!pinned) {
        drive *= Math.exp(-dt / tau);
        const grip = GRIP[0] + (GRIP[1] - GRIP[0]) * free;
        drive = sign(drive) * Math.max(0, Math.abs(drive) - grip * t * dt);
      }
      drive = clamp(drive, -OVER * t, OVER * t);

      // Mass: the strip follows the push, critically damped, so it eases in and out and never overshoots
      const w = 3.9 / o.weight;
      a += (w * w * (drive - v) - 2 * w * a) * dt;
      v += a * dt;
      if (!drive && Math.abs(v) < STILL) v = a = 0;

      // It moves at that, up to the cap: exactly one frame per refresh, however hard it's pushed
      const speed = capped(Math.abs(v) / t);
      x += (sign(v) * speed * t + trim) * dt;
      clock += dt;

      // The first time the moment plays, for a little while, say so
      fast = speed > 0.999 ? fast + dt : 0;
      if (!played && fast > 0.3) {
        played = true;
        o.onPlaying?.();
      }
    }

    // One screen refresh: `dt` s, in equal steps
    function advance(dt) {
      const t = top();
      // At top speed every refresh lands the strip a whole frame on, so wherever the frames stand, they stay. The
      // trim moves them toward the middle, a px or two a refresh, by speeding or slowing the strip a hair.
      let trim = 0;
      const near = smooth(0.99, 0.999, capped(Math.abs(v) / t));
      if (near && CENTER) {
        const off = x - Math.round(x / pitch) * pitch;
        trim = clamp(-CENTER * off, -TRIM * t, TRIM * t) * near;
      }
      const steps = Math.ceil(dt / STEP);
      for (let i = 0; i < steps; i++) physics(dt / steps, trim);
    }

    return {
      o,
      push,
      advance,
      shown: () => x,
      brake(on) {
        braking = on;
      },
      setHz(next) {
        hz = next;
      },
      setPitch(next) {
        if (pitch > 1) {
          const s = next / pitch;
          x *= s;
          v *= s;
          a *= s;
          drive *= s;
          brakeLeft *= s;
        }
        pitch = next;
      },
      // Keeps the numbers small without moving which frame is where
      wrap(loop) {
        if (Math.abs(x) < loop * 1000) return;
        x -= Math.trunc(x / loop) * loop;
      },
      // Stretches where it is by `k`, for a change in how many cards each frame fills
      rescale(k) {
        x *= k;
      },
      jump(index) {
        x = index * pitch;
        v = a = drive = brakeLeft = 0;
      },
      state() {
        const speed = capped(Math.abs(v) / top());
        return { speed, index: Math.round(x / pitch), x, v: sign(v) * speed * top(), pitch, hz };
      },
    };
  }

  function mount(root, options) {
    const strip = Strip(options);
    const o = strip.o;
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;left:0;width:100%;display:block";
    root.appendChild(canvas);
    const g = canvas.getContext("2d");

    let W = 0, H = 0, dpr = 1;
    let frameW = 0, frameH = 0, pitch = 1, left = 0;
    let then = null;
    let reel = null; // the video's frames (frames.js)
    let hold = 1; // cards each frame fills
    let unready = 0; // refreshes drawn before every card's frame was decoded
    // Coming and going: "out" fades every card together, "hidden" shows none, "in" fades each card in a beat after
    // the one to its left; null is fully shown
    let veil = { kind: "hidden", start: 0 };
    let veiled = null; // resolves when an "out" finishes
    let drawn = NaN;
    let dirty = true;
    let raf = 0;
    const gaps = [];
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");

    const hz = () => {
      if (gaps.length < 10) return 60;
      const sorted = [...gaps].sort((p, q) => p - q);
      return clamp(Math.round(1 / sorted[sorted.length >> 1]), 30, 240);
    };

    // At top speed a card passes every refresh, so for the moment to play at its own speed, each frame fills as many
    // cards as there are refreshes to one of its frames: 4 for a 30-a-second clip on a 120 Hz screen, 2 at 60 Hz.
    // Changed only while the strip is still (or before anything shows), keeping the same frame in the middle.
    function fitHold(rate) {
      if (!reel) return;
      const want = Math.max(1, Math.round(rate / reel.fps));
      if (want === hold || strip.state().speed > 0.001) return;
      strip.rescale(want / hold);
      hold = want;
      dirty = true;
    }

    const sizeOf = (img) => [img.naturalWidth || img.videoWidth || img.width, img.naturalHeight || img.videoHeight || img.height];

    // A frame's size for a given shape: as tall as `size` allows, but with a few frames in view, at least a frame and
    // a half on a phone and a little over two otherwise
    function frameFor(aspect) {
      let h = Math.round(H * o.size);
      let w = Math.round(h * aspect);
      const widest = W / (o.across || (W < 700 ? 1.5 : 2.2));
      if (w > widest) {
        w = Math.round(widest);
        h = Math.round(w / aspect);
      }
      return [w, h];
    }

    function layout() {
      const box = root.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = box.width;
      H = box.height;
      [frameW, frameH] = frameFor(reel ? reel.aspect : 16 / 9);
      pitch = frameW + o.gap;
      strip.setPitch(pitch);
      left = (W - frameW) / 2; // the frame in the middle
      // The canvas covers only the strip, so each refresh redraws as little as it can
      canvas.style.top = `${Math.round(H * o.middle - frameH / 2)}px`;
      canvas.style.height = `${frameH}px`;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(frameH * dpr);
      dirty = true;
    }

    // Draws a picture filling the frame, cropping what doesn't fit
    function cover(img, dx) {
      const [sw, sh] = sizeOf(img);
      const scale = Math.max(frameW / sw, frameH / sh);
      const cw = frameW / scale;
      const ch = frameH / scale;
      g.drawImage(img, (sw - cw) / 2, (sh - ch) / 2, cw, ch, dx, 0, frameW, frameH);
    }

    // Which frame a card shows: each frame fills `hold` cards in a row
    const frameAt = (card) => Math.floor(mod(card, reel.count * hold) / hold);

    const gently = (t) => t * t * (3 - 2 * t);

    // How much of a card at `dx` px from the left shows, `t` ms into the veil
    function shownOf(dx, t) {
      if (!veil) return 1;
      if (veil.kind === "hidden") return 0;
      if (veil.kind === "out") return 1 - gently(clamp(t / FADE.out, 0, 1));
      return gently(clamp((t - clamp(dx / W, 0, 1) * FADE.across) / FADE.in, 0, 1));
    }

    // Returns whether every card had its frame decoded
    function draw(at, now) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, frameH);
      if (!reel) return true;
      let whole = true;
      const t = now - (veil?.start ?? 0);
      const first = Math.floor(at / pitch);
      const offset = at - first * pitch;
      const before = Math.ceil(left / pitch) + 1;
      for (let k = -before; left - offset + k * pitch < W; k++) {
        const dx = left - offset + k * pitch;
        const shown = shownOf(dx, t);
        if (shown <= 0) continue;
        const img = reel.get(frameAt(first + k));
        if (!img) {
          whole = false;
          continue;
        }
        g.globalAlpha = shown;
        cover(img, dx);
      }
      g.globalAlpha = 1;
      return whole;
    }

    // Moves the veil on: an "out" that's done becomes "hidden", an "in" that's done goes away
    function lift(now) {
      if (!veil || veil.kind === "hidden") return false;
      const t = now - veil.start;
      if (veil.kind === "out" && t >= FADE.out) {
        veil = { kind: "hidden", start: now };
        veiled?.();
        veiled = null;
        return true;
      }
      if (veil.kind === "in" && t >= FADE.across + FADE.in) {
        veil = null;
        return true;
      }
      return true;
    }

    function tick(now) {
      let dt = then === null ? 0 : Math.min(0.1, (now - then) / 1000);
      then = now;
      if (dt > 0) {
        gaps.push(dt);
        if (gaps.length > 40) gaps.shift();
        // Top speed is one frame per refresh, so the strip needs the screen's rate, and every ordinary refresh counted
        // as exactly one refresh long: then each moves it exactly as far as the last, and at top speed exactly one
        // frame. A refresh the screen skipped still counts for the time it took.
        const rate = hz();
        strip.setHz(rate);
        if (Math.abs(dt * rate - 1) < 0.25) dt = 1 / rate;
        fitHold(rate);
        if (!(o.mode === "card" && reduced.matches)) strip.advance(dt);
      }
      if (reel) strip.wrap(pitch * reel.count * hold);
      const at = strip.shown();
      const fading = lift(now);
      if (dirty || fading || at !== drawn) {
        dirty = !draw(at, now); // keep redrawing until every card's frame has been decoded
        if (dirty) unready++;
        drawn = at;
      }
      if (reel) reel.want(frameAt(Math.round(at / pitch)), Math.sign(strip.state().v));
      raf = requestAnimationFrame(tick);
    }

    // Input, only when it's yours to drive
    const listeners = [];
    const on = (target, name, fn, opts) => {
      target.addEventListener(name, fn, opts);
      listeners.push(() => target.removeEventListener(name, fn, opts));
    };

    if (o.mode !== "card") {
      on(
        root,
        "wheel",
        (e) => {
          if (e.ctrlKey) return; // pinch zoom
          e.preventDefault();
          const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? W : 1;
          const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
          strip.push(d * unit);
        },
        { passive: false },
      );

      // On a touch screen, dragging pushes it the way a flick of a thumb would; holding still while pressed brakes it,
      // gently. With a mouse it's scrolling only (Noah, Nov 14: "remove the dragability on desktop ... that should only
      // be happening on mobile when there's no other choice")
      let pointer = null;
      let stillTimer = 0;
      on(root, "pointerdown", (e) => {
        if (e.pointerType === "mouse" || e.button !== 0) return;
        pointer = { id: e.pointerId, x: e.clientX };
        root.setPointerCapture(e.pointerId);
        strip.brake(true);
      });
      on(root, "pointermove", (e) => {
        if (!pointer || e.pointerId !== pointer.id) return;
        const dx = e.clientX - pointer.x;
        pointer.x = e.clientX;
        if (!dx) return;
        strip.brake(false);
        // A trackpad swipe scrolls thousands of px, momentum and all; a finger across a phone, a few hundred, and
        // nothing once it lifts. So a drag counts for more, enough that hard swipes reach top speed in about 3 s
        strip.push(-dx * DRAG);
        clearTimeout(stillTimer);
        stillTimer = setTimeout(() => {
          if (pointer) strip.brake(true);
        }, 90);
      });
      const up = (e) => {
        if (!pointer || e.pointerId !== pointer.id) return;
        pointer = null;
        strip.brake(false);
        clearTimeout(stillTimer);
      };
      on(root, "pointerup", up);
      on(root, "pointercancel", up);

      on(window, "keydown", (e) => {
        if (e.defaultPrevented || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
        if (e.key === "ArrowRight") strip.push(pitch * 0.9);
        if (e.key === "ArrowLeft") strip.push(-pitch * 0.9);
      });
    }

    const resize = new ResizeObserver(layout);
    resize.observe(root);
    layout();
    raf = requestAnimationFrame(tick);

    return {
      set(next) {
        const sized = ["size", "gap", "middle"].some((k) => k in next && next[k] !== o[k]);
        Object.assign(o, next);
        if (sized) layout();
        dirty = true;
      },
      // Shows a video's frames (from FlipbookFrames.openVideo), from frame `at`, or the same frame number as near as
      // it can
      setReel(next, at) {
        const index = at ?? (reel ? frameAt(strip.state().index) : 0);
        reel = next;
        hold = Math.max(1, Math.round(hz() / reel.fps));
        layout();
        strip.jump(mod(index, reel.count) * hold);
        dirty = true;
      },
      state() {
        return { ...strip.state(), hz: hz(), frames: reel ? reel.count : 0, hold, unready, veil: veil?.kind ?? null };
      },
      // Fades every card out together; resolves once they're gone
      conceal() {
        if (veil?.kind === "hidden") return Promise.resolve();
        veiled?.(); // an earlier one waiting gives way to this
        veil = { kind: "out", start: performance.now() };
        return new Promise((resolve) => (veiled = resolve));
      },
      // Fades the cards in, each a beat after the one to its left
      reveal() {
        veil = { kind: "in", start: performance.now() };
      },
      // The most device px across a frame of this shape will be drawn at, to load frames at no more than that
      widthFor(aspect) {
        return frameFor(aspect)[0] * dpr;
      },
      destroy() {
        cancelAnimationFrame(raf);
        resize.disconnect();
        listeners.forEach((off) => off());
        canvas.remove();
      },
    };
  }

  window.FlipbookScroll = { mount, Strip };
})();
