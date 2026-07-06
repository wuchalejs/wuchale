// $ node --import ../../testing/resolve.ts %f

import { type TestContext, test } from 'node:test'
// @ts-expect-error
import { transformTest, ts } from '../../testing/utils.ts'
import { IndexTracker, type RuntimeConf } from '../adapters.js'
import { URLHandler } from '../handler/url.js'
import { defaultArgs } from './index.js'
import { decideRTDetails, Transformer } from './transformer.js'

const catalogExpr = { plain: '_w_load_()', reactive: '_w_load_rx_()' }
const filename = 'test.ts'
const urlHandler = new URLHandler([], 'en')

const makeCtx = (content: string, index = new IndexTracker(true)) => ({
    content,
    index,
    filename,
    expr: catalogExpr,
    matchUrl: urlHandler.match,
})

const getOutput = (content: string, patterns = defaultArgs.patterns) =>
    new Transformer(makeCtx(content), defaultArgs.heuristic, patterns, defaultArgs.runtime).transform()

test('RT details', (t: TestContext) => {
    t.assert.deepStrictEqual(
        decideRTDetails(
            [
                { type: 'function', name: 'foo' },
                { type: 'assignment', left: false, targets: ['bar'] },
                { type: 'funcexpr', kind: 'arrow' },
            ],
            'foo.ts',
            {},
        ),
        { nested: true, file: 'foo.ts', ctx: {}, funcName: 'bar' },
    )
    t.assert.deepStrictEqual(decideRTDetails([{ type: 'function', name: 'foo' }], 'foo.ts', {}), {
        nested: false,
        file: 'foo.ts',
        ctx: {},
        funcName: 'foo',
    })
})

test('Simple expression and assignment', t => {
    transformTest(
        t,
        getOutput(ts`
        'No extraction!' // simple expression
        const varName = 'No extraction' // simple assignment
        const noExtract = call('Foo')
    `),
        undefined,
        [],
    )
})

test('Ignore file', t => {
    transformTest(
        t,
        getOutput(ts`
    // @wc-ignore-file
    function foo() {
        const varName = 'No extraction'
        const noExtract = call('Foo')
    }
    function bar() {
        return 'Ignored'
    }
    `),
        undefined,
        [],
    )
})

test('Inside function bodies', t => {
    transformTest(
        t,
        getOutput(ts`
        'use strict'
        function foo(): string {
            const varName = 'Hello'
            return varName
        }
        topLevelCallExpr(() => {
            alert("Hello")
        })
        const insideObj = {
            method: () => 'Inside func property',
        }
        const bar: (a: string) => string = (a) => {
            const foo = {
                'Extracted': 42,
                tagged: tag\`Hello\`,
                taggedWithExpr: tag\`Hello \${a}\`
            }
            return \`Hello \${a\}\`
        }
    `),
        ts`
        'use strict'
        import { _w_load_, _w_load_rx_ } from "./loader.js"

        function foo(): string {
            const _w_runtime_ = _w_load_();
            const varName = _w_runtime_(0)
            return varName
        }
        topLevelCallExpr(() => {
            const _w_runtime_ = _w_load_();
            alert(_w_runtime_(0))
        })
        const insideObj = {
            method: () => {
                const _w_runtime_ = _w_load_();
                return _w_runtime_(1)
            },
        }
        const bar: (a: string) => string = (a) => {
            const _w_runtime_ = _w_load_();
            const foo = {
                [_w_runtime_(2)]: 42,
                tagged: _w_runtime_.t(tag, 0),
                taggedWithExpr: _w_runtime_.t(tag, 3, [a])
            }
            return _w_runtime_(3, [a])
        }
    `,
        ['Hello', 'Hello', 'Inside func property', 'Extracted', 'Hello', 'Hello {0}', 'Hello {0}'],
    )
})

test('Inside class declarations', t => {
    transformTest(
        t,
        getOutput(ts`
        class foo {
            constructor() {
                return 'Hello'
            }

            foo() {
                return 'Hello'
            }
        }
    `),
        ts`
        import { _w_load_, _w_load_rx_ } from "./loader.js"

        class foo {
            constructor() {
                const _w_runtime_ = _w_load_();
                return _w_runtime_(0)
            }

            foo() {
                const _w_runtime_ = _w_load_();
                return _w_runtime_(0)
            }
        }
    `,
        ['Hello', 'Hello'],
    )
})

