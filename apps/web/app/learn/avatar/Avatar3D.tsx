"use client";

/**
 * A rigged 3D tutor, alive in the browser.
 *
 * Loads the artist's glTF character and drives its face and head from what
 * the lesson is doing: the words being spoken (real mouth shapes, timed to
 * the voice), the tutor's mood (a smile, a furrowed brow), and the small
 * signs of life (blinks, breath, gaze, a nod on a stressed word). Runs on
 * the phone's own graphics chip through WebGL; no server does any of it.
 *
 * It is honest about what it cannot do. If the browser has no WebGL, or the
 * model fails to load, it says so through onFallback and the caller shows
 * the drawn face instead. A lesson never opens on a blank square.
 *
 * The decisions are made by the pure modules beside this file; this
 * component only feeds them time and applies their numbers to the mesh.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Mood } from "../face-logic";
import { buildTimeline, intensityFromLevel, shapeAt, type VisemeCue } from "./visemes";
import {
  blinkToArkit,
  compose,
  gazeToArkit,
  hasVisemeSliders,
  moodToArkit,
  mouthWeights,
  resolveSlider,
  type Weights,
} from "./blendshapes";
import {
  approach,
  breath,
  gazeTarget,
  headSway,
  initialBlink,
  lidTarget,
  speechNod,
  stepBlink,
  type Attention,
} from "./life";

/** What is being said right now, and how far into it we are. */
export interface Speech {
  text: string;
  /** Seconds into the audio. */
  time: number;
  /** Total seconds; 0 until the browser knows. */
  duration: number;
}

export interface Avatar3DProps {
  modelUrl: string;
  speaking: boolean;
  thinking?: boolean;
  listening?: boolean;
  attentive?: boolean;
  mood?: Mood;
  /** Live loudness 0..1, or null when the voice cannot be analysed here. */
  getLevel?: () => number | null;
  getSpeech?: () => Speech | null;
  size?: number;
  color?: string;
  /** WebGL is missing or the model would not load: show the drawn face. */
  onFallback?: (reason: string) => void;
  /** For tests and probes: the live slider weights after each frame. */
  onFrame?: (weights: Weights, extras: { lid: number; headYaw: number; headPitch: number }) => void;
  /**
   * For the Studio: when this returns weights, they are applied as they
   * are, with the life (blink, gaze, sway) held still, so an artist can
   * watch one slider at a time. Null hands control back to the engine.
   */
  override?: () => Weights | null;
}

/** The sliders we ever ask for, so a mesh's lookup table is built once. */
const WANTED = [
  "jawOpen", "mouthClose", "mouthFunnel", "mouthPucker",
  "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft", "mouthFrownRight",
  "mouthStretchLeft", "mouthStretchRight", "mouthPressLeft", "mouthPressRight",
  "mouthLowerDownLeft", "mouthLowerDownRight", "mouthUpperUpLeft", "mouthUpperUpRight",
  "mouthRollLower", "mouthRollUpper", "tongueOut",
  "browInnerUp", "browDownLeft", "browDownRight", "browOuterUpLeft", "browOuterUpRight",
  "eyeBlinkLeft", "eyeBlinkRight", "eyeSquintLeft", "eyeSquintRight", "eyeWideLeft", "eyeWideRight",
  "eyeLookInLeft", "eyeLookOutLeft", "eyeLookUpLeft", "eyeLookDownLeft",
  "eyeLookInRight", "eyeLookOutRight", "eyeLookUpRight", "eyeLookDownRight",
  "cheekSquintLeft", "cheekSquintRight", "cheekPuff", "noseSneerLeft", "noseSneerRight",
  ...["sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "ih", "oh", "ou"].map((v) => `viseme_${v}`),
];

interface FaceMesh {
  mesh: THREE.Mesh;
  /** Our slider name -> this mesh's morph index, for the ones it has. */
  index: Map<string, number>;
}

const norm = (s: string) => s.toLowerCase().replace(/[._\-:\s]/g, "");

/** Find the head and eye nodes under whatever an artist's tool named them. */
function findNode(root: THREE.Object3D, test: (n: string) => boolean): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (found) return;
    if (test(norm(o.name)) && !(o as THREE.Mesh).isMesh) found = o;
  });
  if (!found) root.traverse((o) => { if (!found && test(norm(o.name))) found = o; });
  return found;
}

