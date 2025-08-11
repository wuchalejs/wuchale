<script>
    import WuchaleTrans from "@wuchale/svelte/runtime.svelte"
    import _w_load_ from "./tests/test-tmp/loader.svelte.js"
    const _w_runtime_ = $derived(_w_load_('svelte'))

    const normalParam = 44;

    function someFunction(a, b, c) {
        const value = _w_runtime_.t(9)
        const next = _w_runtime_.t(10, [a, b])
        return next + c + value
    }
    async function someFunctionAsync(name) {
        const json = {}
        json.name = name ?? _w_runtime_.t(11)
        return json
    }
    export const arrow = (msg) => {
        alert(_w_runtime_.t(12, [msg]))
    }
    const collection = { members: [1] };
    const someJSEven = 34;
    const obj = $derived({
        property: {
            ["non-extracted text"]: { [_w_runtime_.t(1)]: 42 },
        },
    });
    const p = {
        id: 23,
        name: 'foo',
    }
    const derive = $derived.by(() => {
        const f = obj.property[_w_runtime_.t(13)]
        if (!f) return
        let e = {}
        if (f == 'something else') {
            let d = _w_runtime_.t(14)
            d = d + _w_runtime_.t(15)
            return d
        } else if (f == _w_runtime_.t(16)) {
            return f
        } else {
            for (const q of [1,2,3]) {
                e[`${q}/${collection.members[0]}`] = {...p, name: _w_runtime_.t(17)}
            }
            e.default = [f, _w_runtime_.t(18), e]
        }
        console.log("Don't translate this.")
        $inspect('Not this either')
        return {
            [_w_runtime_.t(18)]: f,
            butNotThis: _w_runtime_.t(19),
            e
        }
    })
</script>

<div>{someFunction('foo', _w_runtime_.t(0))}</div>

<p>
    {#snippet wuchaleSnippet4(_w_ctx_)}
        <i class="not-extracted" title={_w_runtime_.t(2)}
        >
            {#snippet wuchaleSnippet1(_w_ctx_)}
                <b>
                    {#snippet wuchaleSnippet0(_w_ctx_)}
                        <u>{_w_runtime_.tx(_w_ctx_)}</u>
                    {/snippet}
                    <WuchaleTrans tags={[wuchaleSnippet0]} ctx={_w_ctx_} nest args={[`with ${someJSEven}` + "foo"]} />
                </b>
            {/snippet}
            <WuchaleTrans tags={[wuchaleSnippet1]} ctx={_w_ctx_} nest />
        </i
        >
    {/snippet}<!-- foo bar -->
    {#snippet wuchaleSnippet5()}
        {#if someFunction(_w_runtime_.t(3), normalParam, [/* @wc-include */ _w_runtime_.t(4)])}
            {#snippet wuchaleSnippet3()}
                {#each collection.members as member}
                    <!-- What not -->
                    {#snippet wuchaleSnippet2()}
                        {#await someFunctionAsync(derive) then json}
                            <b>{_w_runtime_.t(5, [json.title])}</b>
                        {/await}
                    {/snippet}
                    <WuchaleTrans tags={[wuchaleSnippet2]} ctx={_w_runtime_.cx(6)} args={[member]} />
                {/each}
            {/snippet}
            <WuchaleTrans tags={[wuchaleSnippet3]} ctx={_w_runtime_.cx(7)} />
        {/if}
    {/snippet}
    <WuchaleTrans tags={[wuchaleSnippet4, wuchaleSnippet5]} ctx={_w_runtime_.cx(8)} args={[obj.property["non-extracted text"][_w_runtime_.t(1)]]} />
</p>

<!-- @wc-ignore -->
But ignore me
