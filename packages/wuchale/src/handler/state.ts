import { type Matcher } from 'picomatch'
import { IndexTracker, Message } from '../adapters.js'
import { type CompiledElement } from '../compile.js'
import { type Catalog, type CatalogStorage, type PluralRules } from '../storage.js'

export type Compiled = {
    hasPlurals: boolean
    items: CompiledElement[]
}

export type CompiledCatalogs = Map<string, Compiled>

/** shared states among multiple adapters handlers */
export class SharedState {
    ownerKey: string
    sourceLocale: string
    otherFileMatches: Matcher[] = []
    compiled: CompiledCatalogs = new Map()
    indexTracker = new IndexTracker()

    // storage
    catalog: Catalog
    pluralRules: PluralRules
    storage: CatalogStorage

    constructor(storage: CatalogStorage, ownerKey: string, sourceLocale: string) {
        this.ownerKey = ownerKey
        this.sourceLocale = sourceLocale
        this.storage = storage
        this.catalog = new Map()
    }

    async load() {
        const loaded = await this.storage.load()
        this.pluralRules = loaded.pluralRules
        for (const item of loaded.items) {
            const msgInfo = new Message(item.msgid, undefined, item.context)
            this.catalog.set(msgInfo.toKey(), item)
        }
    }

    async save() {
        await this.storage.save({
            pluralRules: this.pluralRules,
            items: this.catalog.values(),
        })
    }
}

export class SharedStates {
    // by localesDir
    states: Map<string, SharedState> = new Map()

    getAdd = (storage: CatalogStorage, key: string, sourceLocale: string, fileMatches: Matcher): SharedState => {
        let sharedState = this.states.get(storage.key)
        if (sharedState == null) {
            sharedState = new SharedState(storage, key, sourceLocale)
            this.states.set(storage.key, sharedState)
        } else {
            if (sharedState.sourceLocale !== sourceLocale) {
                throw new Error('Adapters with different source locales cannot share catalogs.')
            }
            sharedState.otherFileMatches.push(fileMatches)
        }
        return sharedState
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