test('Runtime init place', t => {
    transformTest(
        t,
        getOutput(ts`
        function foo() {
            'foo'
            some.call()
            if (3 == 3) {
                return 42
            }
            return 'Hello'
        }
        function bar() {
            'foo'
            some.call()
            initSth()
            call('Hello')
            function initSth() {
                doSth()
            }
        }
    `),
        ts`
        import { _w_load_, _w_load_rx_ } from "./loader.js"

        function foo() {
            'foo'
            some.call()
            const _w_runtime_ = _w_load_();
            if (3 == 3) {
                return 42
            }
            return _w_runtime_(0)
        }
        function bar() {
            'foo'
            some.call()
            const _w_runtime_ = _w_load_();
            initSth()
            call(_w_runtime_(0))
            function initSth() {
                doSth()
            }
        }
    `,
        ['Hello', 'Hello'],
    )
})

test('useReactive nullish fallback stays boolean', t => {
    transformTest(
        t,
        new Transformer(
            makeCtx(
                ts`
                function foo() {
                    return 'Hello'
                }
            `,
            ),
            defaultArgs.heuristic,
            defaultArgs.patterns,
            {
                initReactive: () => false,
                useReactive: ({ funcName }) => (funcName == null ? false : undefined),
                plain: {
                    wrapInit: expr => expr,
                    wrapUse: expr => `plainUse(${expr})`,
                },
                reactive: {
                    wrapInit: expr => expr,
                    wrapUse: expr => `reactiveUse(${expr})`,
                },
            } as RuntimeConf,
        ).transform(),
        ts`
        import { _w_load_, _w_load_rx_ } from "./loader.js"

        function foo() {
            const _w_runtime_ = _w_load_();
            return plainUse(_w_runtime_)(0)
        }
    `,
        ['Hello'],
    )
})

test('Plural and patterns', t => {
    transformTest(
        t,
        getOutput(
            ts`
            const f = () => plural(items, ['One item', '# items'])
            function foo() {
                const format1 = format0(42)
                return [
                    format0(44),
                    format0(44, foo),
                    format0(44, 'en'),
                    format1(44),
                    format2('en'),
                    format2(),
                    format2(foo),
                ] && bar('Hello')
            }
        `,
            [
                { name: 'plural', args: ['other', 'message', 'pluralFunc'] },
                { name: 'format0', args: ['other', 'locale'] },
                { name: 'format1', args: ['other', 'other', 'locale', 'other'] },
                { name: 'format2', args: ['locale'] },
            ],
        ),
        ts`
            import { _w_load_, _w_load_rx_ } from "./loader.js"
            const f = () => {
                const _w_runtime_ = _w_load_();
                return plural(items, _w_runtime_.p(0), _w_runtime_._.p)
            }
            function foo() {
                const _w_runtime_ = _w_load_();
                const format1 = format0(42, _w_runtime_.l)
                return [
                    format0(44, _w_runtime_.l),
                    format0(44, foo),
                    format0(44, _w_runtime_.l),
                    format1(44, undefined, _w_runtime_.l),
                    format2(_w_runtime_.l),
                    format2(_w_runtime_.l),
                    format2(foo),
                ] && bar(_w_runtime_(1))
            }
    `,
        [{ body: ['One item', '# items'] }, 'Hello'],
    )
})

test('Partial on read dev mode', t => {
    const index = new IndexTracker(false)
    t.assert.equal(index.get('Hello'), 0) // first registered
    transformTest(
        t,
        new Transformer(
            makeCtx(
                ts`
                function foo(): string {
                    const varName = 'Hello'
                    return varName + 'There!'
                }
            `,
                index,
            ),
            defaultArgs.heuristic,
            defaultArgs.patterns,
            defaultArgs.runtime,
        ).transform(),
        ts`
            import { _w_load_, _w_load_rx_ } from "./loader.js"
            function foo(): string {
                const _w_runtime_ = _w_load_();
                const varName = _w_runtime_(0)
                return varName + 'There!'
            }
        `,
        ['Hello'], // no There! as it is new
    )
})
