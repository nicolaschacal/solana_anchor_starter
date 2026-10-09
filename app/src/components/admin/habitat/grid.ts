/** The shared tile grid (no 3D imports, so light code can use it). Tile (i, j) is centred at (OX + i, OZ + j). */
export const GX = 33;
export const GZ = 37;
export const OX = -16;
export const OZ = -28;
/** Any tile at this level or higher is a cliff: nothing walks or stands there. */
export const CLIFF_LEVEL = 3;
/** The tile an island is centred on. */
export const CENTRE_TILE = { i: 16, j: 25 };
