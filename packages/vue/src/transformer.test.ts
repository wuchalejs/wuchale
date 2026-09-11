// $ node --import ../../wuchale/testing/resolve.ts %f

import { test } from 'node:test'
import { IndexTracker, URLHandler } from 'wuchale'
// @ts-expect-error
import { transformTest, ts as vue } from '../../wuchale/testing/utils.ts'
import { defaultArgs, vueDefaultHeuristic } from './index.js'
import { VueTransformer } from './transformer.js'

const urlHandler = new URLHandler(['en'], 'en', {
    patterns: ['/translated/**', '/'],
    localize: true,
})
await urlHandler.initPatterns('foo', new Map(), new Map())

const catalogExpr = { plain: '_w_load_()', reactive: '_w_load_rx_()' }

const getOutput = (content: string, filename = 'test.vue') =>
    new VueTransformer(
        {
            content,
            filename,
            index: new IndexTracker(true),
            expr: catalogExpr,
            matchUrl: urlHandler.match,
        },
        vueDefaultHeuristic,
        defaultArgs.patterns,
        defaultArgs.runtime,
    ).transformSv('@wuchale/vue/runtime.vue')

const o = getOutput(vue`
    <template>
        <p>Hello {{abebe}} <i>There</i></p>
    </template>
`)

console.log(o.output('').code)

// test('Simple text and props destruct', async t => {
//     transformTest(
//         t,
//         await getOutput(vue`
//         <script setup>
//             const foo = 'Hello'
//         </script>
//         <template>
//             Hello
//         </template>
//         `),
//         vue`
//         <script>
//             import { _w_load_, _w_load_rx_ } from "./loader.js"
//             import W_tx_ from "@wuchale/vue/runtime.vue"
//             const _w_runtime_ = $derived(_w_load_rx_());
//             let { label = _w_runtime_(0) } = $props()
//         </script>
//         <div>
//             {_w_runtime_(0)}
//         </div>
//     `,
//         ['Hello', 'Hello'],
//     )
// })
//
