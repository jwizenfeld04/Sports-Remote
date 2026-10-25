## What and why

<!-- What does this change, and why? Link the issue: "Fixes #123". -->

## How it was tested

- [ ] `npm run typecheck && npm test`
- [ ] `npm run test:e2e` (UI or server changes)
- [ ] On a real TV: <!-- model, platform/OS, app versions; paste the `npm run tv -- launch <app> --network <net>` output and the `"evt":"launch"` log line -->
- [ ] `docker build .` (Dockerfile, dependency or deploy changes)

## Checklist

- [ ] Catalog changes cite sources, and new deep links start as unverified
- [ ] Routing changes have cases in `test/resolve.test.ts`; navigator changes have a simulator scenario
- [ ] Stored config changes come with a migration and a test that upgrades an old file
- [ ] Nothing new reaches the TV except through the allowlisted command builders
- [ ] No secrets in logs, fixtures or screenshots
- [ ] `CHANGELOG.md` updated under **Unreleased** (user-visible changes)
