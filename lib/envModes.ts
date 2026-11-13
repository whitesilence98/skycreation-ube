/**
 * The procedural HDR environments the scene can build.
 *
 * Kept out of `components/scene/environments.ts` because that module imports
 * three.js: the store's session validator has to agree on this vocabulary, and
 * the headless check scripts load the store in a bare `vm` context that has no
 * renderer. `ENV_CONFIG` there is typed `Record<EnvMode, …>`, so adding a mode
 * to this list without a config entry (or vice versa) fails the typecheck.
 */
export const ENV_MODES = ['off', 'studio', 'sunset', 'forest', 'tavern', 'dawn'] as const;

export type EnvMode = (typeof ENV_MODES)[number];
