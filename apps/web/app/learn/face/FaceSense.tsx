"use client";

/**
 * Letting the tutor see the learner's face, on the learner's own terms.
 *
 * Off at the start of every lesson. Offered only when the account holder
 * has allowed it (the session says so). Turned on only after a plain
 * explanation the learner says yes to. While on, a small mirror shows them
 * exactly what the camera sees, with a one-tap off beside it.
 *
 * The camera frames go to a face model running inside this page and
 * nowhere else. What leaves is at most one plain word now and then,
 * decided by the rules in expression.ts, attached to the learner's next
 * message by the lesson page.
 */

import { useEffect, useRef, useState } from "react";
import { useLang } from "../../i18n";
import { headTurn, labelFrame, prune, steadyLabel, type Label, type Sample } from "./expression";

const SAMPLE_MS = 250;
const CONSENT_KEY = "dingba_face_consent";

type Phase = "off" | "asking" | "starting" | "on" | "failed";

interface Props {
  tutorName: string;
  /** The steady look changed. The page keeps the latest for the next message. */
  onSteady: (label: Label) => void;
}

/** Can this browser do it at all? Camera access and WebAssembly. */
export function canSeeFace(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof WebAssembly === "object" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

export default function FaceSense({ tutorName, onSteady }: Props) {
  const { t } = useLang();
  const [phase, setPhase] = useState<Phase>("off");
  const [problem, setProblem] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const stopRef = useRef<() => void>(() => {});
  const onSteadyRef = useRef(onSteady);
  onSteadyRef.current = onSteady;

  // Whatever happens, leaving the lesson turns the camera off.
  useEffect(() => () => stopRef.current(), []);

  function stop() {
    stopRef.current();
    stopRef.current = () => {};
    onSteadyRef.current("none");
    if (host.current) host.current.dataset.face = "off";
    setPhase("off");
  }

  async function start() {
    setProblem(null);
    setPhase("starting");
    let stream: MediaStream | null = null;
    let landmarker: { detectForVideo: (v: HTMLVideoElement, t: number) => unknown; close: () => void } | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const cleanup = () => {
      if (timer) clearInterval(timer);
      timer = null;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      if (video.current) video.current.srcObject = null;
      try {
        landmarker?.close();
      } catch {
        /* already closed */
      }
      landmarker = null;
    };
    stopRef.current = cleanup;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 320 }, height: { ideal: 240 } },
        audio: false,
      });
    } catch {
      cleanup();
      setProblem(t("The camera could not be opened. Check the permission, or carry on without it."));
      setPhase("failed");
      return;
    }

    try {
      const v = video.current!;
      v.srcObject = stream;
      v.muted = true;
      (v as HTMLVideoElement & { playsInline?: boolean }).playsInline = true;
      await v.play().catch(() => {});

      // The face model, from our own site, on this device.
      const vision = await import("@mediapipe/tasks-vision");
      const fileset = await vision.FilesetResolver.forVisionTasks("/face/wasm");
      const make = (delegate: "GPU" | "CPU") =>
        vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: "/face/face_landmarker.task", delegate },
          outputFaceBlendshapes: true,
          runningMode: "VIDEO",
          numFaces: 1,
        });
      // The graphics chip where it works; the processor where it does not.
      landmarker = await make("GPU").catch(() => make("CPU"));
    } catch {
      cleanup();
      setProblem(t("This device could not run the face reader. The lesson carries on as normal."));
      setPhase("failed");
      return;
    }

    let samples: Sample[] = [];
    let last: Label = "none";
    timer = setInterval(() => {
      const v = video.current;
      if (!v || !landmarker || document.hidden || v.readyState < 2) return;
      const now = performance.now();
      let result: {
        faceLandmarks?: Array<Array<{ x: number; y: number }>>;
        faceBlendshapes?: Array<{ categories: Array<{ categoryName: string; score: number }> }>;
      };
      try {
        result = landmarker.detectForVideo(v, now) as typeof result;
      } catch {
        return;
      }
      const lm = result.faceLandmarks?.[0];
      const scores: Record<string, number> = {};
      for (const c of result.faceBlendshapes?.[0]?.categories ?? []) scores[c.categoryName] = c.score;
      const label = labelFrame({
        present: Boolean(lm && lm.length > 454),
        scores,
        turn: lm && lm.length > 454 ? headTurn(lm[1], lm[234], lm[454]) : 1,
      });
      samples = prune([...samples, { at: now, label }], now);
      const steady = steadyLabel(samples, now, SAMPLE_MS);
      if (steady !== last) {
        last = steady;
        onSteadyRef.current(steady);
      }
      // A plain readout for the probe and the curious. Words only.
      if (host.current) host.current.dataset.face = `on frame=${label} steady=${steady}`;
    }, SAMPLE_MS);

    if (host.current) host.current.dataset.face = "on frame=none steady=none";
    setPhase("on");
  }

  function ask() {
    let agreed = false;
    try {
      agreed = localStorage.getItem(CONSENT_KEY) === "yes";
    } catch {
      /* private mode: ask every time */
    }
    if (agreed) void start();
    else setPhase("asking");
  }

  function agree() {
    try {
      localStorage.setItem(CONSENT_KEY, "yes");
    } catch {
      /* fine: we ask again next time */
    }
    void start();
  }

  return (
    <div ref={host} className="face-sense" data-face="off">
      {/* The mirror stays mounted so the camera has somewhere to play; it is
          only shown while on, so the learner always sees what is seen. */}
      <video
        ref={video}
        className="face-mirror"
        aria-label={t("Your camera, as your tutor's face reader sees it")}
        style={{ display: phase === "on" ? "block" : "none" }}
      />

      {phase === "off" || phase === "failed" ? (
        <button className="chip" onClick={ask} title={t("Let {tutor} see your face", { tutor: tutorName })}>
          🙂 {t("Let {tutor} see me", { tutor: tutorName })}
        </button>
      ) : null}

      {phase === "starting" && <span className="face-note">{t("Opening the camera…")}</span>}

      {phase === "on" && (
        <span className="face-note">
          <span className="face-dot" aria-hidden="true" /> {t("Camera on, stays on this device")}{" "}
          <button className="chip" onClick={stop}>{t("Turn off")}</button>
        </span>
      )}

      {phase === "failed" && problem && <span className="face-note">{problem}</span>}

      {phase === "asking" && (
        <div className="face-ask" role="dialog" aria-label={t("Let {tutor} see your face?", { tutor: tutorName })}>
          <b>{t("Let {tutor} see your face?", { tutor: tutorName })}</b>
          <p>{t("Your camera stays on this device. No picture or video is recorded, saved or sent anywhere.")}</p>
          <p>
            {t("{tutor} only gets one plain word now and then, like \"smiling\" or \"looking away\", so {tutor} can respond the way someone sitting beside you would.", { tutor: tutorName })}
          </p>
          <p>{t("The first time, this downloads about 15 MB. You can turn it off any time.")}</p>
          <div className="face-ask-row">
            <button className="btn" onClick={agree}>{t("Turn on camera")}</button>
            <button className="btn ghost" onClick={() => setPhase("off")}>{t("Not now")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
