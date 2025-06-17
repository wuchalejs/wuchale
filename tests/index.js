import { test } from 'node:test'
import setupPreprocess from '../preprocess/index.js'
import {readFileSync} from 'node:fs'

const options = {otherLocales: ['am'], importFrom: '../runtime.svelte'}

// @ts-ignore
const preprocess = setupPreprocess(options)

const fname = 'tests/test.svelte'
// const fname = 'tests/test.svelte.js'
const content = readFileSync(fname).toString()
// const content = readFileSync('tests/test.svelte.js').toString()

const prep = await (await preprocess).transform.handler(content, fname)
console.log(prep.code)

test(function(t) {
    // @ts-ignore
    t.assert.strictEqual(2, 2)
})
