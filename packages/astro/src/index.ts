import {
  defaultGenerateLoadID,
  deepMergeObjects,
  createHeuristic,
  defaultHeuristicOpts
} from "wuchale";
import {
  pluralPattern,
  getDefaultLoaderPath as getDefaultLoaderPathVanilla
} from "wuchale/adapter-vanilla";
import type {
  HeuristicFunc,
  Adapter,
  AdapterArgs,
  AdapterPassThruOpts,
  RuntimeConf,
  LoaderChoice,
  CreateHeuristicOpts
} from "wuchale";
import {
  AstroTransformer,
  type AstroTransformerConfig
} from "./transformer.js";
import { loaderPathResolver } from "wuchale/adapter-utils";

/**
 * Create a heuristic function optimized for Astro files
 * Uses the default heuristic which handles translatable vs non-translatable strings
 */
export function createAstroHeuristic(opts: CreateHeuristicOpts): HeuristicFunc {
  return createHeuristic(opts);
}

// Astro-specific heuristic options with framework API calls ignored
export const astroDefaultHeuristicOpts: CreateHeuristicOpts = {
  ...defaultHeuristicOpts,
  ignoreCalls: [
    ...(defaultHeuristicOpts.ignoreCalls ?? []),
    // Astro navigation APIs
    "Astro.redirect",
    "Astro.rewrite",
    // Astro response APIs
    "Astro.response.headers.set",
    "Astro.response.headers.append",
    "Astro.response.headers.delete",
    // Astro request APIs
    "Astro.request.headers.get",
    "Astro.request.headers.has",
    // Astro URL APIs
    "Astro.url.searchParams.get",
    "Astro.url.searchParams.has",
    // Astro cookies APIs
    "Astro.cookies.get",
    "Astro.cookies.has",
    "Astro.cookies.set",
    "Astro.cookies.delete"
  ]
};

export const astroDefaultHeuristic: HeuristicFunc = createAstroHeuristic(
  astroDefaultHeuristicOpts
);

type LoadersAvailable = "default" | "astro";

export type AstroArgs = AdapterArgs<LoadersAvailable> & {
  /**
   * Configuration for the Astro transformer
   */
  transformerConfig?: AstroTransformerConfig;
};

// Astro is SSR-only, so we use non-reactive runtime by default
const defaultRuntime: RuntimeConf = {
  useReactive: ({ funcName }) => {
    // Astro is SSR - always use non-reactive
    return {
      init: funcName == null ? null : false, // Only init in top-level functions
      use: false // Never use reactive in Astro SSR
    };
  },
  reactive: {
    wrapInit: (expr) => expr,
    wrapUse: (expr) => expr
  },
  plain: {
    wrapInit: (expr) => expr,
    wrapUse: (expr) => expr
  }
};

const defaultArgs: AstroArgs = {
  files: { include: "src/pages/**/*.astro", ignore: [] },
  localesDir: "./src/locales",
  patterns: [pluralPattern],
  heuristic: astroDefaultHeuristic,
  granularLoad: false,
  bundleLoad: false,
  loader: "default",
  generateLoadID: defaultGenerateLoadID,
  runtime: defaultRuntime
};

const resolveLoaderPath = loaderPathResolver(
  import.meta.url,
  "../src/loaders",
  "js"
);

export function getDefaultLoaderPath(
  loader: LoaderChoice<LoadersAvailable>,
  bundle: boolean
): string | null {
  if (loader === "custom") {
    return null;
  }
  if (loader === "default") {
    // Use the Astro loader
    let loaderName = "astro";
    if (bundle) {
      loaderName += ".bundle";
    }
    return resolveLoaderPath(loaderName);
  }
  // For 'astro' loader
  let loaderName = loader;
  if (bundle) {
    loaderName += ".bundle";
  }
  return resolveLoaderPath(loaderName);
}

/**
 * Create an Astro adapter for wuchale
 *
 * @example
 * ```js
 * // wuchale.config.js
 * import { adapter as astro } from '@wuchale/astro'
 *
 * export default defineConfig({
 *   adapters: {
 *     astro: astro({ files: 'src/pages/**\/*.astro' })
 *   }
 * })
 * ```
 */
export const adapter = (args: Partial<AstroArgs> = {}): Adapter => {
  const { heuristic, patterns, runtime, loader, transformerConfig, ...rest } =
    deepMergeObjects(args, defaultArgs);

  return {
    transform: async ({ content, filename, index, expr, matchUrl }) => {
      return new AstroTransformer(
        content,
        filename,
        index,
        heuristic,
        patterns,
        expr,
        runtime as RuntimeConf,
        matchUrl,
        transformerConfig
      ).transformAstro();
    },
    loaderExts: [".js", ".ts"],
    defaultLoaderPath: getDefaultLoaderPath(loader, rest.bundleLoad),
    runtime,
    getRuntimeVars: {
      reactive: "_w_load_" // Same for reactive and non-reactive in Astro
    },
    ...(rest as Omit<AdapterPassThruOpts, "runtime">)
  };
};

// Re-export useful types
export type {
  AstroTransformer,
  AstroTransformerConfig
} from "./transformer.js";
