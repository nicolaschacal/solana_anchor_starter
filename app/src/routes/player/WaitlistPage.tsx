import { LandingBackdrop } from "../../components/world/LandingBackdrop";
import { LandingEmail } from "./LandingEmail";
import { SupportButton } from "./SupportButton";
import { LandingFeatures } from "./showcase/LandingFeatures";
import "./player.css";
import "./ui.css";

/**
 * What rebyters.xyz shows while the game is not open to the public: the island postcard and an email box,
 * nothing else. The game itself lives at play.rebyters.xyz (and on the vercel.app address).
 */
export function WaitlistPage() {
  return (
    <div className="player-bg rb-ui">
      <div className="player-shell game-frame">
        <main className="game-home landing-home">
          <section className="game-viewer game-world world-scene landing">
            <LandingBackdrop night={false} />
            <SupportButton />
            <div className="landing-logo"><img src="/assets/brand/logo.webp" alt="reByters" width="900" height="222" decoding="async" /><span><i />digital companions<i /></span></div>
            <div className="landing-sheet">
              <p>Leave your email to be first in.</p>
              <LandingEmail />
              <LandingFeatures />
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

/** rebyters.xyz and www.rebyters.xyz are the public waitlist page; `?waitlist=1` previews it anywhere. */
export function isWaitlistHost(): boolean {
  const host = window.location.hostname.toLowerCase();
  if (host === "rebyters.xyz" || host === "www.rebyters.xyz") return true;
  try {
    return new URLSearchParams(window.location.search).get("waitlist") === "1";
  } catch {
    return false;
  }
}
