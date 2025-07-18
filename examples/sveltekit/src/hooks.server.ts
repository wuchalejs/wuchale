import type { Handle } from '@sveltejs/kit';
import { initRegistry } from 'wuchale/runtime';
import * as enCatalog from './locales/en.svelte.js';
import * as esCatalog from './locales/es.svelte.js';
import * as frCatalog from './locales/fr.svelte.js';

const catalogs: Record<string, typeof enCatalog> = {
  "en": enCatalog,
  "es": esCatalog,
  "fr": frCatalog
};

const runWithCatalog = await initRegistry();

export const handle: Handle = async ({ event, resolve }) => {
  const requestedLocale = event.params.locale ?? 'en';
  const locale = Object.keys(catalogs).find(l => l === requestedLocale) ?? "en";
  return await runWithCatalog(catalogs[locale], () =>
    resolve(event, {
      transformPageChunk: ({ html }) => html.replace('%sveltekit.lang%', locale)
    })
  );
};
