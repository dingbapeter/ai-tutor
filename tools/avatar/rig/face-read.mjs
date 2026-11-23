#!/usr/bin/env node
/**
 * Reads faces in pictures: the 478 landmarks and the 52 expression scores,
 * from the same on-device face model the app ships (MediaPipe, Apache-2.0).
 *
 * Used twice by the rigger. First to find where the features of a scanned
 * head are, from a render of it. Then as an independent judge: after a
 * control such as jawOpen is built, the head is rendered with it on, and
 * this says whether a face model that knows nothing about how the control
 * was made sees a jaw that opened.
 *
 * It needs no server and no network: it serves the model and its engine
 * from the repository to a headless browser on a local port of its own.
 *
 *   node tools/avatar/rig/face-read.mjs out.json a.png b.png ...
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "..", "..", "apps", "web");
const vision = join(web, "node_modules", "@mediapipe", "tasks-vision");
const [out, ...pictures] = process.argv.slice(2);
if (!out || pictures.length === 0) {
  console.error("usage: node tools/avatar/rig/face-read.mjs out.json picture.png [more.png ...]");
  process.exit(2);
}

const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".task": "application/octet-stream", ".html": "text/html" };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = null;
  if (path === "/") return res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>face-read</title>");
  if (path === "/vision.mjs") file = join(vision, "vision_bundle.mjs");
  else if (path.startsWith("/wasm/") && !path.includes("..")) file = join(vision, path);
  else if (path === "/model.task") file = join(web, "public", "face", "face_landmarker.task");
  try {
    if (!file) throw new Error("no such file");
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
await page.goto(base);
await page.evaluate(async () => {
  const vision = await import("/vision.mjs");
  const files = await vision.FilesetResolver.forVisionTasks("/wasm");
  window.reader = await vision.FaceLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: "/model.task" },
    runningMode: "IMAGE",
    numFaces: 1,
    outputFaceBlendshapes: true,
  });
});

const result = {};
for (const picture of pictures) {
  const data = readFileSync(picture).toString("base64");
  result[picture] = await page.evaluate(async (data) => {
    const img = new Image();
    img.src = "data:image/png;base64," + data;
    await img.decode();
    const r = window.reader.detect(img);
    const face = r.faceLandmarks[0];
    if (!face) return { width: img.width, height: img.height, landmarks: null, shapes: null };
    return {
      width: img.width,
      height: img.height,
      landmarks: face.map((p) => [p.x, p.y, p.z]),
      shapes: Object.fromEntries((r.faceBlendshapes?.[0]?.categories ?? []).map((c) => [c.categoryName, c.score])),
    };
  }, data);
}
writeFileSync(out, JSON.stringify(result));
await browser.close();
server.close();
console.log(`read ${pictures.length} picture(s): ${Object.values(result).filter((r) => r.landmarks).length} with a face`);
