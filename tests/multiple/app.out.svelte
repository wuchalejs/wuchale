<script>
    import {wuchaleTrans, wuchaleTransCtx} from "wuchale/runtime.svelte.js"
    import WuchaleTrans from "wuchale/runtime.svelte"
</script>
<h1>{wuchaleTrans(0)}</h1>
<p>{wuchaleTrans(1)}</p>
<p>
    {#snippet wuchaleSnippet0(ctx)}
        <b>{wuchaleTransCtx(ctx)}</b>
    {/snippet}
    <WuchaleTrans tags={[wuchaleSnippet0]} id={2} />
</p>
<p>
    {#snippet wuchaleSnippet0(ctx)}
        <b>{wuchaleTransCtx(ctx, [text])}</b>
    {/snippet}
    <WuchaleTrans tags={[wuchaleSnippet0]} id={3} />
</p>
<p>
    {#snippet wuchaleSnippet0(ctx)}
        <b>{expressionOnly}</b>
    {/snippet}
    <WuchaleTrans tags={[wuchaleSnippet0]} id={4} />
</p>
<p>
    {#snippet wuchaleSnippet0(ctx)}
        <b>
            <i>
                <Icon />
                <OtherComponent prop={prop} />
            </i>
        </b>
    {/snippet}
    <WuchaleTrans tags={[wuchaleSnippet0]} id={5} />
</p>
