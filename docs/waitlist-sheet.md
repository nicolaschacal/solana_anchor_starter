# Waitlist emails in a Google Sheet

1. Create a Google Sheet (name it "reByters waitlist"). Row 1: `Date`, `Email`, `Source`.
2. In the sheet: Extensions > Apps Script. Replace the code with:

```js
function doPost(e) {
  var d = {};
  try { d = JSON.parse(e.postData.contents); } catch (x) {}
  var email = String(d.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email) || email.length > 120) return ContentService.createTextOutput("bad");
  var sh = SpreadsheetApp.getActiveSheet();
  var seen = sh.getRange(2, 2, Math.max(sh.getLastRow() - 1, 1), 1).getValues().flat();
  if (seen.indexOf(email) === -1) sh.appendRow([new Date(), email, String(d.source || "")]);
  return ContentService.createTextOutput("ok");
}
```

3. Deploy > New deployment > type "Web app". Execute as: Me. Who has access: Anyone. Deploy and authorize.
4. Copy the Web app URL (ends in `/exec`) and set it as `VITE_WAITLIST_SHEET_URL` (Vercel env var) or give it to Claude.

FormSubmit keeps emailing each address in parallel. Duplicates are skipped in the sheet.
