# Working in this repo

## Testing

The full suite is ~1800 tests and takes about 80 seconds. Don't run it after every
small change.

- **While iterating:** run only the tests for what you touched, plus
  `npm run typecheck`. Type errors are what catch most mistakes here, and they
  come back in a second or two.
  ```bash
  npx vitest run test/IssueAction.test.tsx test/Edition.test.tsx
  npm run typecheck
  ```
- **Before merging:** run `npm test` once, in full, and read the result. A branch
  does not go into `main` on a partial run.

The reason for the split: a full run per edit spends a minute and a half to tell
you about 1800 things you did not change. The reason for the merge gate: the
narrow run cannot see what a shared component broke two pages away, and in this
codebase the shared components are the interesting ones.

## Merging

Bring a branch into `main` with `git merge --squash`. Never a fast-forward and
never a merge commit.

## Finishing

A change is not done until the container is rebuilt:

```bash
docker compose up -d --build
```

The app is served at **http://localhost:8090** (it listens on 3000 *inside* the
container; `localhost:3000` on the host is a different app).

## Never test against the live library

`./data` is the real comic library. Use throwaway filenames for anything that
writes a comic — a realistic one has overwritten a real file before.
