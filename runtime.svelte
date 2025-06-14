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

function getCtx(id) {
    const ctx = txts[id] || id
    if (typeof ctx === 'string') {
        return [ctx]
    }
    return ctx
}

export function t(id, ...args) {
    const ctx = getCtx(id)
    let txt = ''
    for (const fragment of ctx) {
        if (typeof fragment === 'string') {
            txt += fragment
        } else if (typeof fragment === 'number') { // index of non-text children
            txt += args[fragment]
        } else {
            // shouldn't happen
            console.error('Unknown item in compiled catalog: ', id, fragment)
        }
    }
    txt
}

</script>

<script>
    let {id = null, ctx, tags, args} = $props()
    if (id != null) {
        ctx = getCtx(id)
    }
</script>

{#each ctx as fragment}
    {#if typeof fragment === 'string'}
        {fragment}
    {:else if typeof fragment === 'number'}
        {#if id == null}
            <!-- inside snippet -->
            {args[fragment]}
        {/if}
    {:else}
        {@render tags[fragment[0]](fragment)}
    {/if}
{/each}
