import { type Matcher } from 'picomatch'
import { getKey, IndexTracker } from '../adapters.js'
import { type CompiledElement } from '../compile.js'
import { type Catalog, type CatalogStorage, defaultPluralRule, fillTranslations, type PluralRules } from '../storage.js'

export type Compiled = {
    hasPlurals: boolean
    items: CompiledElement[]
}

export type CompiledCatalogs = Map<string, Compiled>

/**
 * plural rule expressions should be
 * - made of ternary and binary expressions
 * - involve the variable n
 * - always return a number >= 0
 */
function validatePluralRule(body: string) {
    // strip valid tokens, if anything remains it's suspicious
    const stripped = body
        .replace(/[0-9]+/g, '')
        .replace(/\bn\b/g, '')
        .replace(/[%!=<>?:()&|+\-\s]/g, '')
    if (stripped.length > 0) {
        return false
    }
    // check if it returns a number, just an example
    const num = eval(`(n => ${body})(42)`)
    return !isNaN(num) && num >= 0
}

/** shared states among multiple adapters handlers */
export class SharedState {
    ownerKey: string
    sourceLocale: string
    otherFileMatches: Matcher[] = []
    compiled: CompiledCatalogs = new Map()
    indexTracker = new IndexTracker()

    // storage
    storage: CatalogStorage
    catalog: Catalog = new Map()
    pluralRules: PluralRules = new Map()

    constructor(storage: CatalogStorage, ownerKey: string, sourceLocale: string) {
        this.ownerKey = ownerKey
        this.sourceLocale = sourceLocale
        this.storage = storage
    }

    async load(locales: string[]) {
        const loaded = await this.storage.load()
        this.pluralRules = loaded.pluralRules ?? new Map()
        for (const loc of locales) {
            if (!this.pluralRules.has(loc)) {
                this.pluralRules.set(loc, defaultPluralRule)
                continue
            }
            const plural = this.pluralRules.get(loc)!.plural
            if (!validatePluralRule(plural)) {
                throw new Error(`[${this.ownerKey}]: invalid plural rule for ${loc}: ${plural}`)
            }
        }
        for (const item of loaded.items) {
            fillTranslations(item, locales)
            const id = item.translations.get(this.sourceLocale)!
            this.catalog.set(getKey(id, item.context), item)
        }
    }

    async save() {
        await this.storage.save({
            pluralRules: this.pluralRules,
            // Array important, cannot loop over map values multiple times!
            items: Array.from(this.catalog.values()),
        })
    }
}

type GranularState = {
    id: string
    compiled: CompiledCatalogs
    indexTracker: IndexTracker
}

export class State {
    byFile: Map<string, GranularState> = new Map()
    byID: Map<string, GranularState> = new Map()

    writeProxies: () => Promise<void>
    generateLoadID: (filename: string) => string

    constructor(writeProxies: () => Promise<void>, generateLoadID: (filename: string) => string) {
        this.writeProxies = writeProxies
        this.generateLoadID = generateLoadID
    }

    async byFileCreate(filename: string, locales: string[]): Promise<GranularState> {
        let state = this.byFile.get(filename)
        if (state != null) {
            return state
        }
        const id = this.generateLoadID(filename)
        const stateG = this.byID.get(id)
        if (stateG) {
            state = stateG
        } else {
            const compiledLoaded: Map<string, Compiled> = new Map()
            state = {
                id,
                compiled: new Map(),
                indexTracker: new IndexTracker(),
            }
            for (const loc of locales) {
                state.compiled.set(
                    loc,
                    compiledLoaded.get(loc) ?? {
                        hasPlurals: false,
                        items: [],
                    },
                )
            }
            this.byID.set(id, state)
            await this.writeProxies()
        }
        this.byFile.set(filename, state)
        return state
    }
}
