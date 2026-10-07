import SafeModule from "@safe-global/protocol-kit";

/**
 * @safe-global/protocol-kit is CommonJS. Under Node's ES modules its
 * default import is the whole module object, with the Safe class at
 * `.default`; under a bundler it is the class itself. Found by running
 * it: `Safe.init` was undefined, so every call threw before reaching the
 * network.
 */
export const SafeKit: typeof SafeModule = (SafeModule as unknown as { default?: typeof SafeModule }).default ?? SafeModule;
