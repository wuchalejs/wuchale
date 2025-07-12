import { getContext, setContext } from 'svelte'
import { RunTime, type TranslationsModule } from "wuchale/runtime"

export function setTranslations(mod: TranslationsModule, key: string = '') {
    setContext(key, $state(new RunTime(mod)))
}

export const getTranslations = (key: string): RunTime => getContext(key)
