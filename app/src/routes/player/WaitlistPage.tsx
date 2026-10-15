import { Gem, Heart, Mountain, Sprout } from "lucide-react";
import { LandingBackdrop } from "../../components/world/LandingBackdrop";
import { LandingEmail } from "./LandingEmail";
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
            <div className="landing-logo"><strong>reByters</strong><span><i />digital companions<i /></span></div>
            <div className="landing-sheet">
              <h1><b className="c1">Raise.</b> <b className="c2">Evolve.</b> <b className="c3">Explore.</b></h1>
              <p>Build your bond and grow your companions. Leave your email to be first in.</p>
              <LandingEmail />
              <div className="landing-features" aria-label="reByters features">
                <div><span><Heart /></span><small>RAISE</small></div>
                <div><span><Sprout /></span><small>EVOLVE</small></div>
                <div><span><Gem /></span><small>COLLECT</small></div>
                <div><span><Mountain /></span><small>EXPLORE</small></div>
              </div>
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
