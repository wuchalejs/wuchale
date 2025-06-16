import { test } from 'node:test'
import setupPreprocess from '../preprocess/index.js'
import {readFileSync} from 'node:fs'

const options = {otherLocales: ['am'], importFrom: '../runtime.svelte'}

// @ts-ignore
const preprocess = setupPreprocess(options).markup

const content = readFileSync('tests/test.svelte').toString()

const prep = preprocess({content, filename: 'foo'})
console.log(prep.code)
await prep.promise

test(function(t) {
    // @ts-ignore
    t.assert.strictEqual(2, 2)
})
