import { test } from 'node:test'
import setupPreprocess from '../preprocess/index.js'
import {readFileSync} from 'node:fs'

const options = {otherLocales: ['am'], importFrom: '../runtime.svelte'}

// @ts-ignore
const preprocess = setupPreprocess(options)

const content = readFileSync('tests/test.svelte').toString()
// const content = readFileSync('tests/test.svelte.js').toString()

const prep = await (await preprocess).transform.handler(content, 'foo.svelte.js')
console.log(prep.code)

test(function(t) {
    // @ts-ignore
    t.assert.strictEqual(2, 2)
})
