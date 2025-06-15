// $$ cd .. && npm run test

import Preprocess from "./prep.js"
import {writeFileSync, readFileSync} from 'node:fs'
import compileTranslations from "./compile.js"

export const defaultOptions = {locales: [], localesDir: '', importFrom: '../runtime.svelte'}

export default function setupPreprocess(options = defaultOptions) {

    const localeFile = loc => `${options.localesDir}/${loc}.json`

    function preprocess(toPreprocess) {
        const translations = {}
        for (const loc of options.locales) {
            try {
                const contents = readFileSync(localeFile(loc))
                translations[loc] = JSON.parse(contents.toString() || '{}')
            } catch (err) {
                if (err.code === 'ENOENT') {
                    translations[loc] = {}
                } else {
                    throw err
                }
            }
        }
        const prep = new Preprocess(options.importFrom)
        const txts = prep.process(toPreprocess)
        if (!txts.length) {
            return {}
        }
        let added = false
        for (const loc of options.locales) {
            for (const txt of txts) {
                if (txt in translations[loc]) {
                    continue
                }
                translations[loc][txt] = ''
                added = true
            }
        }
        if (added) {
            for (const loc of options.locales) {
                writeFileSync(localeFile(loc), JSON.stringify(translations[loc], null, 2))
                writeFileSync(`${options.localesDir}/${loc}.c.json`, JSON.stringify(compileTranslations(translations[loc]), null, 2))
            }
        }
        return {
            code: prep.mstr.toString(),
            map: prep.mstr.generateMap(),
        }
    }
    return {
        markup: preprocess,
    }
}
