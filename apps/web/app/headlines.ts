/**
 * The homepage speaks with many voices. A visitor sees one of these at
 * random, so Dingba never reads like a single boring billboard, and so the
 * page can greet a parent, a grandmother, a language learner, and a founder
 * chasing funding with the line that lands for each of them.
 *
 * Founder-written (2026-08-24). Rules for adding: keep the swagger, keep it
 * true. No claim we cannot stand behind if a regulator, a school, or a
 * parent asks us to prove it.
 */
export interface Headline {
  /** Plain text, with the words to highlight wrapped in {curly braces}. */
  headline: string;
  sub: string;
}

export const HEADLINES: Headline[] = [
  {
    headline: "Become expert at {anything}.",
    sub: "Ask anything. Upload anything. Learn anything.",
  },
  {
    headline: "Learn a {language}. Start talking today.",
    sub: "Your tutor listens, corrects you kindly, and speaks back.",
  },
  {
    headline: "There are no dull learners. Only {untrained tutors}.",
    sub: "Yours is trained on you: what you know, what you missed, how you learn.",
  },
  {
    headline: "Get Dingba for {your child}.",
    sub: "A tutor that knows them by name, and a dashboard that keeps you in the loop.",
  },
  {
    headline: "Even {grannies} love Dingba.",
    sub: "Learning has no age limit. Neither does your tutor's patience.",
  },
  {
    headline: "What do you want to {learn} today?",
    sub: "One tutor. Every subject. Your whole learning life.",
  },
  {
    headline: "Dingba speaks {your language}.",
    sub: "Talk to your tutor in the language you think in.",
  },
  {
    headline: "Fundraising isn't hard when you have {the right coach}.",
    sub: "Personalised knowledge for the thing you're actually trying to do.",
  },
  {
    headline: "Meet your personal {A.I} tutor.",
    sub: "Ask anything. Upload anything. Learn anything.",
  },
  {
    headline: "The tutor who {never runs out of patience}.",
    sub: "Ask the same question five times. Nobody sighs, nobody rushes you.",
  },
  {
    headline: "Your child, {ahead of the class}.",
    sub: "Daily practice, verified answers, and a tutor who remembers every session.",
  },
  {
    headline: "Preparing for {the interview}?",
    sub: "Rehearse it out loud with a tutor who plays the other side of the table.",
  },
];
