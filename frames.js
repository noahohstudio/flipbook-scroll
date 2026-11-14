/*
  Flipbook Scroll: the frames.

  Opens one of Noah's videos, as cut.mjs left it in frames/<key>/. Every frame is downloaded up front but kept
  compressed; only the ones near where the strip is are decoded, at the size they're drawn, a little ahead in the
  direction it's going, so nothing decodes on the spot and memory stays small however long the clip is.

  Frames are decoded from their downloaded bytes, which browsers do off the page's own thread, so decoding never
  holds up a screen refresh (AVIF is several times the work of a JPG to decode). Opened straight from disk, where a
  page can't fetch its own files, they're loaded as images instead, which some browsers decode on the page's thread.
*/
(function () {
  "use strict";

  const AHEAD = 30; // frames decoded ahead in the direction it's going (a second of a 30-a-second clip)
  const BEHIND = 8; // and behind
  const STILL = 12; // either side, when it's still
  const KEEP = 56; // the most kept decoded at once
  const AT_ONCE = 4; // decodes running at a time

  // `width` is the most px across a frame will be drawn at
  function openVideo(video, width) {
    const n = video.count;
    const w = Math.min(video.width, Math.ceil(width));
    const h = Math.round((w * video.height) / video.width);
    const src = (i) => `frames/${video.key}/${String(i + 1).padStart(video.digits, "0")}.${video.ext}`;
    const files = new Array(n); // compressed, as downloaded
    const decoded = new Map(); // frame -> ImageBitmap
    const queued = [];
    const busy = new Set();
    let center = 0;
    let closed = false;

    const ring = (i) => ((i % n) + n) % n;
    const apart = (i, j) => {
      const d = Math.abs(ring(i) - ring(j));
      return Math.min(d, n - d);
    };

    function pump() {
      while (!closed && busy.size < AT_ONCE && queued.length) {
        const i = queued.shift();
        if (decoded.has(i) || busy.has(i) || !files[i]) continue;
        busy.add(i);
        createImageBitmap(files[i], { resizeWidth: w, resizeHeight: h, resizeQuality: "high" })
          .then((bitmap) => {
            if (closed) return bitmap.close();
            decoded.set(i, bitmap);
            // Too many: let go of the ones furthest from where the strip is
            if (decoded.size > KEEP) {
              const far = [...decoded.keys()].sort((p, q) => apart(q, center) - apart(p, center));
              for (const j of far.slice(0, decoded.size - KEEP)) {
                decoded.get(j).close();
                decoded.delete(j);
              }
            }
          })
          .catch(() => {})
          .finally(() => {
            busy.delete(i);
            pump();
          });
      }
    }

    // The strip is at frame `at`, going `direction` (1 on, -1 back, 0 still): decode what it's about to need,
    // nearest first
    function want(at, direction) {
      center = ring(at);
      const ahead = direction < 0 ? -1 : 1;
      const reach = direction ? AHEAD : STILL;
      const order = [0];
      for (let k = 1; k <= reach; k++) {
        order.push(k * ahead);
        if (k <= BEHIND || !direction) order.push(-k * ahead);
      }
      queued.length = 0;
      for (const k of order) {
        const i = ring(center + k);
        if (!decoded.has(i) && !busy.has(i)) queued.push(i);
      }
      pump();
    }

    // Frame i if it's decoded, or the nearest one that is, or nothing yet
    function get(i) {
      i = ring(i);
      if (decoded.has(i)) return decoded.get(i);
      for (let k = 1; k < 6; k++) {
        const near = decoded.get(ring(i - k)) || decoded.get(ring(i + k));
        if (near) return near;
      }
      return null;
    }

    // Downloads every frame, kept compressed until it's decoded, then decodes the first few
    const fetched = location.protocol !== "file:";
    const download = (i) =>
      fetched
        ? fetch(src(i)).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.status))))
        : new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src(i);
          });
    const ready = Promise.all(Array.from({ length: n }, (_, i) => download(i).then((file) => (files[i] = file)))).then(async () => {
      want(0, 0);
      await Promise.all([0, 1, 2, n - 1].map((i) => waitFor(ring(i))));
    });

    function waitFor(i) {
      return new Promise((resolve) => {
        const check = () => (decoded.has(i) || closed ? resolve() : setTimeout(check, 16));
        check();
      });
    }

    return {
      count: n,
      fps: video.fps,
      aspect: video.width / video.height,
      ready,
      want,
      get,
      close() {
        closed = true;
        decoded.forEach((b) => b.close());
        decoded.clear();
      },
    };
  }

  window.FlipbookFrames = { openVideo };
})();
