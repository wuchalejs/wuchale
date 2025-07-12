<script>
    const {nest = false, ctx, tags, args} = $props()
</script>

{#each ctx as fragment, i}
    {#if typeof fragment === 'string'}
        {fragment}
    {:else if typeof fragment === 'number'}
        {#if !nest || i > 0}
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
