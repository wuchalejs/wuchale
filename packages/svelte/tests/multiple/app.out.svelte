<script>
    import _w_load_ from "../wuchale/tests/test-tmp/loader.svelte.js"
    import WuchaleTrans from "@wuchale/svelte/runtime.svelte"
    const _w_runtime_ = $derived(_w_load_('svelte'))
</script>
<h1>{_w_runtime_.t(0)}</h1>
<p>{_w_runtime_.t(1)}</p>
<p>
    {#snippet wuchaleSnippet0(ctx)}
        <b>{_w_runtime_.tx(ctx)}</b>
    {/snippet}
    <WuchaleTrans tags={[wuchaleSnippet0]} ctx={_w_runtime_.cx(2)} />
</p>
<p>
    {#snippet wuchaleSnippet1(ctx)}
        <b>{_w_runtime_.tx(ctx, ['text'])}</b>
    {/snippet}
    <WuchaleTrans tags={[wuchaleSnippet1]} ctx={_w_runtime_.cx(3)} />
</p>
<p>
    {#snippet wuchaleSnippet2()}
        <b>{console.log('expression')}</b>
    {/snippet}
    <WuchaleTrans tags={[wuchaleSnippet2]} ctx={_w_runtime_.cx(4)} />
</p>
<p>
{_w_runtime_.t(5, [1, 2, 3])}</p>
<p>
    {#snippet wuchaleSnippet3()}
        <b>
            <i>
                <img src="/foo.png" alt="foo" />
                <other-elements prop={navigator.doNotTrack}>{33}</other-elements>
            </i>
        </b>
    {/snippet}
    <WuchaleTrans tags={[wuchaleSnippet3]} ctx={_w_runtime_.cx(6)} />
</p>
