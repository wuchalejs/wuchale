<script module>
    const normalParam = 44;

    function someFunction(a, b, c) {
        const value = 'Extract'
        const next = `Interpolate ${a} ${b}`
        return next + c + value
    }
</script>

<script>

    async function someFunctionAsync(name) {
        const json = {}
        json.name = name ?? 'Extracted name'
        return json
    }

    export const arrow = (msg) => {
        alert(`This page says: ${msg}`)
    }

    const collection = { members: [1] };

    const someJSEven = 34;

    const obj = $derived({
        property: {
            ["non-extracted text"]: { ["Extracted text"]: 42 },
        },
    });

    const p = {
        id: 23,
        name: 'foo',
    }

    const derive = $derived.by(() => {
        const f = obj.property["Extract this"]
        if (!f) return
        let e = {}
        if (f == 'something else') {
            let d = 'Variable'
            d = d + 'Add to Variable'
            return d
        } else if (f == 'Check extracted') {
            return f
        } else {
            for (const q of [1,2,3]) {
                e[`${q}/${collection.members[0]}`] = {...p, name: 'That'}
            }
            e.default = [f, 'And this', e]
        }
        console.log("Don't translate this.")
        $inspect('Not this either')
        return {
            ['And this']: f,
            butNotThis: 'Okay?',
            e
        }
    })
</script>

<svelte:head>
    <title>Extract</title>
</svelte:head>

<div>{someFunction('foo', 'Bar')}</div>

<p>
    This is a very {obj.property["non-extracted text"]["Extracted text"]}
    Complicated
    <i class="not-extracted" title="Extracted" data-mixed="Also {'handled'}"
        >and even <b><u>depply</u> nested {`with ${someJSEven}` + "foo"}</b> content</i
    >
    With
    <!-- foo bar -->
    {#if someFunction("Extracted Text", normalParam, [/* @wc-include */ "extracted anyway"])}
        Conditionals,
        {#each collection.members as member}
            Loops and {member}
            <!-- What not -->
            {#await someFunctionAsync(derive) then json}
                <b>{json.title} other blocks</b>
            {/await}
            Supported
        {/each}
    {/if}
</p>

<!-- @wc-ignore -->
But ignore me
