// $ node --import '#test-resolve' %f

import { test } from 'node:test'
import { URLMatcher } from './url.js'

test('URL matcher', t => {
    const matcher = URLMatcher(
        [
            ['/path', ['/en/path', '/es/ruta']],
            ['/*rest', ['/en/*rest', '/es/*rest']],
            ['/', ['/en', '/es']],
        ],
        ['en', 'es'],
    )
    t.assert.deepEqual(matcher(new URL('http://foo.js/')), {
        path: '/',
        locale: null,
        altPatterns: { en: '/en', es: '/es' },
        params: {},
    })
    t.assert.deepEqual(matcher(new URL('http://foo.js/en/foo')), {
        path: '/foo',
        locale: 'en',
        altPatterns: { en: '/en/*rest', es: '/es/*rest' },
        params: { rest: 'foo' },
    })
    t.assert.deepEqual(matcher(new URL('http://foo.js/en')), {
        path: '/',
        locale: 'en',
        altPatterns: { en: '/en', es: '/es' },
        params: {},
    })
    t.assert.deepEqual(matcher(new URL('http://foo.js/es/')), {
        path: '/',
        locale: 'es',
        altPatterns: { en: '/en', es: '/es' },
        params: {},
    })
    t.assert.deepEqual(matcher(new URL('http://foo.js/es/ruta')), {
        path: '/path',
        locale: 'es',
        altPatterns: { en: '/en/path', es: '/es/ruta' },
        params: {},
    })
})
