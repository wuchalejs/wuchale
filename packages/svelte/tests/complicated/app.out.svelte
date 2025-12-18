<script module>
    const normalParam = 44;

    import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "../test-tmp/svelte.loader.svelte.js"
    import W_tx_ from "@wuchale/svelte/runtime.svelte"
    const _w_runtime_mod_ = $derived(_w_load_rx_('svelte'))


    function someFunction(a, b, c) {
        const _w_runtime_mod_ = _w_load_('svelte')
        const value = _w_runtime_mod_.t(0)
        const next = _w_runtime_mod_.t(1, [a, b])
        return next + c + value
    }
</script>

<script>
    const _w_runtime_ = $derived(_w_load_rx_('svelte'))
    async function someFunctionAsync(name) {
        const json = {}
        json.name = name ?? _w_runtime_.t(2)
        return json
    }
    export const arrow = (msg) => {
        alert(_w_runtime_.t(3, [msg]))
    }
    const collection = { members: [1] };
    const someJSEven = 34;
    const obj = $derived({
        property: {
            ["non-extracted text"]: { [_w_runtime_.t(4)]: 42 },
        },
    });
    const p = {
        id: 23,
        name: 'foo',
    }
    const derive = $derived.by(() => {
        const f = obj?.property?.[_w_runtime_.t(5)]
        if (!f) return
        let e = {}
        if (f == 'something else') {
            let d = _w_runtime_.t(6)
            d = d + _w_runtime_.t(7)
            return d
        } else if (f == _w_runtime_.t(8)) {
            return f
        } else {
            for (const q of [1,2,3]) {
                e[`${q}/${collection.members[0]}`] = {...p, name: _w_runtime_.t(9)}
            }
            e.default = [f, _w_runtime_.t(10), e]
        }
        console.log("Don't translate this.")
        $inspect('Not this either')
        return {
            [_w_runtime_.t(10)]: f,
            butNotThis: _w_runtime_.t(11),
            e
        }
    })
</script>

<svelte:head>
    <title>{_w_runtime_.t(12, [p.name])}</title>
</svelte:head>

<div>{someFunction('foo', _w_runtime_.t(13))}</div>

<p>
    {#snippet _w_snippet_4(_w_ctx_)}
        <i class="not-extracted" title={_w_runtime_.t(14)} data-mixed={_w_runtime_.t(15, ['handled'])}
        >
            {#snippet _w_snippet_1(_w_ctx_)}
                <b>
                    {#snippet _w_snippet_0(_w_ctx_)}
                        <u>{_w_runtime_.tx(_w_ctx_)}</u>
                    {/snippet}
                    <W_tx_ t={[_w_snippet_0]} x={_w_ctx_} n a={[`with ${someJSEven}` + "foo"]} />
                </b>
            {/snippet}
            <W_tx_ t={[_w_snippet_1]} x={_w_ctx_} n />
        </i
        >
    {/snippet}
    {#snippet someSnippet(alt)}
        <img src="http://foo" alt={alt} />
    {/snippet}
    <!-- and also -->
    {#snippet _w_snippet_5()}
        {#if someFunction(_w_runtime_.t(16), normalParam, [/* @wc-include */ _w_runtime_.t(17)])}
            {#snippet _w_snippet_3()}
                {#each collection.members as member}
                    {@const x = member[_w_runtime_.t(9)]}
                    <!-- What not -->
                    {#snippet _w_snippet_2()}
                        {#await someFunctionAsync(derive) then json}
                            {@render someSnippet(_w_runtime_.t(13))}
                            <b>
                                <W_tx_ x={_w_runtime_.cx(18)} a={[json.title]} />
                            </b>
                        {/await}
                    {/snippet}
                    <W_tx_ t={[_w_snippet_2]} x={_w_runtime_.cx(19)} a={[member, x]} />
                {/each}
            {/snippet}
            <W_tx_ t={[_w_snippet_3]} x={_w_runtime_.cx(20)} />
        {/if}
    {/snippet}
    <W_tx_ t={[_w_snippet_4, _w_snippet_5]} x={_w_runtime_.cx(21)} a={[obj.property["non-extracted text"][_w_runtime_.t(4)]]} />
</p>

<!-- @wc-ignore -->
But ignore me
