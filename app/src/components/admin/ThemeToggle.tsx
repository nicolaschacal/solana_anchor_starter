import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { setTheme, type Theme } from "../../lib/theme";

export function ThemeToggle() {
  const [theme, updateTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );
  return (
    <button
      className="icon theme-toggle"
      aria-label="Dark mode"
      aria-pressed={theme === "dark"}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => {
        const next = theme === "dark" ? "light" : "dark";
        setTheme(next);
        updateTheme(next);
      }}
    >
      {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
