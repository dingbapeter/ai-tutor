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
      <h3>The camera</h3>
      <p>
        A tutor can see a learner&apos;s face only if the parent or guardian allows it on the account
        page, and the learner then says yes and can turn it off at any time. It is never offered to
        guests, to learners added by a school, or in shared classes. The camera picture is read by a
        program running on the learner&apos;s own device and is never recorded, saved or sent to us or
        anyone else. What reaches the tutor is at most one plain word for a look that has lasted, such
        as &ldquo;smiling&rdquo; or &ldquo;looking away&rdquo;, used for that one reply and not kept.
        We do not work out anyone&apos;s emotions from their face.
      </p>
      <h3>Knowing a learner&apos;s voice</h3>
      <p>
        Only if the parent or guardian allows it, a tutor gets to know how a learner usually sounds, so it
        can notice on a day they sound unlike themselves. For this we keep a few running averages per
        learner: how high their voice is, how much it moves, and how loud and fast they speak. We keep no
        recording and nothing that could identify a voice, and we never use it to tell who is speaking.
        It is never used for learners added by a school. Switching it off, or deleting the learner,
        erases it.
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
        Access, correction, export, and full deletion. &ldquo;Download all our data&rdquo; on your account
        page gives you one file with everything we hold about your family: the account, every learner and
        their settings, every lesson word for word, progress, safety records, usage and billing. Passwords
        and sign-in keys are left out, because we only keep scrambled forms of them. &ldquo;Delete my
        account and all data&rdquo; erases all of that, immediately and irreversibly.
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
