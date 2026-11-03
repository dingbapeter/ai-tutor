import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
const S = process.argv[2];
const bundle = readFileSync(new URL("../../../apps/web/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs", import.meta.url).pathname, "utf8");
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await b.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 200)); });
await page.goto("http://127.0.0.1:3100/studio", { waitUntil: "domcontentloaded" });
// Serve the bundle from the page's own origin so its wasm loader resolves /face/wasm.
await page.route("**/vision_bundle.mjs", (r) => r.fulfill({ body: bundle, contentType: "text/javascript" }));
const out = {};
for (const view of ["front", "quarter", "side"]) {
  const png = readFileSync(`${S}/${view}.png`).toString("base64");
  out[view] = await page.evaluate(async (png) => {
    const vision = await import("/vision_bundle.mjs");
    const fileset = await vision.FilesetResolver.forVisionTasks("/face/wasm");
    const lm = await vision.FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: "/face/face_landmarker.task" }, runningMode: "IMAGE", numFaces: 1, outputFaceBlendshapes: true });
    const img = new Image(); img.src = "data:image/png;base64," + png; await img.decode();
    const res = lm.detect(img);
    const face = res.faceLandmarks[0];
    const shapes = Object.fromEntries((res.faceBlendshapes?.[0]?.categories ?? []).map((c) => [c.categoryName, +c.score.toFixed(3)]));
    return { w: img.width, h: img.height, n: face?.length ?? 0, points: face?.map((p) => [+p.x.toFixed(5), +p.y.toFixed(5), +p.z.toFixed(5)]), shapes };
  }, png);
  console.log(view, "landmarks:", out[view].n, "smile:", out[view].shapes?.mouthSmileLeft, out[view].shapes?.mouthSmileRight, "jawOpen:", out[view].shapes?.jawOpen, "blink:", out[view].shapes?.eyeBlinkLeft);
}
writeFileSync(`${S}/landmarks.json`, JSON.stringify(out));
await b.close();
