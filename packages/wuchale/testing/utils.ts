import { statfs } from 'node:fs/promises'
import type { TestContext } from 'node:test'
import { getDefaultLoaderPath } from '../src/adapter-vanilla/index.js'
import { getKey, type TransformFunc, type TransformOutput } from '../src/adapters.js'
import type { FS } from '../src/fs.js'
import type { Item, StorageFactory } from '../src/storage.js'
import { newText, type Text } from '../src/text.js'

const header = 'import { _w_load_, _w_load_rx_ } from "./loader.js"' // just an example header

export const ts = (s: TemplateStringsArray) => s.join('') // syntax

export const testCatalog = {
    p: (n: number) => (n === 1 ? 0 : 1),
    c: [
        'Hello', // simple message
        ['Hello ', 0, '!'], // mixed message
        ['One item', '# items'], // plurals
        ['Hello ', 0, 1], // mixed message ending with arg
        'Raw \\${3}', // for String.raw
    ],
}

type TstTxt = Partial<Text>

export function trimLines(str?: string) {
    if (!str) {
        return
    }
    const result: string[] = []
    for (const line of str.split('\n')) {
        if (line.trim()) {
            result.push(line.trim())
        }
    }
    return result.join('\n')
}

export function transformTest(
    t: TestContext,
    { txts, output }: TransformOutput,
    expectedContent: string | undefined,
    expectedMsgs: (string | TstTxt)[],
) {
    const code = txts.length ? output(header).code : undefined
    t.assert.strictEqual(trimLines(code), trimLines(expectedContent))
    t.assert.strictEqual(
        txts.length,
        expectedMsgs.length,
        `Unexpected number of messages: ${txts.length} !== ${expectedMsgs.length}\n${txts.map(m => `  ${m.body[0]}`).join('\n')}`,
    )
    for (let [i, exp] of expectedMsgs.entries()) {
        if (typeof exp === 'string') {
            exp = { body: [exp] }
        }
        const txt = txts[i]!
        t.assert.deepStrictEqual(txt.body, exp.body, `Different msgStr`)
        for (const prop of ['context', 'placeholders'] as const) {
            if (prop in exp) {
                t.assert.deepStrictEqual(txt[prop], exp[prop], `Different ${prop}`)
            }
        }
    }
}

export const testLoadersExist = async (loaders: string[], getLoaderPath = getDefaultLoaderPath) => {
    for (const loader of loaders) {
        for (const bundle of [false, true]) {
            const path = getLoaderPath(loader, bundle)
            const paths = typeof path === 'string' ? [path] : Object.values(path ?? {})
            for (const path of paths) {
                await statfs(path) // no error
            }
        }
    }
}

export const dummyTransform: TransformFunc = ctx => {
    const msgs: Text[] = []
    let out = ''
    for (const m of ctx.content.matchAll(/'\w+'/g)) {
        const msg = m[0].slice(1, -1)
        if (!ctx.index.has(getKey([msg]))) {
            continue
        }
        out += `${ctx.expr.plain}(${ctx.index.get(msg)})\n`
        msgs.push(newText({ body: [msg] }))
    }
    return {
        txts: msgs,
        output: header => ({
            code: `${header}\n${out}`,
            map: [],
        }),
    }
}

const inMemFiles = new Map<string, string>()

export const inMemFS: FS = {
    write: (file, data) => {
        inMemFiles.set(file, data)
    },
    read: file => inMemFiles.get(file) ?? null,
    mkdir: () => {},
    exists: file => inMemFiles.has(file),
    unlink: file => {
        const was = inMemFiles.has(file)
        inMemFiles.delete(file)
        return was
    },
}

export const inMemStorage: StorageFactory = () => {
    let stored: Item[] = []
    return {
        key: 'inMem',
        load: async () => stored,
        save: async items => {
            stored = items
        },
        files: [],
    }
}
