// src/routes/+layout.js
import { setCatalog } from '@wuchale/svelte/runtime.svelte.js'
import type { LayoutLoad } from './$types'

export const prerender = true

const locales = ['en', 'es', 'fr']

export const load: LayoutLoad = async ({params: {locale}}) => {
    if (!locales.includes(locale)) {
        return
    }
    setCatalog(await import(`../../locales/${locale}.svelte.js`))
    return { locale }
}
