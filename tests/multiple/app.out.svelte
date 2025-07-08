<script>
    import {wuchaleTrans, wuchaleTransCtx, wuchaleTransPlural, wuchalePluralsRule} from "wuchale/runtime.svelte.js"
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
    {#snippet wuchaleSnippet1(ctx)}
        <b>{wuchaleTransCtx(ctx, [text])}</b>
    {/snippet}
    <WuchaleTrans tags={[wuchaleSnippet1]} id={3} />
</p>
<p>
    {#snippet wuchaleSnippet2()}
        <b>{expressionOnly}</b>
    {/snippet}
    <WuchaleTrans tags={[wuchaleSnippet2]} id={4} />
</p>
<p>
{wuchaleTrans(5, [1, 2, 3])}</p>
<p>
    {#snippet wuchaleSnippet3()}
        <b>
            <i>
                <Icon />
                <OtherComponent prop={prop} />
            </i>
        </b>
    {/snippet}
    <WuchaleTrans tags={[wuchaleSnippet3]} id={6} />
</p>
