#!/usr/bin/env node
/*
  Cuts a clip into frames for Flipbook Scroll and adds it to the video menu.

    node cut.mjs <clip> <key> "<Title>" [--from 0] [--to 8.6] [--rate 30] [--size 960] [--jpg]

  <key> names its folder in frames/ (rooftop, beach-day). --from and --to trim it, in seconds. It keeps every Nth
  frame, so about --rate a second are left, evenly spaced: 30 keeps every frame of an ordinary phone clip, 120 of a
  slo-mo one. At top speed the strip shows each frame on as many cards as it takes to play the clip at its own length
  (flipbook.js), so more frames a second means fewer repeated cards, not a faster moment. Phone HDR is turned into
  ordinary color. Frames are at most --size px on their long side.

  Frames are AVIF, a third to a half smaller than a JPG that looks the same: AV1 at CRF 30, tuned for how it looks,
  with variance boost, which keeps the fine grain in dark, flat areas (wet ground, a dark street) that AV1 otherwise
  smooths away; encoded from lossless frames, so nothing is compressed twice. --jpg writes JPGs instead.

  Each video's folder holds its frames and a video.json; frames/videos.js, which the page reads, is written from
  those, oldest first. The clip itself is copied into source/.
*/
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [clip, key, title, ...rest] = process.argv.slice(2);
if (!clip || !key || !title || !/^[a-z0-9-]+$/.test(key)) {
  console.error('Usage: node cut.mjs <clip> <key> "<Title>" [--from s] [--to s] [--rate 30] [--size 960] [--jpg]\n<key> is lowercase letters, digits and dashes.');
  process.exit(1);
}
const opt = {};
for (let i = 0; i < rest.length; i++) {
  const name = rest[i].replace(/^--/, "");
  if (name === "jpg") opt.jpg = true;
  else opt[name] = Number(rest[++i]);
}
const rate = opt.rate || 30;
const size = opt.size || 960;
const ext = opt.jpg ? "jpg" : "avif";
// AV1 quality, chosen side by side against lossless frames (Nov 14): CRF 32 alone lost the grain in the fruit clip's
// dark ground; 30 with variance boost kept it
const CRF = 30;
const SVT = "avif=1:tune=0:enable-variance-boost=1:variance-boost-strength=3";

const run = (cmd, args) => {
  const out = spawnSync(cmd, args, { encoding: "utf8" });
  if (out.status !== 0) {
    console.error(out.stderr || `${cmd} failed`);
    process.exit(1);
  }
  return out.stdout;
};

// Runs `jobs` (functions returning promises) a few at a time
async function pool(jobs, width) {
  let next = 0;
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (next < jobs.length) await jobs[next++]();
    }),
  );
}

const encode = (from, to) =>
  new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-loglevel", "error", "-y", "-i", from,
      "-c:v", "libsvtav1", "-crf", String(CRF), "-preset", "4", "-svtav1-params", SVT, "-pix_fmt", "yuv420p",
      "-frames:v", "1", to,
    ]);
    let err = "";
    ffmpeg.stderr.on("data", (d) => (err += d));
    ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err || `ffmpeg failed on ${from}`))));
  });

// What the clip is
const probe = JSON.parse(
  run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate,color_transfer,color_primaries", "-of", "json", clip]),
).streams[0];
const [num, den] = probe.r_frame_rate.split("/").map(Number);
const every = Math.max(1, Math.round(num / den / rate));
const fps = Math.round((num / den / every) * 1000) / 1000;
const hdr = probe.color_primaries === "bt2020" || ["arib-std-b67", "smpte2084"].includes(probe.color_transfer);
if (probe.color_transfer === "smpte2084") console.warn("This clip is PQ HDR; its colors may come out a little flat.");

// The frames. A re-cut keeps its place in the menu.
const folder = join(here, "frames", key);
const before = existsSync(join(folder, "video.json")) ? JSON.parse(readFileSync(join(folder, "video.json"), "utf8")) : null;
rmSync(folder, { recursive: true, force: true });
mkdirSync(folder, { recursive: true });
const filters = [
  `select='not(mod(n\\,${every}))'`,
  hdr ? "colorspace=all=bt709:iall=bt2020:itrc=bt2020-10:fast=0:format=yuv420p" : null,
  `scale=w=${size}:h=${size}:force_original_aspect_ratio=decrease:flags=lanczos`,
  "scale=trunc(iw/2)*2:trunc(ih/2)*2",
].filter(Boolean);
// JPGs straight out; AVIFs from lossless PNGs in a scratch folder
const scratch = opt.jpg ? null : mkdtempSync(join(tmpdir(), `flipbook-${key}-`));
run("ffmpeg", [
  "-loglevel", "error", "-y",
  ...(opt.from ? ["-ss", String(opt.from)] : []),
  ...(opt.to ? ["-to", String(opt.to)] : []),
  "-i", clip, "-an",
  "-vf", filters.join(","),
  "-fps_mode", "passthrough",
  ...(opt.jpg ? ["-q:v", "4", join(folder, "%03d.jpg")] : [join(scratch, "%03d.png")]),
]);
if (scratch) {
  const pngs = readdirSync(scratch).filter((f) => f.endsWith(".png")).sort();
  process.stdout.write(`Encoding ${pngs.length} frames…`);
  await pool(
    pngs.map((png) => () => encode(join(scratch, png), join(folder, png.replace(/\.png$/, ".avif")))),
    Math.max(2, availableParallelism() - 1),
  );
  process.stdout.write("\n");
  rmSync(scratch, { recursive: true, force: true });
}
const count = readdirSync(folder).filter((f) => f.endsWith(`.${ext}`)).length;
const [width, height] = run("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", join(folder, `001.${ext}`)])
  .trim()
  .split(",")
  .map(Number);
if (count > 1200) console.warn(`${count} frames is a big download; --from and --to can trim it.`);

// Keep the clip with the piece
mkdirSync(join(here, "source"), { recursive: true });
const kept = join(here, "source", basename(clip));
if (!existsSync(kept)) copyFileSync(clip, kept);

const added = before?.added ?? new Date().toISOString();
const video = { key, title, fps, count, width, height, digits: 3, ext, source: basename(clip), added };
writeFileSync(join(folder, "video.json"), JSON.stringify(video, null, 2) + "\n");
const listed = readdirSync(join(here, "frames"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== key && existsSync(join(here, "frames", d.name, "video.json")))
  .map((d) => JSON.parse(readFileSync(join(here, "frames", d.name, "video.json"), "utf8")));

const all = [...listed, video].sort((a, b) => a.added.localeCompare(b.added));
writeFileSync(
  join(here, "frames", "videos.js"),
  "// Written by cut.mjs from each frames/*/video.json; the first is the one that shows first.\n" +
    `window.FlipbookVideos = ${JSON.stringify(all.map(({ key, title, fps, count, width, height, digits, ext }) => ({ key, title, fps, count, width, height, digits, ext })), null, 2)};\n`,
);

const bytes = readdirSync(folder).filter((f) => f.endsWith(`.${ext}`)).reduce((sum, f) => sum + readFileSync(join(folder, f)).length, 0);
console.log(
  `${title}: ${count} ${ext.toUpperCase()} frames, ${width}×${height}, ${fps} a second ` +
    `(every ${every === 1 ? "" : `${every}${every === 2 ? "nd" : every === 3 ? "rd" : "th"} `}frame${hdr ? ", HDR converted" : ""}), ` +
    `${(bytes / 1e6).toFixed(1)} MB.`,
);
