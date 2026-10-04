import { createContext } from "react";

// Hidden game/panel scenes retain their resources without rendering frames.
export const ScenePausedContext = createContext(false);
