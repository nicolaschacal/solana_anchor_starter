import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Evolution } from "../../lib/rebyters/types";
import { CreatureArt, creatureSpriteUri } from "../admin/CreatureSprite";

function loadImage(src: string, anonymous = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (anonymous) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Creature art could not be loaded"));
    img.src = src;
  });
}

/** Throws when the image would taint a canvas (remote art served without CORS). */
function assertReadable(img: HTMLImageElement) {
  const probe = document.createElement("canvas");
  probe.width = probe.height = 2;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is not available");
  ctx.drawImage(img, 0, 0, 2, 2);
  ctx.getImageData(0, 0, 1, 1);
}

/** The drawn concept art the Lab falls back to, as a standalone SVG image URL. */
function artDataUrl(evolution: Evolution) {
  const host = document.createElement("div");
  const root = createRoot(host);
  flushSync(() => root.render(<CreatureArt evolution={evolution} />));
  const svg = host.querySelector("svg");
  if (!svg) {
    root.unmount();
    throw new Error("Creature art is missing");
  }
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", "320");
  svg.setAttribute("height", "288");
  const markup = new XMLSerializer().serializeToString(svg);
  root.unmount();
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup);
}

/**
 * The same art the Lab shows for a form: its thumbnail when it ships one,
 * otherwise the drawn concept sprite.
 */
export async function loadCreatureImage(evolution: Evolution): Promise<HTMLImageElement> {
  await Promise.resolve(); // keep the React render below out of the caller's effect
  const uri = creatureSpriteUri(evolution);
  if (uri) {
    try {
      const img = await loadImage(uri, true);
      assertReadable(img);
      return img;
    } catch {
      // Fall through to the drawn sprite, as CreatureSprite does.
    }
  }
  return loadImage(artDataUrl(evolution));
}
