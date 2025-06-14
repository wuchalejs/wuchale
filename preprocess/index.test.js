import setupPreprocess from './index.js'
import {readFileSync} from 'node:fs'
import { expect, test } from 'vitest'

const prep = setupPreprocess({localesDir: 'locales', locales: ['en', 'am']}).markup

const content = readFileSync('test-data/test.svelte').toString()

console.log(prep({content, filename: 'foo'}).code)

test('test', () => {
    expect(3).toBe(3)
})
