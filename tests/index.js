import { test } from 'node:test'
import setupPreprocess from '../preprocess/index.js'
import {readFileSync} from 'node:fs'

const prep = setupPreprocess({localesDir: 'locales', locales: ['en', 'am'], importFrom: '../runtime.svelte'}).markup

const content = readFileSync('tests/test.svelte').toString()

console.log(prep({content, filename: 'foo'}).code)

test(function(t) {
    t.assert.strictEqual(2, 2)
})
