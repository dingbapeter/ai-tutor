"use client";

/**
 * The tutor Studio: where an artist checks a character and sees it alive,
 * without waiting for anyone.
 *
 * Drop a .glb on the page. It is checked against the contract right here
 * in the browser, the result is written in plain words, and the same
 * engine the lesson uses brings it to life: a sample line with lip sync,
 * each mood, each attention state, and a walk through every slider one at
 * a time so a slider that does the wrong thing is caught by eye.
 *
 * Nothing is uploaded. The file stays in this browser.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Mood } from "../learn/face-logic";
import type { Speech } from "../learn/avatar/Avatar3D";
import type { Weights } from "../learn/avatar/blendshapes";
import { audioContext, canAnalyse, unlockAudio } from "../learn/audio";
import { ARKIT, VISEMES, checkGlb, formatReport, type Report } from "./check";
import { standInVoice } from "./voice";

const Avatar3D = dynamic(() => import("../learn/avatar/Avatar3D"), { ssr: false });

const SAMPLE = "Hello! I'm so glad you came today. Shall we look at that problem together?";
const MOODS: Mood[] = ["neutral", "warm", "joy", "concern", "focus"];
const ATTENTION = ["idle", "listening", "thinking", "attentive"] as const;
type Attention = (typeof ATTENTION)[number];
const STEP_MS = 900;

interface Loaded {
  name: string;
  bytes: Uint8Array;
  url: string;
}

const MARK = { ok: "✓", warn: "!", fail: "✗", note: "·" } as const;

export default function Studio() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [lenient, setLenient] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [sample, setSample] = useState(SAMPLE);
  const [mood, setMood] = useState<Mood>("neutral");
  const [attention, setAttention] = useState<Attention>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const [engine, setEngine] = useState<string>("");
  const [walking, setWalking] = useState<{ names: string[]; at: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);

  const speech = useRef<{ text: string; start: number; duration: number } | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const levelBuf = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const stopVoice = useRef<() => void>(() => {});
  const walk = useRef<{ names: string[]; at: number; since: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);

  // ---- loading ----
  const take = useCallback(
    (name: string, bytes: Uint8Array, url: string) => {
      setProblem(null);
      setFallback(null);
      setWalking(null);
      walk.current = null;
      setLoaded((old) => {
        if (old && old.url.startsWith("blob:")) URL.revokeObjectURL(old.url);
        return { name, bytes, url };
      });
    },
    [],
  );

  const takeFile = useCallback(
    async (file: File) => {
      if (!/\.glb$/i.test(file.name)) {
        setProblem(`"${file.name}" is not a .glb file. Export as glTF Binary (.glb), one file with textures inside.`);
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      take(file.name, bytes, URL.createObjectURL(new Blob([bytes], { type: "model/gltf-binary" })));
    },
    [take],
  );

  const takeLink = useCallback(
    async (href: string) => {
      const url = href.trim();
      if (!url) return;
      setChecking(true);
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        take(url.split("/").pop() || url, bytes, url);
      } catch (e) {
        setProblem(`Could not load ${url}${e instanceof Error && e.message ? ` (${e.message})` : ""}.`);
      } finally {
        setChecking(false);
      }
    },
    [take],
  );

  // A link in the address bar loads straight away: /studio?model=/tutors/amara.glb
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get("model");
    if (m) {
      setLink(m);
      void takeLink(m);
    }
  }, [takeLink]);

  // ---- the check ----
  useEffect(() => {
    if (!loaded) return;
    setChecking(true);
    // Off the click, so the page paints "Checking" before a big file is read.
    const id = setTimeout(() => {
      try {
        setReport(checkGlb(loaded.bytes, { lenient }));
      } catch (e) {
        setReport(null);
        setProblem(`The file could not be read: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setChecking(false);
      }
    }, 30);
    return () => clearTimeout(id);
  }, [loaded, lenient]);

  // ---- the engine's own readout, for the panel ----
  useEffect(() => {
    const id = setInterval(() => {
      const host = stage.current?.querySelector<HTMLElement>(".avatar3d");
      const s = host?.dataset.state;
      if (s) setEngine(s);
    }, 250);
    return () => clearInterval(id);
  }, []);

  // ---- speaking ----
  function getLevel(): number | null {
    const a = analyser.current;
    const buf = levelBuf.current;
    if (!a || !buf) return null;
    a.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const d = (buf[i] - 128) / 128;
      sum += d * d;
    }
    return Math.min(1, Math.sqrt(sum / buf.length) * 4);
  }
  function getSpeech(): Speech | null {
    const s = speech.current;
    if (!s) return null;
    return { text: s.text, time: (performance.now() - s.start) / 1000, duration: s.duration };
  }

  function say() {
    stopVoice.current();
    setWalking(null);
    walk.current = null;
    const text = sample.trim() || SAMPLE;
    unlockAudio();
    const ctx = audioContext();
    const voice = standInVoice(text, ctx?.sampleRate ?? 48_000);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let source: AudioBufferSourceNode | null = null;
    if (ctx && canAnalyse(ctx)) {
      const buffer = ctx.createBuffer(1, voice.samples.length, voice.sampleRate);
      buffer.copyToChannel(voice.samples, 0);
      source = ctx.createBufferSource();
      source.buffer = buffer;
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      an.smoothingTimeConstant = 0.4;
      source.connect(an);
      an.connect(ctx.destination);
      analyser.current = an;
      levelBuf.current = new Uint8Array(new ArrayBuffer(an.frequencyBinCount));
      source.start();
    }
    speech.current = { text, start: performance.now(), duration: voice.duration };
    setSpeaking(true);
    const end = () => {
      speech.current = null;
      analyser.current = null;
      levelBuf.current = null;
      setSpeaking(false);
    };
    timer = setTimeout(end, voice.duration * 1000 + 150);
    stopVoice.current = () => {
      if (timer) clearTimeout(timer);
      try {
        source?.stop();
      } catch {
        /* already finished */
      }
      end();
    };
  }
  useEffect(() => () => stopVoice.current(), []);

  // ---- the walk through every slider ----
  const sliderNames = useMemo(() => {
    if (!report) return [];
    const have = new Set(report.facts.targets);
    const arkit = ARKIT.filter((n) => have.has(n));
    const visemes = VISEMES.map((v) => (have.has(`viseme_${v}`) ? `viseme_${v}` : have.has(v) ? v : have.has(`v_${v}`) ? `v_${v}` : null)).filter(
      (n): n is string => Boolean(n),
    );
    return [...arkit, ...visemes];
  }, [report]);

  function startWalk() {
    stopVoice.current();
    if (!sliderNames.length) return;
    walk.current = { names: sliderNames, at: 0, since: performance.now() };
    setWalking({ names: sliderNames, at: 0 });
  }
  function stopWalk() {
    walk.current = null;
    setWalking(null);
  }
  function override(): Weights | null {
    const w = walk.current;
    if (!w) return null;
    const now = performance.now();
    if (now - w.since > STEP_MS) {
      w.at = (w.at + 1) % w.names.length;
      w.since = now;
      setWalking({ names: w.names, at: w.at });
    }
    // Up and back down within the step, so the motion itself is visible.
    const t = (now - w.since) / STEP_MS;
    return { [w.names[w.at]]: Math.sin(Math.PI * Math.min(1, t)) };
  }

  // ---- copy the report for whoever is asked to help ----
  async function copyReport() {
    if (!report || !loaded) return;
    const text = `${loaded.name}\n\n${formatReport(report)}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this report:", text);
    }
  }

  const fixes = report ? report.lines.filter((l) => l.level === "fail").length : 0;

  return (
    <main
      className="shell wide studio"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void takeFile(f);
      }}
    >
      <h1>Tutor Studio</h1>
      <p className="studio-lead">
        Check a character against the contract and see it alive, the way a lesson will show it. The file stays in
        this browser; nothing is uploaded.
      </p>

      <div className={`studio-drop${dragging ? " studio-drop-over" : ""}`}>
        <label className="btn">
          Choose a .glb file
          <input
            type="file"
            accept=".glb,model/gltf-binary"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void takeFile(f);
              e.target.value = "";
            }}
          />
        </label>
        <span className="studio-or">or drop it anywhere on this page, or</span>
        <form
          className="studio-link"
          onSubmit={(e) => {
            e.preventDefault();
            void takeLink(link);
          }}
        >
          <input className="inp" value={link} onChange={(e) => setLink(e.target.value)} placeholder="/tutors/amara.glb" aria-label="Link to a character file" />
          <button className="btn ghost" type="submit">Load link</button>
        </form>
      </div>

      {problem && <p className="err" role="alert">{problem}</p>}

      {loaded && (
        <div className="studio-grid">
          <section className="card studio-stage" aria-label="The character, alive">
            <div ref={stage} className="studio-canvas">
              {fallback ? (
                <p className="studio-fallback">
                  The engine could not show this file: {fallback}. The lesson would show the drawn face instead.
                </p>
              ) : (
                <Avatar3D
                  key={loaded.url}
                  modelUrl={loaded.url}
                  size={320}
                  color="#6C5CE7"
                  speaking={speaking}
                  thinking={attention === "thinking"}
                  listening={attention === "listening"}
                  attentive={attention === "attentive"}
                  mood={mood}
                  getLevel={getLevel}
                  getSpeech={getSpeech}
                  onFallback={(why) => setFallback(why)}
                  override={override}
                />
              )}
            </div>

            <div className="studio-controls">
              <label className="studio-sample">
                <span>Sample line</span>
                <input className="inp" value={sample} onChange={(e) => setSample(e.target.value)} />
              </label>
              <div className="studio-row">
                <button className="btn" onClick={say} disabled={Boolean(fallback)}>
                  {speaking ? "Saying it…" : "Say it"}
                </button>
                <small>With a stand-in voice, so the mouth shapes come from the words and the timing from the sound.</small>
              </div>
              <div className="studio-row" role="group" aria-label="Mood">
                <span className="studio-label">Mood</span>
                {MOODS.map((m) => (
                  <button key={m} className={`chip${mood === m ? " chip-on" : ""}`} aria-pressed={mood === m} onClick={() => setMood(m)}>
                    {m}
                  </button>
                ))}
              </div>
              <div className="studio-row" role="group" aria-label="Attention">
                <span className="studio-label">Doing</span>
                {ATTENTION.map((a) => (
                  <button key={a} className={`chip${attention === a ? " chip-on" : ""}`} aria-pressed={attention === a} onClick={() => setAttention(a)}>
                    {a}
                  </button>
                ))}
              </div>
              <div className="studio-row">
                {walking ? (
                  <>
                    <button className="btn ghost" onClick={stopWalk}>Stop</button>
                    <span className="studio-slider" data-slider={walking.names[walking.at]}>
                      <b>{walking.names[walking.at]}</b> ({walking.at + 1} of {walking.names.length})
                    </span>
                  </>
                ) : (
                  <>
                    <button className="btn ghost" onClick={startWalk} disabled={!sliderNames.length || Boolean(fallback)}>
                      Walk through every slider
                    </button>
                    <small>Each slider, alone, up and back down, so one that pulls the wrong part of the face is caught by eye.</small>
                  </>
                )}
              </div>
              {engine && (
                <p className="studio-engine" data-engine={engine}>
                  Engine: {engine.includes("faces=0") ? "no face sliders found" : "face found"}
                  {engine.includes("head=1") ? ", head node found" : ", no head node (the head cannot turn)"}
                  {engine.includes("eyes=1") ? ", eyes found" : ", no eye nodes (no glances)"}
                  {engine.includes("visemes=1") ? ", using the file's own visemes" : ", blending mouth shapes from ARKit"}.
                </p>
              )}
            </div>
          </section>

          <section className="card studio-report" aria-label="The check">
            <div className="studio-report-head">
              <h2>
                {checking || !report
                  ? "Checking…"
                  : report.pass
                    ? "Ready: this character meets the contract"
                    : `Not yet: ${fixes} thing${fixes === 1 ? "" : "s"} to fix`}
              </h2>
              <span className={`studio-verdict ${checking || !report ? "" : report.pass ? "studio-pass" : "studio-fail"}`} data-verdict={checking || !report ? "checking" : report.pass ? "pass" : "fail"} />
            </div>
            <p className="studio-file">
              {loaded.name} · {(loaded.bytes.byteLength / (1024 * 1024)).toFixed(2)} MB
            </p>
            <label className="studio-lenient">
              <input type="checkbox" checked={lenient} onChange={(e) => setLenient(e.target.checked)} />
              Work in progress: the budgets (size, triangles, skeleton) warn instead of failing. The rig checks always count.
            </label>
            {report && (
              <ul className="studio-lines">
                {report.lines.map((l, i) => (
                  <li key={i} className={`studio-line studio-${l.level}`}>
                    <span aria-hidden="true">{MARK[l.level]}</span>
                    <span className="studio-level">{l.level === "fail" ? "fix" : l.level}</span>
                    <span>{l.text}</span>
                  </li>
                ))}
              </ul>
            )}
            {report && (
              <div className="studio-row">
                <button className="btn ghost small" onClick={copyReport}>{copied ? "Copied" : "Copy report"}</button>
                <small>Paste it to whoever is helping, with the file name.</small>
              </div>
            )}
          </section>
        </div>
      )}

      {!loaded && (
        <section className="card studio-help">
          <h2>What a tutor file needs</h2>
          <ul>
            <li>One glTF Binary (.glb), under 15 MB, textures embedded, 2048 px or smaller.</li>
            <li>The 52 ARKit face sliders, named exactly, every one really moving the face.</li>
            <li>Bones named Hips, Spine, Neck, Head, LeftEye and RightEye, with the eyes under Head.</li>
            <li>30,000 to 60,000 triangles, built in metres, facing +Z with +Y up, in its neutral pose.</li>
          </ul>
          <p>
            A full export from Unreal or Blender can be made to fit with <code>tools/avatar/prepare-character.py</code>. The
            whole contract is in <code>docs/AVATARS.md</code>.
          </p>
        </section>
      )}
    </main>
  );
}
