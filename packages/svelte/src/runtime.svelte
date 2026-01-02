<script>
const { n = false, x, t, a } = $props()
</script>

{#each x as fragment, i}
    {#if typeof fragment === 'string'}
        {fragment}
    {:else if typeof fragment === 'number'}
        {#if !n || i > 0}
            {a[fragment]}
        {/if}
    {:else}
        {@const tag = t[fragment[0]]}
        {#if tag == null}
            [i18n-404:tag]
        {:else}
            {@render tag(fragment)}
        {/if}
    {/if}
{/each}
