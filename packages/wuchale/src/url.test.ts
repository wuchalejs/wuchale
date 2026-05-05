// $ node --import ../testing/resolve.ts %f

import { type TestContext, test } from 'node:test'
import { compilePattern, matchPattern, stringifyPattern, URLMatcher } from './url.js'

const cases = [
    // Exact
    ['/foo/bar', '/foo/bar', []],
    ['/foo/bar', '/foo/baz', false],
    ['/foo/bar', '/foo/bar/baz', false],

    // * within segment
    ['/foo/*', '/foo/bar', ['bar']],
    ['/foo/*', '/foo/', false],
    ['/foo/*', '/foo/bar/baz', false],
    ['/foo/*', '/foo', false],

    // * as partial segment
    ['/foo-*/bar', '/foo-123/bar', ['123']],
    ['/foo-*/bar', '/foo-/bar', false],
    ['/foo-*/bar', '/fooX/bar', false],
    ['/foo-*-baz', '/foo-bar-baz', ['bar']],

    // ** positions
    ['/**/foo', '/foo', ['']],
    ['/**/foo', '/bar/baz/foo', ['/bar/baz']],
    ['/**/foo', '/bar', false],
    ['/foo/**', '/foo', ['']],
    ['/foo/**/bar', '/foo/x/y/z/bar', ['/x/y/z']],
    ['/foo/**/bar', '/foo/x/baz', false],

    // * and ** combined
    ['/foo/*/**', '/foo/bar', ['bar']],
    ['/foo/*/**', '/foo', false],
    ['/**/*', '/foo', ['/foo']],
    ['/**/*', '/', false],

    // root
    ['/', '/', []],
    ['/', '/foo', false],
    ['/**', '/', ['/']],
    ['/**', '', false],
    ['/*', '/', false],

    // trailing/double slash
    ['/foo/bar', '/foo/bar/', []],
    ['/foo/**/bar', '/foo//bar', ['/']],

    // complex groups
    ['/foo/*/**/*/bar', '/foo/a/b/bar', ['a/b']],
    ['/foo/*/**/*/bar', '/foo/a/x/y/b/bar', ['a/x/y/b']],
    ['/foo/*/**/*/bar', '/foo/a/bar', false],
    ['/foo/*/**/*/*/bar/*', '/foo/a/x/y/z/b/c/bar/d', ['a/x/y/z/b/c', 'd']],
    ['/foo/*/**/*/*/bar/*', '/foo/a/b/bar/d', false],
] as const

test('URL pattern matcher', (t: TestContext) => {
    for (const [p, u, exp] of cases) {
        const compiled = compilePattern(p)
        const res = matchPattern(compiled, u)
        t.assert.deepStrictEqual(res, exp, `Match failed: ${p} on ${u}`)
    }
})

test('URL pattern compile and stringify', (t: TestContext) => {
    for (const [p, u, dyn] of cases) {
        if (dyn === false) {
            continue
        }
        const compiled = compilePattern(p)
        let str = stringifyPattern(compiled, dyn)
        if (str.length > 1 && u.endsWith('/')) {
            str += '/'
        }
        t.assert.equal(str, u, `Compile stringify failed: ${p} on ${u} with ${JSON.stringify(dyn)}`)
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