export default function Avatar3D({
  modelUrl,
  speaking,
  thinking = false,
  listening = false,
  attentive = false,
  mood = "neutral",
  getLevel,
  getSpeech,
  size = 96,
  color = "#6C5CE7",
  onFallback,
  onFrame,
  override,
}: Avatar3DProps) {
  const host = useRef<HTMLDivElement>(null);
  // The latest props, readable from inside the animation loop without
  // restarting it every render.
  const live = useRef({ speaking, thinking, listening, attentive, mood, getLevel, getSpeech, onFrame, override });
  live.current = { speaking, thinking, listening, attentive, mood, getLevel, getSpeech, onFrame, override };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let raf = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(26, 1, 0.05, 50);

    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
    } catch {
      onFallback?.("no WebGL");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setSize(size, size);
    renderer.domElement.style.width = `${size}px`;
    renderer.domElement.style.height = `${size}px`;
    renderer.domElement.setAttribute("aria-hidden", "true");
    el.appendChild(renderer.domElement);

    // Portrait lighting: a warm key from the front-left, a cool fill from
    // the right, sky and ground so nothing is ever pitch black.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8aa0, 0.9));
    const key = new THREE.DirectionalLight(0xfff1e0, 1.6);
    key.position.set(-1.5, 2, 3);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdde8ff, 0.7);
    fill.position.set(2, 0.5, 2);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.5);
    rim.position.set(0, 1.5, -3);
    scene.add(rim);

    const faces: FaceMesh[] = [];
    let head: THREE.Object3D | null = null;
    let leftEye: THREE.Object3D | null = null;
    let rightEye: THREE.Object3D | null = null;
    let usesVisemes = false;
    let headRest = new THREE.Euler();
    let headScale = 1;

    const loader = new GLTFLoader();
    loader
      .loadAsync(modelUrl)
      .then((gltf) => {
        if (disposed) return;
        const root = gltf.scene;
        const allNames = new Set<string>();
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && m.morphTargetDictionary && m.morphTargetInfluences) {
            const names = Object.keys(m.morphTargetDictionary);
            names.forEach((n) => allNames.add(n));
            const index = new Map<string, number>();
            for (const want of WANTED) {
              const i = resolveSlider(names, want);
              if (i >= 0) index.set(want, m.morphTargetDictionary[names[i]]);
            }
            if (index.size) faces.push({ mesh: m, index });
            m.frustumCulled = false;
          }
        });
        usesVisemes = hasVisemeSliders([...allNames]);
        head = findNode(root, (n) => /(^|[^a-z])head$/.test(n) || n === "head" || n.endsWith("head"));
        leftEye = findNode(root, (n) => /lefteye$|eyeleft$|eyel$|leye$|l_eye$|eye_l$/.test(n) || n === "lefteye");
        rightEye = findNode(root, (n) => /righteye$|eyeright$|eyer$|reye$|r_eye$|eye_r$/.test(n) || n === "righteye");
        if (head) headRest = head.rotation.clone();

        // Frame the head: whatever size the artist built it at, it fills the
        // view from the shoulders up.
        scene.add(root);
        const box = new THREE.Box3().setFromObject(head ?? root);
        const centre = box.getCenter(new THREE.Vector3());
        const extent = box.getSize(new THREE.Vector3());
        const radius = Math.max(extent.x, extent.y, extent.z) * 0.5 || 1;
        headScale = radius;
        const dist = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.25;
        camera.position.set(centre.x, centre.y + radius * 0.05, centre.z + dist);
        camera.lookAt(centre.x, centre.y + radius * 0.05, centre.z);
        camera.near = dist / 50;
        camera.far = dist * 20;
        camera.updateProjectionMatrix();
        if (faces.length === 0) onFallback?.("model has no facial sliders");
      })
      .catch((e: unknown) => {
        if (!disposed) onFallback?.(e instanceof Error ? e.message : "model failed to load");
      });

    // ---- the life loop ----
    let blink = initialBlink(performance.now());
    let lid = 0;
    let gaze = { x: 0, y: 0 };
    let moodMix: Weights = {};
    let mouthMix: Weights = {};
    let prevLevel = 0;
    let nod = 0;
    let last = performance.now();
    let timeline: VisemeCue[] = [];
    let timelineFor = "";
    let timelineDur = 0;
    let lastReadout = 0;

    const frame = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const dt = Math.min(100, now - last);
      last = now;
      const p = live.current;

      // Blink.
      blink = stepBlink(blink, now);
      lid = approach(lid, lidTarget(blink, now), dt, lid < 0.5 ? 35 : 70);

      // Attention and gaze.
      const attention: Attention = p.speaking ? "speaking" : p.thinking ? "thinking" : p.listening ? "listening" : p.attentive ? "attentive" : "idle";
      const g = gazeTarget(attention, now);
      gaze = { x: approach(gaze.x, g.x, dt, 110), y: approach(gaze.y, g.y, dt, 110) };

      // Mood, eased so a smile arrives rather than appears.
      const moodTarget = moodToArkit(p.mood, p.speaking || p.listening ? 1 : 0.8);
      const moodKeys = new Set([...Object.keys(moodMix), ...Object.keys(moodTarget)]);
      for (const k of moodKeys) moodMix[k] = approach(moodMix[k] ?? 0, moodTarget[k] ?? 0, dt, 260);

      // Mouth: the plan from the words, the force from the voice.
      let mouthTarget: Weights = {};
      let level = 0;
      if (p.speaking) {
        const sp = p.getSpeech?.() ?? null;
        const raw = p.getLevel?.();
        const analysed = typeof raw === "number";
        level = analysed ? raw : 0;
        if (sp && sp.duration > 0) {
          if (sp.text !== timelineFor || sp.duration !== timelineDur) {
            timeline = buildTimeline(sp.text, sp.duration);
            timelineFor = sp.text;
            timelineDur = sp.duration;
          }
          const shape = shapeAt(timeline, sp.time);
          // No analyser (a sleeping audio engine): a natural talking wave
          // stands in for the loudness, so the plan still plays out.
          const intensity = analysed ? intensityFromLevel(level) : 0.55 + 0.3 * Math.sin(now / 90);
          mouthTarget = mouthWeights(shape.from, shape.to, shape.blend, intensity, usesVisemes);
        } else if (analysed) {
          // Words unknown: open with the sound, as the drawn face does.
          const k = intensityFromLevel(level);
          mouthTarget = usesVisemes ? { viseme_aa: k * 0.7 } : { jawOpen: k * 0.6, mouthFunnel: k * 0.15 };
        }
      }
      const mouthKeys = new Set([...Object.keys(mouthMix), ...Object.keys(mouthTarget)]);
      for (const k of mouthKeys) mouthMix[k] = approach(mouthMix[k] ?? 0, mouthTarget[k] ?? 0, dt, 45);
      nod = approach(nod, speechNod(level, prevLevel), dt, 120);
      prevLevel = approach(prevLevel, level, dt, 60);

      const held = p.override?.() ?? null;
      const weights = held ?? compose(mouthMix, moodMix, blinkToArkit(lid), gazeToArkit(gaze.x, gaze.y));

      // Apply to every face mesh that has the slider.
      for (const f of faces) {
        const inf = f.mesh.morphTargetInfluences!;
        for (const [name, i] of f.index) inf[i] = weights[name] ?? 0;
      }

      // Head: breath, sway, nod, and a small lean-in when attentive.
      const sway = headSway(now);
      const b = breath(now);
      const lean = attention === "listening" || attention === "attentive" ? 0.03 : 0;
      let yaw = 0, pitch = 0;
      if (head && held) {
        // One slider at a time: the head and eyes hold still.
        head.rotation.copy(headRest);
        head.scale.setScalar(1);
      } else if (head) {
        yaw = sway.yaw + gaze.x * 0.12;
        pitch = sway.pitch + nod + lean - gaze.y * 0.08;
        head.rotation.set(headRest.x + pitch, headRest.y + yaw, headRest.z + sway.roll);
        const s = 1 + 0.004 * b;
        head.scale.setScalar(s);
        head.position.y += 0; // position is the artist's; breath is in scale
      }
      // Eyes, if the model has eye bones: a real glance.
      if (leftEye) leftEye.rotation.set(held ? 0 : -gaze.y * 0.25, held ? 0 : gaze.x * 0.3, 0);
      if (rightEye) rightEye.rotation.set(held ? 0 : -gaze.y * 0.25, held ? 0 : gaze.x * 0.3, 0);

      renderer!.render(scene, camera);
      p.onFrame?.(weights, { lid, headYaw: yaw, headPitch: pitch });
      // A plain readout of what the face is doing, ten times a second, for
      // the probes and for anyone with the inspector open. Costs nothing.
      if (now - lastReadout > 100) {
        lastReadout = now;
        el.dataset.state =
          `faces=${faces.length} visemes=${usesVisemes ? 1 : 0} head=${head ? 1 : 0} eyes=${leftEye && rightEye ? 1 : 0} ` +
          `jaw=${(weights.jawOpen ?? weights.viseme_aa ?? 0).toFixed(2)} smile=${(weights.mouthSmileLeft ?? 0).toFixed(2)} ` +
          `brow=${(weights.browInnerUp ?? 0).toFixed(2)} lid=${lid.toFixed(2)} yaw=${yaw.toFixed(3)} pitch=${pitch.toFixed(3)}`;
      }
    };
    raf = requestAnimationFrame(frame);

    // Size follows the host.
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth || size;
      const h = el.clientHeight || size;
      renderer!.setSize(w, h, false);
      renderer!.domElement.style.width = `${w}px`;
      renderer!.domElement.style.height = `${h}px`;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(el);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry?.dispose();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach((mat) => mat?.dispose());
        }
      });
      renderer?.dispose();
      renderer?.domElement.remove();
      void headScale;
    };
    // The model and the size are the only things worth rebuilding the scene for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUrl, size]);

  return (
    <div
      ref={host}
      className="avatar3d"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        background: `radial-gradient(circle at 50% 35%, ${color}33, ${color}0d 70%, transparent)`,
      }}
    />
  );
}
