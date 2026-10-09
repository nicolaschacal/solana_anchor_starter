/** Placeholder SVG art for the four foods (the 3D models come later). index: meat, plants, fish, fruit. */
export function FoodArt({ food, size = 56 }: { food: number; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 64 64", "aria-hidden": true as const, className: "food-art" };
  switch (food) {
    case 0:
      return (
        <svg {...common}>
          <ellipse cx="28" cy="26" rx="19" ry="16" fill="#c0563b" />
          <ellipse cx="24" cy="22" rx="9" ry="6" fill="#dc7b5c" opacity=".7" />
          <rect x="38" y="36" width="9" height="19" rx="4" transform="rotate(-35 42 45)" fill="#f2e6cf" />
          <circle cx="50" cy="52" r="5" fill="#f2e6cf" />
          <circle cx="56" cy="46" r="4" fill="#f2e6cf" />
        </svg>
      );
    case 1:
      return (
        <svg {...common}>
          <path d="M32 58V30" stroke="#3f7a3a" strokeWidth="4" strokeLinecap="round" />
          <path d="M32 34C16 34 8 22 10 10c14 0 22 8 22 24Z" fill="#5fae4f" />
          <path d="M32 42C46 42 56 32 54 18c-14 0-22 10-22 24Z" fill="#7bc65f" />
          <path d="M32 34C26 28 20 22 12 14" stroke="#3f7a3a" strokeWidth="2" fill="none" />
        </svg>
      );
    case 2:
      return (
        <svg {...common}>
          <path d="M6 32c10-14 28-18 42-6l10-8v28l-10-8C34 50 16 46 6 32Z" fill="#4a8fc4" />
          <path d="M14 32c8-8 20-10 30-4-10 12-22 12-30 4Z" fill="#8fc6e8" opacity=".8" />
          <circle cx="18" cy="29" r="2.4" fill="#12324a" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M32 20c-14-8-26 2-24 18s14 22 24 18c10 4 22-2 24-18S46 12 32 20Z" fill="#d6483c" />
          <ellipse cx="22" cy="32" rx="5" ry="8" fill="#ee7c6f" opacity=".7" />
          <path d="M32 20c0-6 2-10 6-13" stroke="#5b3a21" strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M34 12c6-4 12-2 14 2-6 4-12 2-14-2Z" fill="#5fae4f" />
        </svg>
      );
  }
}
