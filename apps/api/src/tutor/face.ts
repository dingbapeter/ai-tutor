/**
 * Face hints: what the tutor may be told about a learner's face, and how.
 *
 * The camera is read on the learner's own device. Only one of a handful of
 * plain words ever reaches the server, and each describes something visible
 * ("smiling", "looking away"), never a feeling. That line is deliberate. EU
 * law (the AI Act, Article 5(1)(f)) bans systems that infer the emotions of
 * a learner in education, and the European Commission reads "education"
 * broadly; its own guidance puts the mere detection of an apparent
 * expression, like a smile or a frown, outside that ban. So we describe the
 * face and let the tutor respond as a caring person in the room would:
 * asking, never announcing how someone feels.
 *
 * The same caution is why hints are never available to a learner on a
 * school's roster, to a class guest, or through a partner's API key: the
 * power imbalance the law worries about is sharpest exactly there, and the
 * consent we rely on is the account holder's own.
 */

export const FACE_HINTS = ["smiling", "frowning", "furrowed", "drowsy", "away"] as const;
export type FaceHint = (typeof FACE_HINTS)[number];

export function isFaceHint(v: unknown): v is FaceHint {
  return typeof v === "string" && (FACE_HINTS as readonly string[]).includes(v);
}

/** What was seen, in words a tutor can use. Visible things only. */
const SEEN: Record<FaceHint, string> = {
  smiling: "they have been smiling",
  frowning: "they have been frowning",
  furrowed: "their brow has been furrowed",
  drowsy: "their eyes have been drooping, as if tired",
  away: "they have been looking away from the screen",
};

/**
 * The private note for this turn. Ephemeral: added to what the model reads
 * for one reply, never saved to the transcript, never shown to anyone.
 */
export function faceHintNote(hint: FaceHint): string {
  return (
    `[Private note, not from the student: through the camera they chose to switch on, for the last little while ${SEEN[hint]}. ` +
    "If it fits the moment, respond the way a caring tutor sitting beside them would. " +
    "Ask rather than tell them how they feel, never name an emotion for them, and do not lecture them about paying attention.]"
  );
}

/**
 * May this session carry face hints at all? Only a signed-in learner whose
 * account holder switched them on, never on a school roster, never through
 * an API key, never for a guest.
 */
export function faceHintsAllowed(input: {
  enabledByAccountHolder: boolean;
  signedIn: boolean;
  onSchoolRoster: boolean;
  viaApiKey: boolean;
}): boolean {
  return input.enabledByAccountHolder && input.signedIn && !input.onSchoolRoster && !input.viaApiKey;
}
