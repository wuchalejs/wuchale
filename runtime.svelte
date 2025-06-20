<script>
    import {getCtx} from './dist/runtime.svelte.js'
    const {id = null, ctx, tags, args} = $props()
    const finalCtx = $derived(id != null ? getCtx(id) : ctx)
</script>

{#each finalCtx as fragment, i}
    {#if typeof fragment === 'string'}
        {fragment}
    {:else if typeof fragment === 'number'}
        {#if id != null || i > 0}
            {args[fragment]}
        {/if}
    {:else}
        {@const tag = tags[fragment[0]]}
        {#if tag == null}
            [i18n-404:tag]
        {:else}
            {@render tag(fragment)}
        {/if}
    {/if}
{/each}
