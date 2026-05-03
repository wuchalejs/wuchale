// $ node --import ../testing/resolve.ts %f

import { test } from 'node:test'
import { compilePattern, matchPattern, URLMatcher } from './url.js'

const cases = [
    // Exact (no wildcards)
    ['/foo/bar', '/foo/bar', true],
    ['/foo/bar', '/foo/baz', false],
    ['/foo/bar', '/foo/bar/baz', false],

    // * within segment
    ['/foo/*', '/foo/bar', true],
    ['/foo/*', '/foo/', false],
    ['/foo/*', '/foo/bar/baz', false],
    ['/foo/*', '/foo', false],

    // * as partial segment
    ['/foo-*/bar', '/foo-123/bar', true],
    ['/foo-*/bar', '/foo-/bar', false],
    ['/foo-*/bar', '/foo/bar', false],
    ['/foo-*/bar', '/fooX/bar', false],
    ['/*-bar', '/foo-bar', true],
    ['/*-bar', '/foo-baz', false],
    ['/foo-*-baz', '/foo-bar-baz', true],
    ['/foo-*-baz', '/foo-bar', false],

    // ** zero segments
    ['/**/foo', '/foo', true],
    ['/foo/**', '/foo', true],
    ['/foo/**/bar', '/foo/bar', true],

    // ** one or more segments
    ['/foo/**', '/foo/bar', true],
    ['/foo/**', '/foo/bar/baz', true],
    ['/foo/**', '/foo/bar/baz/bee', true],
    ['/**/foo', '/bar/foo', true],
    ['/**/foo', '/bar/baz/foo', true],
    ['/**/foo', '/bar', false],

    // ** in middle
    ['/foo/**/bar', '/foo/x/bar', true],
    ['/foo/**/bar', '/foo/x/y/z/bar', true],
    ['/foo/**/bar', '/foo/x/baz', false],

    // * and ** combined
    ['/foo/*/**', '/foo/bar/baz', true],
    ['/foo/*/**', '/foo/bar', true], // ** = zero
    ['/foo/*/**', '/foo', false], // * requires something
    ['/**/*', '/foo/bar', true],
    ['/**/*', '/foo/bar/baz', true],
    ['/**/*', '/foo', true],

    // root and minimal paths
    ['/', '/', true],
    ['/', '/foo', false],
    ['/**', '/', true],
    ['/**', '/foo', true],
    ['/**', '/foo/bar', true],
    ['/*', '/', false],
    ['/**', '', false],

    // trailing and double slash handling
    ['/foo/bar', '/foo/bar/', true],
    ['/foo/bar/', '/foo/bar', true],
    ['/foo/*', '/foo/bar/', true],
    ['/foo/**/bar', '/foo//bar', true],
] as const

test('URL pattern matcher', t => {
    for (const [p, u, exp] of cases) {
        const comp = compilePattern(p)
        const res = matchPattern(comp, u)
        t.assert.equal(res, exp, `Match failed: ${p} on ${u}`)
    }
})

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
