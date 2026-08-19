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
    from: process.env.SMTP_FROM ?? `"AI Tutor" <tutor@${host.replace(/^mail\./, "")}>`,
    to: msg.to,
    subject: `${msg.studentName}'s session with ${msg.tutorName} — today's recap`,
    text: [
      `Hello,`,
      ``,
      `${msg.tutorName} here — ${msg.studentName} and I just finished a session. Here's how it went:`,
      ``,
      msg.recap,
      ``,
      `See you next session!`,
      `— ${msg.tutorName}`,
    ].join("\n"),
  });
  return "sent";
}
