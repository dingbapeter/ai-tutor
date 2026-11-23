# The pilot kit: measuring what learners gain

An investor's second question, after "do families come back?", is "does it
work?". A school's first question is the same one. This is how Dingba
answers it with numbers a head teacher, a researcher or an investor can
check: a short test before, some weeks with the tutor, a matched test
after, and a one-page report that says what changed and how sure anyone
can be about it.

The model to follow is the World Bank's 2025 trial in Edo State: six weeks
of after-school tutoring with a general chatbot, measured against a
comparison group, with gains worth more than a year of ordinary schooling.
That study is why this exists, and its design is the one the kit steers a
school towards.

## Running one, for a school

1. **Set up.** Sign in, open the school portal (`/school`), add the
   learners. Open "Measure the difference".
2. **Start the pilot.** Give it a name, choose the subject, tick the topics
   the class will cover (or leave them all unticked for the whole subject),
   and decide on a comparison group (see below). Everyone on the roster is
   enrolled.
3. **Starting test.** Each learner has their own link. Copy it to them, or
   open it on a shared device. No sign-in. They work alone, one question at
   a time, and hand in. Nothing is marked in front of them. A tutored
   learner cannot start a lesson until they have handed in.
4. **Learn.** The class uses the tutor for the weeks planned. Six is a
   sound minimum.
5. **Final test.** Press "Open the final test". The same links now open
   the final test: different questions, same topics.
6. **Read the result.** The report is at the bottom of the pilot page.
   "Print" prints the report alone. Two spreadsheets download: one with
   names for the school, one without for anyone outside it.
7. **Close.** Closing ends the tests and, with a comparison group, gives
   the waiting half the tutor that day.

## With or without a comparison group

Without one, the report can say that learners improved while using the
tutor. It cannot say the tutor caused it: six weeks of ordinary lessons
raise scores too, and so does having sat a similar test once before. The
report says exactly that, in words, on the page.

With one, half the class (picked by chance, by the system, not by the
school or by us) waits for the tutor until the pilot ends. Both halves sit
both tests. The difference between how much each half gained is then
evidence about the tutor itself. This is the design that carries weight
outside the school.

The waiting half is not denied the tutor: they get it the day the pilot
closes. A school should still tell parents how the pilot works and get
whatever consent its own policy asks for. That, and the wording of it, is
one more thing for the lawyer's review.

## How many learners

| Sat both tests (each group) | What the report does |
| --- | --- |
| fewer than 10 | gives no average at all, and says why |
| 10 to 29 | gives the averages, labelled an early signal |
| 30 or more | reports the result plainly |

Thirty or more in each group is the number to aim for before showing a
result to anyone outside the school.

## What makes the measurement fair

- **Two matched tests.** Same topics, same number of questions per topic,
  different questions. Which question of a pair lands on which test is a
  coin toss.
- **Half sit each test first.** If one test happened to be easier, that
  would cancel out instead of passing for learning.
- **Unseen questions.** Test questions come from the end of each topic's
  bank; lessons and level checks draw from the front. For the pilot's
  learners they are also held out of practice, level checks, mock exams
  and lessons until the pilot closes. A question the bank holds twice
  counts as one question and is held out wherever it sits.
- **Frozen.** The questions are copied into the pilot when it starts. A
  later change to the curriculum cannot alter a test that was sat.
- **Marked by machine.** The computer algebra checker marks every answer
  the same way for everyone. A blank is wrong. If the checker cannot be
  reached, a stored answer is matched plainly, the mark is flagged, the
  report says how many, and reading the report again later re-marks them.
- **Nobody dropped quietly.** The report counts everyone enrolled, everyone
  who sat each test, and everyone who sat both, and says that the averages
  lean towards those who stayed.
- **Usage counted honestly.** Sessions and the number of different days a
  learner came, between their own two tests. Not minutes: a child closes
  the tab without ending a session, so a clock would be a guess.

## What the numbers mean

- **Change**: final score minus starting score, in percentage points,
  averaged over learners who sat both.
- **95% interval**: the range the true average change plausibly lies in.
  If it includes zero, this pilot cannot tell the change from chance, and
  the report says so.
- **More than comparison**: the tutored group's change minus the comparison
  group's. This is the number that speaks about the tutor.
- **Standard deviations**: the same change measured against how spread out
  the starting scores were, which is how studies are compared with one
  another. The Edo State trial reported about 0.3.

The arithmetic is in `apps/api/src/pilot/stats.ts`, and
`apps/api/test/pilot.test.ts` pins every formula against numbers worked by
hand.

## For the founder

- The Command Centre has an **Evidence** tab: every pilot, its design, how
  many sat both tests, before, after, the change with its interval, and the
  difference from the comparison group. No learner is named there. It is
  the page to show an investor.
- **Do not run a real pilot until the real model is on.** While the live
  site runs the stand-in providers, a pilot would measure a script.
  Section 1.2 of the founder checklist is the switch.
- **The maths checker must be reachable** (`MATHCHECK_URL`). Without it
  answers are marked by plain matching, which marks a right answer written
  another way as wrong. The report flags this, but a pilot should not be
  started in that state.
- **Subjects.** A pilot needs enough machine-marked questions to build two
  tests and still leave some for practice. Today that is Middle School
  Math (25 topics) and the exam-prep starter (3 topics). Adding verified
  questions to a subject makes it eligible with no code change.
- A pilot's data is part of the school's account: it is in the account's
  data download and is erased with the account.

## What it is not

- Not a standardised exam. The tests are built from Dingba's own verified
  question bank, so they measure the topics that bank covers. A result on
  them is evidence of learning those topics, not a WAEC grade.
- Not long-term. It measures the weeks of the pilot. Whether a gain lasts
  needs a later test, which a second pilot with the same class can give.
- Not a substitute for an independent evaluation. A result from a pilot
  the company's own software ran and marked is a strong signal, and the
  thing that earns an independent study; it is not the same thing as one.

## Proving the kit itself

```
pnpm --filter @tutor/api test                      # includes test/pilot.test.ts
TEST_DATABASE_URL=postgres://... pnpm --filter @tutor/api test   # the same, also on a real Postgres
node tools/device/pilot-probe.mjs                  # a whole pilot in a real browser
```

The Postgres run makes its own database on the server it is pointed at,
applies every migration, and drops the database afterwards. CI runs it on
every push.
