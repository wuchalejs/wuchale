<script>
    import { getTranslations } from "@wuchale/svelte/runtime.svelte.js"
    import WuchaleTrans from "@wuchale/svelte/runtime.svelte"
    const wuchaleRuntime = getTranslations("svelte")

    const normalParam = 44;

    function someFunction(a, b, c) {
        const value = wuchaleRuntime.t(9)
        const next = wuchaleRuntime.t(10, [a, b])
        return next + c + value
    }
    async function someFunctionAsync() {
        const json = {}
        json.name = wuchaleRuntime.t(11)
        return json
    }
    export const arrow = (msg) => {
        alert(wuchaleRuntime.t(12, [msg]))
    }
    const collection = { members: [1] };
    const someJSEven = 34;
    const obj = $derived({
        property: {
            ["non-extracted text"]: { [wuchaleRuntime.t(1)]: 42 },
        },
    });
    const p = {
        id: 23,
        name: 'foo',
    }
    const derived = $derived.by(() => {
        const f = wuchaleRuntime.t(13)
        if (!f) return
        let e = {}
        if (f == 'something else') {
            let d = wuchaleRuntime.t(14)
            d = d + wuchaleRuntime.t(15)
            return d
        } else if (f == wuchaleRuntime.t(16)) {
            return f
        } else {
            for (const q of [1,2,3]) {
                e[`${q}/${collection.members[0]}`] = {...p, name: wuchaleRuntime.t(17)}
            }
            e.default = [f, wuchaleRuntime.t(18), e]
        }
        console.log("Don't translate this.")
        $inspect('Not this either')
        return {
            [wuchaleRuntime.t(18)]: f,
            butNotThis: wuchaleRuntime.t(19),
            e
        }
    })
</script>

<div>{definition('foo', wuchaleRuntime.t(0))}</div>

<p>
    {#snippet wuchaleSnippet4(ctx)}
        <i class="not-extracted" title={wuchaleRuntime.t(2)}
        >
            {#snippet wuchaleSnippet1(ctx)}
                <b>
                    {#snippet wuchaleSnippet0(ctx)}
                        <u>{wuchaleRuntime.tx(ctx)}</u>
                    {/snippet}
                    <WuchaleTrans tags={[wuchaleSnippet0]} ctx={ctx} nest args={[`with ${someJSEven}` + "foo"]} />
                </b>
            {/snippet}
            <WuchaleTrans tags={[wuchaleSnippet1]} ctx={ctx} nest />
        </i
        >
    {/snippet}<!-- foo bar -->
    {#snippet wuchaleSnippet5()}
        {#if someFunction(wuchaleRuntime.t(3), normalParam, [/* @wc-include */ wuchaleRuntime.t(4)])}
            {#snippet wuchaleSnippet3()}
                {#each collection.members as member}
                    <!-- What not -->
                    {#snippet wuchaleSnippet2()}
                        {#await someFunctionAsync(a) then json}
                            <b>{wuchaleRuntime.t(5, [json.title])}</b>
                        {/await}
                    {/snippet}
                    <WuchaleTrans tags={[wuchaleSnippet2]} ctx={wuchaleRuntime.cx(6)} args={[member]} />
                {/each}
            {/snippet}
            <WuchaleTrans tags={[wuchaleSnippet3]} ctx={wuchaleRuntime.cx(7)} />
        {/if}
    {/snippet}
    <WuchaleTrans tags={[wuchaleSnippet4, wuchaleSnippet5]} ctx={wuchaleRuntime.cx(8)} args={[obj.property["non-extracted text"][wuchaleRuntime.t(1)]]} />
</p>

<!-- @wc-ignore -->
But ignore me
