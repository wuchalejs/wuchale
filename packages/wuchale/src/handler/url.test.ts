// $ node --import ../../../../scripts/resolve.ts %f

import { test } from 'node:test'
import { patternFromTranslate, patternToTranslate } from './url.js'

test('Pattern to/fro', t => {
    t.assert.equal(patternToTranslate('/foo/*rest'), '/foo/{0}')
    // for some reason pathToRegexp repeats :bar resulting in 2, but it doesn't break anything
    t.assert.equal(patternToTranslate('/foo/:bar/baz{/*rest}'), '/foo/{2}/baz/{1}')
    t.assert.equal(patternFromTranslate('/foo/{0}/baz', [{ name: 'bar', type: 'param' }]), '/foo/:bar/baz')
    t.assert.equal(
        patternFromTranslate('/foo/{0}/{1}', [
            { name: 'bar', type: 'param' },
            { name: 'rest', type: 'wildcard' },
        ]),
        '/foo/:bar/*rest',
    )
})
