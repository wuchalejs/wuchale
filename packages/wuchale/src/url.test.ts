// $ node --import ../testing/resolve.ts %f

import { test } from 'node:test'
import { URLMatcher } from './url.js'

test('URL matcher', t => {
    const matcher = URLMatcher([['/'], ['/path', ['/path', '/ruta']], ['/*rest', ['/*rest', '/*rest']]], ['en', 'es'])
    t.assert.deepEqual(matcher('/', 'en'), {
        path: '/',
        altPatterns: { en: '/', es: '/' },
        params: {},
    })
    t.assert.deepEqual(matcher('/foo', 'es'), {
        path: '/foo',
        altPatterns: { en: '/*rest', es: '/*rest' },
        params: { rest: 'foo' },
    })
    t.assert.deepEqual(matcher('/ruta', 'es'), {
        path: '/path',
        altPatterns: { en: '/path', es: '/ruta' },
        params: {},
    })
})
