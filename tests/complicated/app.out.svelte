<script>
    import {wuchaleTrans} from "wuchale/runtime.svelte.js"
    import WuchaleTrans from "wuchale/runtime.svelte"

    const normalParam = 44;
    function someFunction(a, b, c) {
        return true;
    }
    const collection = { members: [1] };
    const someJSEven = 34;
    const obj = $derived({
        property: {
            ["non-extracted text"]: { [wuchaleTrans(0)]: 42 },
        },
    });
    const derived = $derived.by(() => {
        const f = wuchaleTrans(9)
        let e = ''
        if (f == 'something else') {
            let d = wuchaleTrans(10)
            d = d + wuchaleTrans(11)
            return d
        } else if (f == wuchaleTrans(12)) {
            return f
        } else {
            for (const q of [1,2,3]) {
                e += q + wuchaleTrans(13)
            }
            e = [f, wuchaleTrans(14), e]
        }
        return {
            [wuchaleTrans(14)]: f,
            butNotThis: wuchaleTrans(15),
            e
        }
    })
</script>

<p>
{#snippet wuchaleSnippet0(ctx)}
<i class="not-extracted" title={wuchaleTrans(1)}
        >
{#snippet wuchaleSnippet0(ctx)}
<b>
{#snippet wuchaleSnippet0(ctx)}
<u>{ctx[1]}</u>
{/snippet}
<WuchaleTrans tags={[wuchaleSnippet0]} ctx={ctx} args={[`with ${someJSEven}` + "foo"]} />
</b>
{/snippet}
<WuchaleTrans tags={[wuchaleSnippet0]} ctx={ctx} />
</i
    >
{/snippet}<!-- foo bar -->
    
{#snippet wuchaleSnippet1(ctx)}
{#if someFunction(wuchaleTrans(2), normalParam, [/* @wc-include */ wuchaleTrans(3)])}{wuchaleTrans(4)}{#each collection.members as member}{wuchaleTrans(5)}{member}
            <!-- What not -->
            {#await fetch("https://jsonplaceholder.typicode.com/todos/1") then res}
                {#await res.json() then json}
                    <b>{wuchaleTrans(6, json.title)}</b>
                {/await}
            {/await}{wuchaleTrans(7)}{/each}
    {/if}
{/snippet}

<WuchaleTrans tags={[wuchaleSnippet0, wuchaleSnippet1]} id={8} args={[obj.property["non-extracted text"][wuchaleTrans(0)]]} />
</p>
<!-- @wc-ignore -->
But ignore me
