import { type Matcher } from 'picomatch'
import { IndexTracker } from '../adapters.js'
import { type CompiledElement } from '../compile.js'
import type { StorageCollection } from '../storage.js'

export type Compiled = {
    hasPlurals: boolean
    items: CompiledElement[]
}

export type CompiledCatalogs = Map<string, Compiled>

/** shared states among multiple adapters handlers */
export type SharedState = {
    ownerKey: string
    sourceLocale: string
    otherFileMatches: Matcher[]
    storage: StorageCollection
    compiled: CompiledCatalogs
    indexTracker: IndexTracker
}

export class SharedStates {
    // by localesDir
    states: Map<string, SharedState> = new Map()

    getAdd = (storage: StorageCollection, key: string, sourceLocale: string, fileMatches: Matcher): SharedState => {
        let sharedState = this.states.get(storage.key)
        if (sharedState == null) {
            sharedState = {
                ownerKey: key,
                sourceLocale: sourceLocale,
                otherFileMatches: [],
                storage,
                indexTracker: new IndexTracker(),
                compiled: new Map(),
            }
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
