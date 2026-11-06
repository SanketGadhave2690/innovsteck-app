# Innovsteck App - setup and publishing guide (free)

The app now uses **email (Gmail) + password**, with a **real OTP sent to the user's email**,
**Sign in**, **Forgot password** and a password-protected **Admin login**.
The OTP emails are sent from YOUR Gmail by a free Google Apps Script server (innovsteck-backend.gs).
Without this server the app cannot register or sign in (it shows "server is not connected").

## Files
| File | Purpose |
|---|---|
| index.html | The whole app |
| innovsteck-backend.gs | Free server: sends OTP emails, stores users, bookings, admin data |
| manifest.json, sw.js | Make it installable and offline-capable |
| icon-192.png, icon-512.png, icon-maskable-512.png | App icons |
| privacy.html | Privacy policy (needed for Google Play) |
| .nojekyll | Needed on GitHub Pages |
| playstore/ | Screenshots and feature graphic for Google Play |

## STEP A - Create the server (10 minutes, free) - DO THIS FIRST
Use the Gmail account you want the OTP emails to come FROM (e.g. innovstekprojects@gmail.com).
1. Go to sheets.google.com and create a blank Google Sheet. Name it "Innovsteck Data".
2. In the Sheet: Extensions -> Apps Script.
3. Delete everything in the editor, paste ALL of innovsteck-backend.gs, click Save.
4. In the function drop-down choose  setup  and click Run. Google asks for permission
   (send email, use Sheets). Click Review permissions -> choose your account -> Advanced -> Go to project -> Allow.
5. Click the gear (Project Settings) -> Script properties -> Add script property:
      Property: ADMIN_PASSWORD      Value: a strong password only you know
   Save.
6. Deploy -> New deployment -> gear icon -> Web app.
      Execute as: Me      Who has access: Anyone      -> Deploy
7. Copy the Web app URL (it ends with /exec).
8. Open index.html in any text editor, find this line near the top of the script:
      var BACKEND_URL="";
   and paste the URL between the quotes. Save.
9. If you change the .gs file later: Deploy -> Manage deployments -> pencil icon -> Version: New version -> Deploy.

Limits to know: a normal Gmail account can send about 100 emails per day (Google's limit),
so about 100 OTP emails/day. Google Workspace allows more. The app limits each email address to
5 codes per hour. OTP emails can land in Spam the first time - tell users to check it.
To allow only @gmail.com addresses, set  var GMAIL_ONLY = true;  in the .gs file.

## STEP B - Put the app online (free)
1. Create a free account on github.com.
2. Create a public repository named exactly  YOURUSERNAME.github.io
3. Add file -> Upload files: upload index.html, sw.js, manifest.json, privacy.html, the 3 icons and .nojekyll.
4. Settings -> Pages -> Deploy from a branch -> main -> / (root) -> Save.
5. After 1-2 minutes the app is live at  https://YOURUSERNAME.github.io/
6. Update the WEBSITE line in index.html (still the old claude.ai link) to this address and upload index.html again.
   (To make phones pick up a new version, change VERSION in sw.js, e.g. innovsteck-v3 -> innovsteck-v4.)

## STEP C - Install on your phone
Open the link in Chrome on Android -> sign in -> tap "Install Innovsteck App".

## STEP D - Google Play Store (one-time USD 25 fee - the only paid step)
1. pwabuilder.com -> paste your link -> Start -> Package for stores -> Android -> Google Play.
   Package ID example: com.innovsteck.app
2. Download the zip. KEEP the signing key and password safe - you need them for every update.
3. Put the included assetlinks.json in your repo at  .well-known/assetlinks.json  (GitHub: Add file -> Create new file ->
   type  .well-known/assetlinks.json ). This removes the browser address bar.
4. play.google.com/console -> create developer account (USD 25) -> Create app -> upload the .aab.
5. Store listing: icon-512.png, playstore/feature-graphic-1024x500.png, the 5 screenshots in playstore/,
   privacy policy URL https://YOURUSERNAME.github.io/privacy.html
6. Data safety form: you collect Name and Email address and a password (account management). Not sold. Not shared with advertisers.
   Tell Google reviewers how to sign in: they can register with their own email, since OTP is real.
7. New personal accounts must run a closed test (about 12 testers for 14 days) before production.
FREE alternative: build the APK in PWABuilder, upload it to GitHub Releases and share the link.

## Admin
On the Sign in screen tap "Admin login" and enter the ADMIN_PASSWORD from Step A.
There you can add/edit projects and photos, change contact settings, and see users, bookings, messages and activity.
5 wrong admin passwords lock the admin login for 15 minutes.

## How the security works
- OTP is a random 6-digit code, valid 10 minutes, 5 wrong tries then it is cancelled, max 5 codes per hour per email.
- Passwords are never stored as plain text (salted + hashed). OTPs are never sent to the app, only to the email.
- 5 wrong sign-in attempts lock that account for 15 minutes.
- Forgot password gives the same answer whether or not the email is registered.
