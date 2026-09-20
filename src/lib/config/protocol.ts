/**
 * Protocol constants that must be identical in the browser (for instant
 * feedback) and on the server (which is the only place they're *enforced*).
 * No imports, so it is safe anywhere and trivial to unit test.
 */

/** PANDA's locked share of every coin's creator-fee pool, in basis points (5%). */
export const PANDA_SHARE_BPS = 500;

/** Most a creator can direct to their own chosen recipients (everything except PANDA's share). */
export const CREATOR_CONFIGURABLE_MAX_BPS = 10_000 - PANDA_SHARE_BPS;
