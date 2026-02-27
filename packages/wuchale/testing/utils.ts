import { type TestContext } from 'node:test'
import { statfs } from 'fs/promises'
import { getDefaultLoaderPath } from '../src/adapter-vanilla/index.js'
import { type Message, newMessage, type TransformFunc, type TransformOutput } from '../src/adapters.js'

const header = 'import { _w_load_, _w_load_rx_ } from "./loader.js"' // just an example header

export const ts = (s: TemplateStringsArray) => s.join('') // syntax

export const testCatalog = {
    p: (n: number) => (n == 1 ? 0 : 1),
    c: [
        'Hello', // simple message
        ['Hello ', 0, '!'], // mixed message
        ['One item', '# items'], // plurals
        ['Hello ', 0], // mixed message ending with arg
    ],
}

type TstMsg = Partial<Message>

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
    { msgs, output }: TransformOutput,
    expectedContent: string | undefined,
    expectedMsgs: (string | TstMsg)[],
) {
    const code = msgs.length ? output(header).code : undefined
    t.assert.strictEqual(trimLines(code), trimLines(expectedContent))
    t.assert.strictEqual(
        msgs.length,
        expectedMsgs.length,
        `Unexpected number of messages: ${msgs.length} !== ${expectedMsgs.length}\n${msgs.map(m => '  ' + m.msgStr[0]).join('\n')}`,
    )
    for (let [i, exp] of expectedMsgs.entries()) {
        if (typeof exp === 'string') {
            exp = { msgStr: [exp] }
        }
        const msg = msgs[i]
        t.assert.deepStrictEqual(msg.msgStr, exp.msgStr, `Different msgStr`)
        for (const prop of ['context', 'placeholders']) {
            if (prop in exp) {
                t.assert.deepStrictEqual(msg[prop], exp[prop], `Different ${prop}`)
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
    const msg = 'Hello'
    const out = `${ctx.expr.plain}(${ctx.index.get(msg)})`
    return {
        msgs: [newMessage({ msgStr: [msg] })],
        output: header => ({
            code: `${header}\n${out}`,
            map: [],
        }),
    }
}
