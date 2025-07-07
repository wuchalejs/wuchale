/** @type {import('./$types').EntryGenerator} */

import type {EntryGenerator} from './$types'

export const entries: EntryGenerator = () => {
	return [
		{ locale: 'en' },
		{ locale: 'es' },
		{ locale: 'fr' },
	];
}

export const prerender = true;
