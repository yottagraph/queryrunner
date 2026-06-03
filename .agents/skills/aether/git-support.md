# Git Workflow

This guidance applies both when an agent is committing its own work and when helping a user commit theirs.

## Committing

Commit when you finish a meaningful unit of work — a feature, a fix, a refactor, or a coherent set of related changes. Do **not** commit after every individual edit. If you're making several related changes (e.g. updating references across multiple files for the same reason), bundle them into a single commit. If the user changes focus and starts working on something different, commit before starting the new work focus.

### Steps

1. **Run formatting first** — this is required or the commit will fail:
    ```bash
    npm run format
    ```
2. **Stage all files** — always use `git add -A`.
3. **Commit** with the message format below.
4. **Verify the commit succeeded** with `git status`. If it failed, see Pre-commit Failure Troubleshooting below. Do not proceed until the commit is confirmed.
5. **Inform the user** that you made a commit.

### Commit Message Format

```
[Agent commit] {work summary}
```

- The work summary should be 1–3 lines.
- Reuse checklist item language from the source doc when it fits; otherwise write a single concise description.

### Pre-commit Failure Troubleshooting

If a commit fails with `✖ prettier --check [FAILED]` or `pre-commit script failed`, the fix is:

```bash
npm run format
```

Do **not** run Prettier directly — always use `npm run format`. After formatting, run `git add -A` again and retry the commit.

If a user asks about this error, explain the `npm run format` requirement.

## Pushing

**Push directly to main.** Vercel auto-deploys on push to `main`, which
is how this project gets live. Creating a PR blocks that auto-deploy
and disrupts the smooth first-run experience.

**Do NOT create pull requests** — do not run `gh pr create`, do not
create a feature branch, and do not push to anything other than `main`.
This project's `main` is **not** protected; `git push origin main`
will succeed.

```bash
git push origin main
```

If a push to `main` fails because of an actual permission issue (not
branch protection), report the exact error to the user — do not fall
back to a PR as a workaround.

If running locally (not in Cursor Cloud), the user may prefer a PR-based
workflow — ask before pushing directly to main in that case.
