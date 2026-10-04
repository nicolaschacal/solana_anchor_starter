import { createContext } from "react";

export const PlayerPanelContext = createContext(false);

import type { usePlayerRebyters } from "../../hooks/usePlayerRebyters";

export const PlayerStateContext = createContext<ReturnType<
  typeof usePlayerRebyters
> | null>(null);
