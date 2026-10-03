import { isMammalPilot, MAMMAL_PILOT } from "../../lib/assets/catalog";
import { useEffect, useState } from "react";
import type { Evolution } from "../../lib/rebyters/types";

// Local concept sprites follow workbook body plans until production art is supplied.
export function CreatureSprite({ evolution: e }: { evolution: Evolution }) {
  const [failed, setFailed] = useState(false);
  const current = e.assets?.thumbnailUri || e.assets?.imageUri;
  const uri =
    isMammalPilot(e) &&
    (!current || current === "/assets/rebyters/mammal/mammal-exe.svg")
      ? MAMMAL_PILOT.thumbnailUri
      : current;
  useEffect(() => setFailed(false), [uri]);
  if (uri && !failed)
    return (
      <img
        className="creature-sprite"
        src={uri}
        alt=""
        onError={() => setFailed(true)}
      />
    );
  const name = e.name.toLowerCase();
  const family = `${e.family} ${name}`.toLowerCase();
  const aquatic = /cetacean|pinniped|dolphin|whale|seal|abyssal|leviathan/.test(
    family,
  );
  const bat = /chiropteran|bloodwing|\bbat\b/.test(family);
  const elephant = /proboscidean|mammoth|elephant/.test(family);
  const hoof = /ungulate|courser|behemoth|war beast/.test(family);
  const rabbit = /lagomorph|rabbit/.test(family);
  const round = /ursiform|rodent|primat|bear|ape|mouse|beaver|monkey/.test(
    family,
  );
  const fox = /fox|kitsune/.test(name);
  const mustelid = /musteloid|otter|wolverine|river trickster/.test(family);
  const rodent = /rodent|mouse|beaver/.test(family);
  const primate = /primat|monkey|ape/.test(family);
  const shadow = /shadow|eclipse/.test(name);
  const color = shadow
    ? "#55576d"
    : aquatic
      ? "#66baca"
      : bat
        ? "#b079b6"
        : elephant
          ? "#9dabc1"
          : hoof
            ? "#a6ba7c"
            : fox
              ? "#ecaa78"
              : mustelid
                ? "#c2b59a"
                : rodent
                  ? "#c7bb81"
                  : primate
                    ? "#b293a5"
                    : round
                      ? "#ad9c9d"
                      : rabbit
                        ? "#ead0d3"
                        : /moon|lunaris/.test(name)
                          ? "#c3ccdf"
                          : "#9bb9c0";
  return (
    <svg
      className={`creature-sprite sprite-stage-${e.stage}`}
      viewBox="0 0 80 72"
      aria-hidden="true"
    >
      <ellipse cx="40" cy="65" rx="24" ry="3" fill="#182e35" opacity=".1" />
      <g stroke="#35474b" strokeWidth="1.6" strokeLinejoin="round" fill={color}>
        {e.stage < 2 ? (
          <>
            {name === "fangbit" && (
              <path d="M22 32L19 13L34 26M47 26L58 14L58 36" />
            )}
            {name === "hoofbit" && (
              <path d="M24 49L22 63H31L33 47M48 47L49 63H58L56 47" />
            )}
            {name === "finbit" && (
              <path d="M25 37L8 30L16 50L29 53M54 36L70 28L65 49L53 52" />
            )}
            <path d="M17 48Q13 29 28 25Q34 14 46 23Q63 23 64 43Q68 60 49 60H31Q17 61 17 48Z" />
            <path
              d="M24 36Q28 29 34 31"
              fill="none"
              stroke="#fff"
              strokeWidth="3"
              opacity=".7"
            />
            {name === "pawbit" && (
              <path d="M18 52Q10 60 23 63L30 61M51 60Q66 67 65 55L58 52" />
            )}
            {name === "fangbit" && <path d="M43 47L46 53L49 46" fill="#fff" />}
            <path d="M30 40v4m19-4v4" stroke="#203941" strokeWidth="3" />
            <path d="M37 49q3 3 6 0" fill="none" />
          </>
        ) : aquatic ? (
          <>
            <path d="M21 35Q35 21 54 32L65 28L73 20L71 37L61 44Q49 60 22 51L10 44L19 42Z" />
            <path d="M36 34L42 20L48 33M36 49L43 61L49 49" />
            <path
              d="M18 44Q30 55 49 45"
              stroke="#e9f5ee"
              strokeWidth="5"
              fill="none"
            />
            <circle cx="25" cy="38" r="2.2" fill="#263b43" />
          </>
        ) : bat ? (
          <>
            <path d="M31 35L5 20L11 47L22 40L29 51H51L59 40L71 47L76 20L48 35" />
            <path d="M29 33L29 17L39 27L50 16L52 40L47 56H34L28 42Z" />
            <path d="M33 36h4m7 0h4" stroke="#fff" strokeWidth="3" />
          </>
        ) : (
          <>
            {fox ? (
              <path d="M47 46Q72 54 69 24Q78 43 68 58L46 57M52 44Q61 31 55 17Q73 33 59 52" />
            ) : (
              <path d="M55 47Q76 50 69 34" fill="none" strokeWidth="5" />
            )}
            <path
              d={
                round
                  ? "M22 39Q25 26 45 31Q63 34 61 53L59 63H49L47 54H33L31 63H20Z"
                  : "M22 40Q37 34 55 39L63 51L59 63H51L49 51H32L29 63H21L23 51Z"
              }
            />
            {elephant && (
              <>
                <ellipse cx="27" cy="36" rx="14" ry="17" />
                <path d="M18 38L12 57Q15 65 23 56L21 47" />
              </>
            )}
            {round || mustelid ? (
              <>
                <circle cx="19" cy="24" r={rodent ? 9 : mustelid ? 4 : 7} />
                <circle cx="42" cy="24" r={rodent ? 9 : mustelid ? 4 : 7} />
              </>
            ) : rabbit ? (
              <path d="M21 29Q11 0 21 5L30 26L33 4Q44 0 40 30" />
            ) : hoof ? (
              <path d="M21 28L16 11L23 19L28 15L30 29M37 28L41 11L47 16L42 27" />
            ) : (
              <path d="M17 32L16 12L30 24L42 13L44 36" />
            )}
            <path
              d={
                round
                  ? "M16 29Q28 20 42 28L46 39Q43 50 30 49Q14 48 16 29Z"
                  : "M16 28Q26 24 39 28L44 39L32 49L18 44L11 36Z"
              }
            />
            <path
              d="M17 39L27 43L33 39L31 47L23 46Z"
              fill="#eef1de"
              stroke="none"
            />
            {primate && (
              <path
                d="M19 29Q25 24 29 30Q36 24 41 30L39 44Q29 51 20 42Z"
                fill="#e6cfb9"
                stroke="none"
              />
            )}
            <path d="M19 33h3m12 0h3" stroke="#243741" strokeWidth="3" />
            <path d="M25 39h3" stroke="#243741" strokeWidth="2.5" />
            {elephant && (
              <path
                d="M16 39L13 53Q15 61 23 54"
                fill="none"
                stroke={color}
                strokeWidth="7"
              />
            )}
            {rodent && (
              <>
                <path d="M23 43v5h5v-5" fill="#fff" />
                <path d="M13 40L5 38M14 43L5 44" fill="none" strokeWidth="1" />
              </>
            )}
            {mustelid && (
              <>
                <path d="M13 38L6 36M14 42L5 43" fill="none" strokeWidth="1" />
                <path
                  d="M37 45L53 47L52 51L36 50"
                  fill="#ece0c8"
                  stroke="none"
                />
              </>
            )}
            {/deer|courser|lunaris/.test(name) && (
              <path
                d="M22 25L18 10L13 7M18 13L23 9M39 25L44 10L50 5M44 13L40 8"
                fill="none"
                strokeWidth="2.5"
              />
            )}
            {/boar|war beast|behemoth/.test(name) && (
              <path d="M14 39Q9 47 18 45M33 42Q39 45 40 36" fill="#fff" />
            )}
            {/horse|courser/.test(name) && (
              <path
                d="M42 22L51 35L48 46L43 39L38 26Z"
                fill="#586d62"
                stroke="none"
              />
            )}
            {/lynx/.test(name) && (
              <path d="M16 13L13 5M41 14L46 6" fill="none" strokeWidth="3" />
            )}
            {/hyena/.test(name) && (
              <g fill="#667878" stroke="none">
                <circle cx="48" cy="44" r="2" />
                <circle cx="41" cy="49" r="2" />
                <circle cx="55" cy="49" r="2" />
              </g>
            )}
            {/moon|lunaris/.test(name) && (
              <path
                d="M31 27Q23 30 31 36Q18 36 24 26Z"
                fill="#f9ebbd"
                stroke="none"
              />
            )}
          </>
        )}
        {e.stage >= 4 && (
          <path
            d="M39 45L44 38L51 44L48 54L40 53Z"
            fill={e.stage === 5 ? "#f4d57e" : "#dee4e5"}
          />
        )}
        {e.stage === 5 && (
          <path d="M29 15L26 6L34 11L40 3L45 12L54 8L50 19" fill="#f4d57e" />
        )}
      </g>
      {e.stage >= 4 && (
        <g fill={e.stage === 5 ? "#dbb758" : "#61aba5"}>
          <path d="M9 9h4v4H9zM65 8h3v3h-3zM73 56h3v3h-3z" />
        </g>
      )}
    </svg>
  );
}
