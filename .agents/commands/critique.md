# Critique

Write a candid, source-grounded postmortem of work you just completed. The
platform team uses these critiques as primary evidence for what to fix
next.

## When to use

Run `/critique` after a substantive piece of work — a build, refactor,
integration, or anything where you exercised a platform API, doc, or
skill. The goal is to surface the kind of feedback that doesn't fit into
a "what did you ship" summary: docs that misled you, APIs that fought
you, bugs hiding in the corner of the implementation, instincts you
ignored because you were trying to ship.

A critique that says "all good" when something rough happened is the
worst possible outcome. The previous three iterations of the prefs API
were each killed by something nobody thought worth mentioning at the
time.

## How to invoke

```
/critique <subject>
```

`<subject>` is what to critique. Examples:

- `/critique the prefs API` — focus on `pref.md` + the `use*Prefs*` composables you just used
- `/critique the agent deployment flow` — focus on `/deploy_agent` and `agents/`
- `/critique the BigQuery wiring` — focus on `bigquery.md` + `server/utils/bigquery.ts`
- `/critique the build` — open-ended; anything you found rough

If no subject is given, default to "the work you just did and the docs,
skills, and APIs you relied on."

## What to write

**Don't write any code or touch any files. Just write a chat message.**

Be concrete. Point at file paths and line numbers. Quote exact sentences
from docs that misled you. Three sharp points beat six padded ones — if
a question doesn't have an interesting answer, say so in one sentence
and move on.

Cover these seven angles, in this order, as numbered sections:

### 1. Walk me through the order you actually did things

What was the first file you opened? When did you read the docs vs the
source vs the example pages? Were there any "wait, let me re-read X"
moments before you committed? The actual path, not a clean post-hoc
narrative.

### 2. What was wrong with the prompt / brief / spec you were given?

Was anything counterproductive — too prescriptive, ambiguous, or leading
you toward a hack instead of an idiom? Did a required detail not really
make sense given what the API supports? Did any part of the brief
encourage you to copy-paste rather than think?

### 3. Teach the subject to another agent in three sentences

Smallest possible explanation that would let another agent use it
correctly the first time. If the docs led with those three sentences,
would the rest of them still need to exist?

### 4. One concrete edit to the most-relevant doc

Not a wishlist — one specific change. "Add this sentence after line N",
"delete the example in §Anti-patterns about Z", "move the §Direct-API
escape hatch to the bottom". The single most useful change you'd make
right now.

### 5. What's the worst-case footgun left?

Things that would bite someone who knows the surrounding tech (Vue,
TypeScript, Nuxt, GCP, etc.) but didn't read the doc carefully. Race
conditions, name collisions, defaults-merge weirdness, edge cases that
pass code review, observability gaps that hide silent failures.

### 6. The source code itself — was anything surprising?

Fragile patterns, over-engineering, obvious about-to-bite-someone code.
Style observations welcome. Point at line numbers. If you read source
during the build to confirm a behaviour that wasn't documented, that's
exactly the kind of thing to surface here.

### 7. Anything else

Leftovers — things you noticed but didn't think rose to the level of
"report-worthy." Trust your instincts; the bug that kills the next
release is usually the one everybody saw and nobody mentioned.

## Why this format

A standard "what went well / what didn't" retrospective rewards smoothing
things over. This command asks the opposite — point at the rough edges
with file/line precision, even (especially) when the work shipped
successfully. The platform team would rather get a critique with five
sharp problems and a clean ship than a critique that says "everything
worked" and hides three latent bugs.

## After you post the critique

You're done. Don't summarise the critique in a separate message, don't
write a follow-up plan, don't open issues. The platform team will read
the chat message, file Linear issues, and route fixes from there.
