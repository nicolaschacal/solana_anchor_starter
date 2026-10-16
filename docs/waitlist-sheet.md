# Waitlist emails in a Google Sheet

1. Create a Google Sheet (name it "reByters waitlist"). Row 1: `Date`, `Email`, `Source`.
2. In the sheet: Extensions > Apps Script. Replace the code with:

```js
var DISPOSABLE = ["mailinator.com","guerrillamail.com","10minutemail.com","tempmail.com","temp-mail.org","yopmail.com","trashmail.com","sharklasers.com","getnada.com","dispostable.com","maildrop.cc","throwawaymail.com","fakeinbox.com","mailnesia.com","mintemail.com","moakt.com","emailondeck.com","tempail.com"];
var MAX_PER_MINUTE = 20; // flood guard: more than this many new rows a minute are dropped

function doPost(e) {
  var d = {};
  try { d = JSON.parse(e.postData.contents); } catch (x) {}
  var email = String(d.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email) || email.length > 120) return ContentService.createTextOutput("bad");
  if (DISPOSABLE.indexOf(email.split("@")[1]) !== -1) return ContentService.createTextOutput("bad");
  if (Number(d.elapsed || 0) < 2500) return ContentService.createTextOutput("fast"); // bots submit instantly
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var cache = CacheService.getScriptCache();
    var n = Number(cache.get("n") || 0);
    if (n >= MAX_PER_MINUTE) return ContentService.createTextOutput("busy");
    cache.put("n", String(n + 1), 60);
    var sh = SpreadsheetApp.getActiveSheet();
    var seen = sh.getRange(2, 2, Math.max(sh.getLastRow() - 1, 1), 1).getValues().flat();
    if (seen.indexOf(email) === -1) sh.appendRow([new Date(), email, String(d.source || "")]);
  } finally { lock.releaseLock(); }
  return ContentService.createTextOutput("ok");
}
```

3. Deploy > New deployment > type "Web app". Execute as: Me. Who has access: Anyone. Deploy and authorize.
4. Copy the Web app URL (ends in `/exec`) and set it as `VITE_WAITLIST_SHEET_URL` (Vercel env var) or give it to Claude.

FormSubmit keeps emailing each address in parallel. Duplicates are skipped in the sheet.

## Updating the script
Apps Script > Deploy > Manage deployments > pencil icon > Version: New version > Deploy. The URL stays the same.

## Real CAPTCHA (optional, later)
Cloudflare Turnstile is free: create a widget, put the public site key on the page, and have this script check the token with the secret key kept in Script Properties. Needs a Cloudflare account; ask Claude to wire it once you have the keys.
