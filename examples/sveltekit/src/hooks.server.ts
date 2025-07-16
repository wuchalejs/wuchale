import type { Handle } from '@sveltejs/kit'
import { initRegistry } from 'wuchale/runtime'

const locales = ['en', 'es', 'fr'];
const runWithCatalog = await initRegistry()

export const handle: Handle = async ({ event, resolve }) => {
	const locale = event.params.locale ?? 'en';
	const validLocale = locales.find(l => l === locale) ? locale : 'en';
	const catalog = await import(`./locales/${validLocale}.svelte.js`);
	return await runWithCatalog(catalog, () =>
		resolve(event, {
			transformPageChunk: ({ html }) => html.replace('%sveltekit.lang%', validLocale)
		})
	);
}
