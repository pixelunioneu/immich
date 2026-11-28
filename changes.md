# Changes Log

At PixelUnion, we value openness and open source. This document is a short index of every PixelUnion modification on top of upstream Immich.

## Changes Made

1. Branding & white-labeling
2. Authentication & account externalization
3. OIDC token bridge (Keycloak)
4. API integration & user sync
5. Self-service email change
6. Geodata externalization
7. Storage & quota
8. Billing & plans UI
9. Job/queue orchestration & ops scripts
10. CI/CD & Docker packaging
11. Mobile app
12. i18n / translations
13. Misc UI / SaaS
14. Server startup: compile cache warming
15. Google Photos migration (in-app)
16. Standalone database-migrate CLI command
17. Onboarding wizard removed + activation empty state
18. Translated automated emails (per-user language preference)
19. iOS app identity, signing & App Store release engineering
20. Mobile login timeout raised to 30s
21. Mobile first-launch onboarding welcome screen
22. Sentry error tracking (opt-in per-user toggle)
23. Fork end-to-end suite (OIDC login via mock, token bridge, blocked routes, upgrade path)
24. Front door service (`packages/frontdoor`) for idle tenants
25. Mobile login via the portal (environment discovery)
26. Blocked admin routes and database restore disabled
27. Webhook workflow action removed and SMTP test blocked
28. Referral page, sidebar banner and account menu link
29. Storage-full popup
30. Byte units shown as GB instead of GiB (web)
31. FUTO Backups not available (upstream v3.4): not mounted, not in the image, not in the UI, routes blocked
32. Passkeys disabled (upstream v3.4): `/api/passkeys` blocked, no passkey settings, no passkey domain on iOS
33. Fork test suite and merge guards (`pu-*` specs, controller snapshot, version parity)

The numbers are local to this file. The Notion page "Immich Fork: PixelUnion Changes vs Upstream" has the detail for each change: what, which files, why, and how to resolve it in a merge.

# Updating fork

1. Add the Immich repository as `upstream` (once) and fetch its tags.
   `git remote add upstream git@github.com:immich-app/immich.git`
   `git fetch upstream --tags`
2. Create a branch from `main` and merge the new tag.
   `git merge vX.Y.Z`
3. Resolve the conflicts in three groups.
   - Files the fork never touched (`git diff --name-only <previous upstream tag> main` does not list them): take upstream's version as is, `git checkout vX.Y.Z -- <path>`. Upstream releases patch versions from a release branch with cherry-picks, so many conflicts are upstream against its own backports.
   - Lock files and generated files: take upstream's and regenerate (`pnpm install`, `mise run //:open-api`, the frontdoor `codegen` task).
   - Fork-touched files: re-merge with the previous upstream tag as the base (`git merge-file`), then resolve what is left by intent, using the Notion page.
4. Check both ways:
   - `git diff --name-only vX.Y.Z HEAD` lists only fork files, or new ones you can explain.
   - Every file in `git diff --name-only <previous upstream tag> main` still differs from upstream, or you can explain why not.
5. Run all suites: server unit and medium, web unit, frontdoor, the mobile `pu` tests and `mise run //e2e:test-pu`. Two tests go red on purpose when upstream adds something: the controller snapshot (`pu-blocked-route.guard.spec.ts`) and the frontdoor version parity test.
6. Update the Notion page and this file.
