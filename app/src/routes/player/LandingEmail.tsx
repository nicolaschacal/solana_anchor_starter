import { useState } from "react";
import { ArrowRight, Check, Mail } from "lucide-react";
import { joinWaitlist, validEmail, waitlistOpen } from "../../lib/rebyters/waitlist";

const KEY = "rebyters.waitlist.joined";
const wasJoined = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

/** The start screen's only call to action: leave an email to hear when reByters opens. */
export function LandingEmail() {
  const [email, setEmail] = useState("");
  const [trap, setTrap] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">(wasJoined() ? "done" : "idle");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (state === "sending") return;
    if (trap) return setState("done");
    if (!validEmail(email)) {
      setState("error");
      return setMessage("Check that email address.");
    }
    if (!waitlistOpen()) {
      setState("error");
      return setMessage("The list opens very soon. Come back in a moment!");
    }
    setState("sending");
    try {
      await joinWaitlist(email);
      try {
        localStorage.setItem(KEY, "1");
      } catch {
        // fine: the thank-you just will not persist
      }
      setState("done");
    } catch {
      setState("error");
      setMessage("Could not save it. Try again in a moment.");
    }
  }

  if (state === "done")
    return (
      <div className="landing-email-done" role="status">
        <span><Check /></span>
        <strong>You're on the list!</strong>
        <small>We'll write to you when reByters opens.</small>
      </div>
    );

  return (
    <form className="landing-email" onSubmit={submit} noValidate>
      <div className="landing-email-field">
        <Mail aria-hidden="true" />
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="Your email"
          aria-label="Your email"
          value={email}
          maxLength={120}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state === "error") setState("idle");
          }}
        />
      </div>
      <input className="landing-email-trap" tabIndex={-1} autoComplete="off" aria-hidden="true" value={trap} onChange={(e) => setTrap(e.target.value)} name="website" />
      <button type="submit" className="landing-email-go" disabled={state === "sending"}>
        <strong>{state === "sending" ? "Saving…" : "Notify me"}</strong>
        <ArrowRight />
      </button>
      {state === "error" && <p className="landing-email-error" role="alert">{message}</p>}
    </form>
  );
}
