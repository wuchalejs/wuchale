<script>
    import { getTranslations } from "@wuchale/svelte/runtime.svelte.js"
    import WuchaleTrans from "@wuchale/svelte/runtime.svelte"
    const wuchaleRuntime = getTranslations("svelte")
</script>
<h1>{wuchaleRuntime.t(0)}</h1>
<p>{wuchaleRuntime.t(1)}</p>
<p>
    {#snippet wuchaleSnippet0(ctx)}
        <b>{wuchaleRuntime.tx(ctx)}</b>
    {/snippet}
    <WuchaleTrans tags={[wuchaleSnippet0]} ctx={wuchaleRuntime.cx(2)} />
</p>
<p>
    {#snippet wuchaleSnippet1(ctx)}
        <b>{wuchaleRuntime.tx(ctx, [text])}</b>
    {/snippet}
    <WuchaleTrans tags={[wuchaleSnippet1]} ctx={wuchaleRuntime.cx(3)} />
</p>
<p>
    {#snippet wuchaleSnippet2()}
        <b>{expressionOnly}</b>
    {/snippet}
    <WuchaleTrans tags={[wuchaleSnippet2]} ctx={wuchaleRuntime.cx(4)} />
</p>
<p>
{wuchaleRuntime.t(5, [1, 2, 3])}</p>
<p>
    {#snippet wuchaleSnippet3()}
        <b>
            <i>
                <Icon />
                <OtherComponent prop={prop} />
            </i>
        </b>
    {/snippet}
    <WuchaleTrans tags={[wuchaleSnippet3]} ctx={wuchaleRuntime.cx(6)} />
</p>
