/**
 * Where the emails from the start screen go. Any form endpoint that accepts a JSON POST works
 * (Formspree: https://formspree.io/f/xxxx, a Google Apps Script web app, Getform, ...). Set it with
 * VITE_WAITLIST_URL at build time. The default is FormSubmit (free, no account): every address is
 * emailed to the owner, who confirms the endpoint once from the first activation email it sends.
 */
const ENDPOINT =
  (import.meta.env.VITE_WAITLIST_URL as string | undefined) ?? "https://formsubmit.co/ajax/nicolaschaccal@gmail.com";

export const waitlistOpen = () => ENDPOINT.length > 0;
export const validEmail = (value: string) => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value.trim()) && value.length <= 120;

export async function joinWaitlist(email: string): Promise<void> {
  if (!ENDPOINT) throw new Error("not-open");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ _subject: "New reByters waitlist email", _captcha: "false", _template: "table", email: email.trim().toLowerCase(), source: "reByters start screen", at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`failed-${res.status}`);
}
