import type { Handle } from '@sveltejs/kit'
import { initRegistry } from 'wuchale/runtime'

const runWithCatalog = await initRegistry()

const locales = ['en', 'es', 'fr']

export const handle: Handle = async ({ event, resolve }) => {
	const locale = event.params.locale ?? 'en';
	const catalog = await import(`./locales/${locale}.svelte.js`);
	return await runWithCatalog(catalog, () =>
		resolve(event, {
			transformPageChunk: ({ html }) => html.replace('%sveltekit.lang%', locale)
		})
	);
}
