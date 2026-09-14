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

# Updating fork

1. Add Immich main repo as upstream
   `git remote add upstream git@github.com:immich-app/immich.git`
2. Fetch upstream
   `git getch upstream`
3. Merge new version
   `git merge upstream/v1.134.0`
4. Fix potential conflicts
5. Test changes above for correct functioning.
6. Tag commit with immich version and PixelUnion version like:
   `v1.133.5-pu1` later version should increment the pu tag
7. Push the tag
