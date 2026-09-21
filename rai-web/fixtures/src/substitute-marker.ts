// Exported constant the build check greps for (W0-02 section 1): every substitute module imports and references it,
// so `npm run check:substitute-absent` proves no substitute reached web/dist or server/dist.
export const SUBSTITUTE_MARKER = 'RAI_DESK_SUBSTITUTE_MARKER' as const;
