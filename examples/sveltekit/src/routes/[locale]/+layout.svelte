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
                <li class="ml-6">{name}</li>
            {:else}
                <li class="ml-6 text-blue-600"><a href="/{locale}" data-sveltekit-preload-data="off">{name}</a></li>
            {/if}
        {/each}
    </ul>
</nav>

{@render children()}
