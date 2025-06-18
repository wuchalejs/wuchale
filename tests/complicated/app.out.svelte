<script>import WuchaleTrans, {wuchaleTrans} from "wuchale/runtime.svelte"
    const obj = {
        property: {
            ["non-extracted text"]: { ["Extracted text"]: 42 },
        },
    };
    const normalParam = 44;
    function someFunction(a, b, c) {
        return true;
    }
    const collection = { members: [1] };
    const someJSEven = 34;
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
{/snippet}
{#snippet wuchaleSnippet1(ctx)}
    {#if someFunction(wuchaleTrans(2), normalParam, [wuchaleTrans(3)])}{wuchaleTrans(4)}{#each collection.members as member}{wuchaleTrans(5)}{member}
    {#await fetch("https://jsonplaceholder.typicode.com/todos/1") then res}
        {#await res.json() then json}
            <b>{wuchaleTrans(6, json.title)}</b>
        {/await}
    {/await}{wuchaleTrans(7)}{/each}
    {/if}
{/snippet}
<WuchaleTrans tags={[wuchaleSnippet0, wuchaleSnippet1]} id={8} args={[obj.property["non-extracted text"][wuchaleTrans(0)]]} />
</p>But ignore me
