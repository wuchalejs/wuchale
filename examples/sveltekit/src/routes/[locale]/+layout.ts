// src/routes/+layout.js
import { setTranslations } from 'wuchale/runtime.svelte.js'
import type { LayoutLoad } from './$types'
import { state } from '../../globals.svelte'

export const prerender = true

const locales = ['en', 'es', 'fr']

export const load: LayoutLoad = async ({params: {locale}}) => {
    if (!locales.includes(locale)) {
        return
    }
    state.locale = locale
    setTranslations(await import(`../../locales/${locale}.svelte.js`))
    return { locale }
}
