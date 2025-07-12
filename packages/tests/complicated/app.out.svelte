<script>
    import {wuchaleTrans, wuchaleTransCtx, wuchaleTransPlural, wuchalePluralsRule} from "wuchale/runtime.svelte.js"
    import WuchaleTrans from "wuchale/runtime.svelte"
    const normalParam = 44;
    function someFunction(a, b, c) {
        const value = wuchaleTrans(9)
        const next = wuchaleTrans(10, [a, b])
        return next + c + value
    }
    async function someFunctionAsync() {
        const json = {}
        json.name = wuchaleTrans(11)
        return json
    }
    export const arrow = (msg) => {
        alert(wuchaleTrans(12, [msg]))
    }
    const collection = { members: [1] };
    const someJSEven = 34;
    const obj = $derived({
        property: {
            ["non-extracted text"]: { [wuchaleTrans(1)]: 42 },
        },
    });
    const p = {
        id: 23,
        name: 'foo',
    }
    const derived = $derived.by(() => {
        const f = wuchaleTrans(13)
        if (!f) return
        let e = {}
        if (f == 'something else') {
            let d = wuchaleTrans(14)
            d = d + wuchaleTrans(15)
            return d
        } else if (f == wuchaleTrans(16)) {
            return f
        } else {
            for (const q of [1,2,3]) {
                e[`${q}/${collection.members[0]}`] = {...p, name: wuchaleTrans(17)}
            }
            e.default = [f, wuchaleTrans(18), e]
        }
        console.log("Don't translate this.")
        $inspect('Not this either')
        return {
            [wuchaleTrans(18)]: f,
            butNotThis: wuchaleTrans(19),
            e
        }
    })
</script>

<div>{definition('foo', wuchaleTrans(0))}</div>

<p>
    {#snippet wuchaleSnippet4(ctx)}
        <i class="not-extracted" title={wuchaleTrans(2)}
        >
            {#snippet wuchaleSnippet1(ctx)}
                <b>
                    {#snippet wuchaleSnippet0(ctx)}
                        <u>{wuchaleTransCtx(ctx)}</u>
                    {/snippet}
                    <WuchaleTrans tags={[wuchaleSnippet0]} ctx={ctx} args={[`with ${someJSEven}` + "foo"]} />
                </b>
            {/snippet}
            <WuchaleTrans tags={[wuchaleSnippet1]} ctx={ctx} />
        </i
        >
    {/snippet}<!-- foo bar -->
    {#snippet wuchaleSnippet5()}
        {#if someFunction(wuchaleTrans(3), normalParam, [/* @wc-include */ wuchaleTrans(4)])}
            {#snippet wuchaleSnippet3()}
                {#each collection.members as member}
                    <!-- What not -->
                    {#snippet wuchaleSnippet2()}
                        {#await someFunctionAsync(a) then json}
                            <b>{wuchaleTrans(5, [json.title])}</b>
                        {/await}
                    {/snippet}
                    <WuchaleTrans tags={[wuchaleSnippet2]} id={6} args={[member]} />
                {/each}
            {/snippet}
            <WuchaleTrans tags={[wuchaleSnippet3]} id={7} />
        {/if}
    {/snippet}
    <WuchaleTrans tags={[wuchaleSnippet4, wuchaleSnippet5]} id={8} args={[obj.property["non-extracted text"][wuchaleTrans(1)]]} />
</p>

<!-- @wc-ignore -->
But ignore me
