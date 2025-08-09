<script>
    import WuchaleTrans from "@wuchale/svelte/runtime.svelte"
    import _w_load_ from "./tests/test-tmp/loader.svelte.js"
    const _w_runtime_ = $derived(_w_load_('svelte'))
</script>
<h1>{_w_runtime_.t(0)}</h1>
<p>{_w_runtime_.t(1)}</p>
<p>
    {#snippet wuchaleSnippet0(_w_ctx_)}
        <b>{_w_runtime_.tx(_w_ctx_)}</b>
    {/snippet}
    <WuchaleTrans tags={[wuchaleSnippet0]} ctx={_w_runtime_.cx(2)} />
</p>
<p>
    {#snippet wuchaleSnippet1(_w_ctx_)}
        <b>{_w_runtime_.tx(_w_ctx_, ['text'])}</b>
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
