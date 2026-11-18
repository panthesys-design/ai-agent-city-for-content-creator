// Shared by the server layout (reads it) and the client shell (writes it). Kept out of the
// "use client" module because constants exported from there arrive on the server as client references.
export const SIDEBAR_COOKIE = "cc_sidebar";
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
