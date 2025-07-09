<script>
    import {wuchaleTrans, wuchaleTransCtx, wuchaleTransPlural, wuchalePluralsRule} from "wuchale/runtime.svelte.js"
    import WuchaleTrans from "wuchale/runtime.svelte"

    const normalParam = 44;

    function someFunction(a, b, c) {
        const value = wuchaleTrans(10)
        const next = wuchaleTrans(11, [a, b])
        return next + c + value
    }

    async function someFunctionAsync() {
        const json = {}
        json.name = wuchaleTrans(12)
        return json
    }

    export const arrow = (msg) => {
        alert(wuchaleTrans(13, [msg]))
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
        const f = wuchaleTrans(14)
        if (!f) return
        let e = {}
        if (f == 'something else') {
            let d = wuchaleTrans(15)
            d = d + wuchaleTrans(16)
            return d
        } else if (f == wuchaleTrans(17)) {
            return f
        } else {
            for (const q of [1,2,3]) {
                e[`${q}/${collection.members[0]}`] = {...p, name: wuchaleTrans(18)}
            }
            e.default = [f, wuchaleTrans(19), e]
        }
        console.log("Don't translate this.")
        $inspect('Not this either')
        return {
            [wuchaleTrans(19)]: f,
            butNotThis: wuchaleTrans(20),
            e
        }
    })
</script>

<div>{definition('foo', wuchaleTrans(0))}</div>

<p>
    {#snippet wuchaleSnippet2(ctx)}
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

    {#snippet wuchaleSnippet3()}
        {#if someFunction(wuchaleTrans(3), normalParam, [/* @wc-include */ wuchaleTrans(4)])}
            {wuchaleTrans(5)}
            {#each collection.members as member}
                {wuchaleTrans(6)} {member}
                <!-- What not -->
                {#await someFunctionAsync(a) then json}
                    <b>{wuchaleTrans(7, [json.title])}</b>
                {/await}
                {wuchaleTrans(8)}
            {/each}
        {/if}
    {/snippet}

    <WuchaleTrans tags={[wuchaleSnippet2, wuchaleSnippet3]} id={9} args={[obj.property["non-extracted text"][wuchaleTrans(1)]]} />
</p>
<!-- @wc-ignore -->
But ignore me
