import nodemailer from "nodemailer";

/**
 * Parent recap email via the founder's existing mailcow (plain SMTP).
 * With no SMTP_HOST configured this becomes a logged no-op, so dev and tests
 * run without a mail server.
 */
export interface RecapEmail {
  to: string;
  studentName: string;
  tutorName: string;
  recap: string;
}

/** Password reset link via mailcow SMTP (logged no-op without SMTP_HOST). */
export async function sendPasswordReset(to: string, rawToken: string): Promise<"sent" | "skipped"> {
  const host = process.env.SMTP_HOST;
  const base = process.env.WEB_ORIGIN ?? "http://localhost:3000";
  if (!host) {
    console.log(`[email] SMTP not configured — would send password reset to ${to}`);
    return "skipped";
  }
  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  await transport.sendMail({
    from: process.env.SMTP_FROM ?? `"Dingba" <tutor@${host.replace(/^mail\./, "")}>`,
    to,
    subject: "Reset your password",
    text: [
      `Hello,`,
      ``,
      `Someone (hopefully you) asked to reset the password for this account.`,
      `Reset it here within the next hour:`,
      ``,
      `${base}/reset?token=${rawToken}`,
      ``,
      `If this wasn't you, just ignore this email. Nothing changes.`,
    ].join("\n"),
  });
  return "sent";
}

/** Email-verification link via mailcow SMTP (logged no-op without SMTP_HOST). */
export async function sendVerifyEmail(to: string, rawToken: string): Promise<"sent" | "skipped"> {
  const host = process.env.SMTP_HOST;
  const base = process.env.WEB_ORIGIN ?? "http://localhost:3000";
  if (!host) {
    console.log(`[email] SMTP not configured — would send verification to ${to}`);
    return "skipped";
  }
  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  await transport.sendMail({
    from: process.env.SMTP_FROM ?? `"Dingba" <tutor@${host.replace(/^mail\./, "")}>`,
    to,
    subject: "Confirm your email",
    text: [
      `Welcome!`,
      ``,
      `Please confirm this email address so session recaps and safety alerts`,
      `reach the right inbox. The link is valid for 24 hours:`,
      ``,
      `${base}/verify?token=${rawToken}`,
      ``,
      `If you didn't create this account, ignore this email.`,
    ].join("\n"),
  });
  return "sent";
}

export interface SafetyAlertEmail {
  to: string;
  studentName: string;
  categories: string[];
  excerpt: string;
}

/** Immediate guardian notification for danger-severity safety incidents. */
export async function sendSafetyAlert(msg: SafetyAlertEmail): Promise<"sent" | "skipped"> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    console.log(`[email] SMTP not configured — would send SAFETY ALERT to ${msg.to}`);
    return "skipped";
  }
  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  await transport.sendMail({
    from: process.env.SMTP_FROM ?? `"Dingba Safety" <tutor@${host.replace(/^mail\./, "")}>`,
    to: msg.to,
    subject: `Please check in with ${msg.studentName}: something came up in today's session`,
    text: [
      `Hello,`,
      ``,
      `During ${msg.studentName}'s tutoring session today, they said something we think you should know about (category: ${msg.categories.join(", ")}):`,
      ``,
      `"${msg.excerpt}"`,
      ``,
      `The tutor responded with care and encouraged them to talk to a trusted adult. We recommend checking in with them soon.`,
      ``,
      `You can review flagged moments any time from your family dashboard.`,
    ].join("\n"),
  });
  return "sent";
}

export async function sendParentRecap(msg: RecapEmail): Promise<"sent" | "skipped"> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    console.log(`[email] SMTP not configured — would send recap to ${msg.to}`);
    return "skipped";
  }
  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  await transport.sendMail({
    from: process.env.SMTP_FROM ?? `"Dingba" <tutor@${host.replace(/^mail\./, "")}>`,
    to: msg.to,
    subject: `${msg.studentName}'s session with ${msg.tutorName}: today's recap`,
    text: [
      `Hello,`,
      ``,
      `${msg.tutorName} here. ${msg.studentName} and I just finished a session, here's how it went:`,
      ``,
      msg.recap,
      ``,
      `See you next session!`,
      `${msg.tutorName}`,
    ].join("\n"),
  });
  return "sent";
}

/** One learner's week, composed for the digest. */
export interface DigestLearner {
  name: string;
  sessionsThisWeek: number;
  streakDays: number;
  dueSkills: string[];
  safetyFlags: number;
  planHeadline: string;
}

export interface WeeklyDigest {
  to: string;
  learners: DigestLearner[];
}

/**
 * The digest body, as a pure function so its wording is pinned in tests. One
 * short block per learner, plain text, in the house voice: warm, specific,
 * no filler and no AI tells.
 */
export function composeWeeklyDigest(digest: WeeklyDigest): { subject: string; text: string } {
  const names = digest.learners.map((l) => l.name);
  const subject =
    names.length === 1 ? `${names[0]}'s week with Dingba` : `This week with Dingba: ${names.join(" and ")}`;

  const blocks = digest.learners.map((l) => {
    const lines: string[] = [`${l.name}`];
    lines.push(
      l.sessionsThisWeek > 0
        ? `Sessions this week: ${l.sessionsThisWeek}. ${l.streakDays > 1 ? `The streak is at ${l.streakDays} days.` : ""}`.trim()
        : "No sessions this week. A ten minute session keeps things warm.",
    );
    if (l.dueSkills.length > 0) {
      lines.push(`Due for review: ${l.dueSkills.slice(0, 4).join(", ")}.`);
    }
    if (l.safetyFlags > 0) {
      lines.push(
        `Heads up: ${l.safetyFlags} message${l.safetyFlags === 1 ? " was" : "s were"} flagged this week. The details are on your dashboard.`,
      );
    }
    lines.push(`The week ahead: ${l.planHeadline}`);
    return lines.join("\n");
  });

  const base = process.env.WEB_ORIGIN ?? "http://localhost:3000";
  const text = [
    `Hello,`,
    ``,
    `Here is how the week went.`,
    ``,
    blocks.join("\n\n"),
    ``,
    `The full picture is on your dashboard: ${base}/account`,
    ``,
    `Dingba`,
  ].join("\n");

  return { subject, text };
}

/** Sends the composed digest (logged no-op without SMTP_HOST). */
export async function sendWeeklyDigest(digest: WeeklyDigest): Promise<"sent" | "skipped"> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    console.log(`[email] SMTP not configured — would send weekly digest to ${digest.to}`);
    return "skipped";
  }
  const { subject, text } = composeWeeklyDigest(digest);
  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  await transport.sendMail({
    from: process.env.SMTP_FROM ?? `"Dingba" <tutor@${host.replace(/^mail\./, "")}>`,
    to: digest.to,
    subject,
    text,
  });
  return "sent";
}
