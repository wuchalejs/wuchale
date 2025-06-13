<script module>
let loc = $state('am')
let txts = $state({})

export function initI18n() {
    $effect(() => {
        import(`../../locales/${loc}.c.json`).then(mod => {
            txts = mod.default
        })
    })
}

export function locale(newLocale = null) {
    if (newLocale) {
        loc = newLocale
    } else {
        return loc
    }
}

function getTranslation(id, args = []) {
    const translated = txts[id] || id
    if (typeof translated === 'string') {
        return [translated]
    }
    const arranged = []
    for (const fragment of translated) {
        if (typeof fragment === 'string') {
            arranged.push(fragment)
        } else if (typeof fragment === 'number') { // index of non-text children
            arranged.push(args[fragment])
        } else { // fragments
            // console.log(id, fragment, args)
        }
    }
    return arranged
}

export function t(id, ...args) {
    return getTranslation(id, args).join('')
}

</script>

<script>
    const {id, args} = $props()
</script>

{#each getTranslation(id, args) as fragment}
    {#if typeof fragment === 'string'}
        {fragment}
    {:else if fragment != null}
        {@render fragment()}
    {/if}
{/each}
