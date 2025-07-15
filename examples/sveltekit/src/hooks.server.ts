import type { Handle } from '@sveltejs/kit'
import { initRegistry } from 'wuchale/runtime'

const runWithCatalog = await initRegistry()

const locales = ['en', 'es', 'fr']

export const handle: Handle = async ({ event, resolve }) => {
    const locale = locales.find(l => l === event.params.locale)
    if (!locale) {
        return await resolve(event)
    }
    const catalog = await import(`./locales/${locale}.svelte.js`)
    return await runWithCatalog(catalog, async () => await resolve(event, {
		transformPageChunk: ({ html }) => {
			if (html.includes('%sveltekit.lang%')) {
				return html.replace('%sveltekit.lang%', locale);
			}
			return html;
		}
	});)
}
