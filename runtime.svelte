<script module>

let translations = $state({})

/**
 * @param {object} transArray
 */
export function setTranslations(transArray) {
    translations = transArray
}

/**
 * @param {number} id
 */
function getCtx(id) {
    const ctx = translations[id]
    if (typeof ctx === 'string') {
        return [ctx]
    }
    if (ctx == null || typeof ctx === 'number') {
        return [`[i18n-404:${id}(${ctx})]`]
    }
    return ctx
}

/**
 * @param {number} id
 * @param {string[]} args
 */
export function wuchaleTrans(id, ...args) {
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
    return txt
}

</script>

<script>
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
        {@render tags[fragment[0]](fragment)}
    {/if}
{/each}
