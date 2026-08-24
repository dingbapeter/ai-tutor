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
