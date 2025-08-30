<script>
    import _w_to_rt_ from 'wuchale/runtime'
    import _w_load_rx_,{get as _w_load_} from "./tests/test-tmp/loader.svelte.js"
    import W_tx_ from "@wuchale/svelte/runtime.svelte"
    const _w_runtime_ = $derived(_w_to_rt_(_w_load_rx_('svelte')))
</script>
<h1>{_w_runtime_.t(0)}</h1>
<p>{_w_runtime_.t(1)}</p>
<p>
    {#snippet _w_snippet_0(_w_ctx_)}
        <b>{_w_runtime_.tx(_w_ctx_)}</b>
    {/snippet}
    <W_tx_ t={[_w_snippet_0]} x={_w_runtime_.cx(2)} />
</p>
<p>
    {#snippet _w_snippet_1(_w_ctx_)}
        <b>
            <W_tx_ x={_w_ctx_} n a={['text']} />
        </b>
    {/snippet}
    <W_tx_ t={[_w_snippet_1]} x={_w_runtime_.cx(3)} />
</p>
<p>
    {#snippet _w_snippet_2()}
        <b>{console.log('expression')}</b>
    {/snippet}
    <W_tx_ t={[_w_snippet_2]} x={_w_runtime_.cx(4)} />
</p>
<p>
    <W_tx_ x={_w_runtime_.cx(5)} a={[1, 2, 3]} />
</p>
<p>
    {#snippet _w_snippet_3()}
        <b>
            <i>
                <img src="/foo.png" alt="foo" />
                <other-elements prop={navigator.doNotTrack}>{33}</other-elements>
            </i>
        </b>
    {/snippet}
    <W_tx_ t={[_w_snippet_3]} x={_w_runtime_.cx(6)} />
</p>
