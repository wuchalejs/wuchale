import { type Matcher } from 'picomatch'
import { IndexTracker } from '../adapters.js'
import { type CompiledElement } from '../compile.js'
import { type Catalog, POFile } from './pofile.js'

export type Compiled = {
    hasPlurals: boolean
    items: CompiledElement[]
}

export type CompiledCatalogs = Map<string, Compiled>

export type SharedState = {
    ownerKey: string
    sourceLocale: string
    otherFileMatches: Matcher[]
    poFilesByLoc: Map<string, POFile>
    compiled: CompiledCatalogs
    extractedUrls: Map<string, Catalog>
    indexTracker: IndexTracker
}

/* shared states among multiple adapters handlers, by localesDir */
export type SharedStates = Map<string, SharedState>

export const newSharedState = (key: string, sourceLocale: string): SharedState => ({
    ownerKey: key,
    sourceLocale: sourceLocale,
    otherFileMatches: [],
    poFilesByLoc: new Map(),
    indexTracker: new IndexTracker(),
    compiled: new Map(),
    extractedUrls: new Map(),
})

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
        let state = this.byFile.get(filename)!
        if (state == null) {
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
        }
        return state
    }
}
