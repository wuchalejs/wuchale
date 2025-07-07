<script lang="ts">
    const { data, children} = $props()
    // @wc-ignore
    const locales = [
        ['en', 'English'],
        ['es', 'Español'],
        ['fr', 'Français'],
    ]
</script>

<nav>
    <ul>
        {#each locales as [locale, name]}
            {#if locale === data.locale}
                <li>{name}</li>
            {:else}
                <li><a href="/{locale}" data-sveltekit-preload-data="off">{name}</a></li>
            {/if}
        {/each}
    </ul>
</nav>

{@render children()}
