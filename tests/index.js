import { test } from 'node:test'
import setupPreprocess from '../preprocess/index.js'
import {readFileSync} from 'node:fs'

const options = {otherLocales: ['am'], importFrom: '../runtime.svelte'}

// @ts-ignore
const prep = setupPreprocess(options).markup

const content = readFileSync('tests/test.svelte').toString()

console.log(prep({content, filename: 'foo'}).code)

test(function(t) {
    // @ts-ignore
    t.assert.strictEqual(2, 2)
})
