# iOS release and physical-device acceptance

## Release prerequisites

Use Replit's **Publishing → Start publishing to the App Store** (Expo Launch).
Do not run manual EAS initialization, build, or submission commands or replace
Replit's managed Expo session. Keep Expo configuration in the static `app.json`.

1. Deploy the updated web application and API to the owner's self-hosted machine.
   Push the release code to Git first, then pull and rebuild on that machine
   using the existing self-hosting scripts. Allow for a site restart during the
   update. Confirm the API is publicly reachable over HTTPS from outside the
   local network; do not embed deployment bypass credentials in the app.
2. Obtain the owner's actual self-hosted public HTTPS origin and verify it.
   Replit deployment metadata cannot discover an external self-hosted URL.
   Configure `EXPO_PUBLIC_API_BASE_URL` to this origin for the native production build.
   This is public configuration, not a secret. Never substitute a workspace
   `.replit.dev` preview URL. Confirm the Launch build receives the value before
   compiling; changing it afterward requires a new native build.
3. Open the Replit Launch wizard. Replit's documented Launch flow currently
   requires workspace publishing before its App Store launch entry appears;
   resolve that publishing prerequisite separately without changing the mobile
   API origin to a Replit-hosted copy of the backend.
   In the Launch wizard, select/create the Expo project. Use the real project ID
   supplied by this setup; do not generate a UUID locally or invent an ID.
   Push registration reads `extra.eas.projectId`, the native EAS configuration,
   or `EXPO_PUBLIC_EAS_PROJECT_ID`. Confirm one is available in the signed build.
4. Sign in with the Apple account enrolled in the Apple Developer Program
   **inside the Launch wizard only**. Complete Apple's verification there.
   Never paste passwords, verification codes, certificates, or keys into chat.
5. Select the Apple app and confirm its bundle identifier. Reuse an existing
   identifier if applicable; the first published identifier becomes permanent.
   Allow Launch to select/create the distribution certificate and provisioning
   profile. Confirm push/APNs credentials are configured for this Expo project.
6. Launch the signed iOS build and confirm its upload in App Store Connect.
   Install the processed build using TestFlight on a physical iPhone.
   External testers may need Apple's Beta App Review.

No production URL, project ID, signed build, or device result is assumed by this
document. Completing this checklist requires those actual release artifacts.
Android is outside this release.

## Configured backend

The owner supplied `https://moonbat.ddns.net` as the self-hosted production origin.
Set `EXPO_PUBLIC_API_BASE_URL=https://moonbat.ddns.net` in the native build's
production environment. This value has been configured in Replit's production
environment; it is not a Git-tracked environment file. If building from another
environment, configure the same public value there.

Unauthenticated HTTPS checks returned JSON from `/api/auth/me` and `/api/news`.
These checks establish basic reachability, not the live server's code version,
authenticated native registration, or remote push delivery.

Before TestFlight verification, push the release code to the owner's Git remote
and deploy it on the self-hosted machine. The existing `selfhost/update.sh` pulls,
installs, rebuilds, and restarts the site; plan for downtime and preserve local
configuration. Do not assume the live server has these changes until the owner
has deployed them.

## Physical iPhone acceptance checklist

Record the tested build number, iOS version, date, and pass/fail observations.
Do not record passwords, session cookies, or full push tokens.

- **Sign-in:** Sign in with an existing account. Force-quit and relaunch.
  Confirm Profile still shows the signed-in account and protected API actions work.
  If the native cookie session does not survive, treat that as a release blocker.
- **Permission:** Enable news alerts in Profile. Grant notification permission.
  Confirm registration succeeds. Separately check denial produces a useful
  error and enabling permission in iOS Settings allows a retry.
- **Registration:** Confirm the production API saves this device against the
  correct signed-in account. An enabled button alone does not prove registration.
- **Delivery:** Lock/background the iPhone. From a different administrator
  account, publish a real new news post. Confirm its alert reaches the phone.
  The author is excluded from the broadcast, so use different accounts.
- **Warm tap:** Tap an alert while the app is running/backgrounded. Confirm
  it opens the News tab. Refresh if needed and confirm the new post is present.
- **Cold tap:** Force-quit, publish another post from the administrator account,
  and tap its alert. Confirm the app launches into News.
- **Disable:** Disable alerts in Profile, restart the app, and confirm the
  disabled state persists. Publish another post and confirm no new alert arrives.
  Already delivered notifications do not count as a new delivery.
- **Sign-out:** Re-enable alerts, then sign out. Force-quit and relaunch.
  Confirm Profile remains signed out, protected requests are rejected, and
  a subsequent news post produces no new alert on this device.

Expo web, Expo Go on iOS, local notifications, and Expo's acceptance of a push
request do **not** establish native remote delivery. Require the observed
TestFlight/iPhone results before declaring this release complete.

## Official instructions

- https://docs.replit.com/build/mobile-upload-ios
- https://docs.replit.com/build/mobile-testflight
- https://docs.replit.com/build/mobile-push-notifications
