export default function Privacy() {
  return (
    <main className="shell wide" style={{ lineHeight: 1.6 }}>
      <h1>Privacy Policy</h1>
      <p className="notice">
        <b>Draft</b>: pending legal review before public launch.
      </p>
      <h3>What we collect</h3>
      <p>
        Account email and password (stored hashed), student first names, session conversations,
        practice results, and usage counts. Voice recordings are transcribed and then discarded;
        we keep the text, not the audio.
      </p>
      <h3>Why</h3>
      <p>
        Solely to run the tutoring: memory across sessions, progress tracking, parent visibility,
        safety monitoring, and fair usage limits. We do not sell or rent learner data. Ever.
      </p>
      <h3>Children</h3>
      <p>
        Children&apos;s profiles are created and controlled by a parent or guardian, who can review
        transcripts and flagged moments and can delete everything. Safety filters run on every message;
        serious concerns are notified to the guardian.
      </p>
      <h3>AI processing</h3>
      <p>
        Conversations are processed by AI models we host ourselves. Where a third-party AI service is
        used for safety classification, only the text needed for that check is sent, and it is credited
        on our <a href="/credits">credits page</a>.
      </p>
      <h3>Your rights</h3>
      <p>
        Access, correction, export, and full deletion: the &ldquo;Delete my account and all data&rdquo;
        button on your account page erases the account, every student profile, all conversations,
        progress, and safety records, immediately and irreversibly.
      </p>
      <h3>Security</h3>
      <p>
        Passwords are bcrypt-hashed; access tokens are stored hashed and expire after 30 days;
        password reset links live for one hour. Report concerns to the contact address on our site.
      </p>
      <p><a href="/">← back</a></p>
    </main>
  );
}
