<script>
    const normalParam = 44;
    function someFunction(a, b, c) {
        return true;
    }
    const collection = { members: [1] };
    const someJSEven = 34;
    const obj = $derived({
        property: {
            ["non-extracted text"]: { ["Extracted text"]: 42 },
        },
    });
</script>

<p>
    This is a very {obj.property["non-extracted text"]["Extracted text"]}
    Complicated
    <i class="not-extracted" title="Extracted"
        >and even <b><u>depply</u> nested {`with ${someJSEven}` + "foo"}</b> content</i
    >
    With
    {#if someFunction("Extracted Text", normalParam, ["+extracted anyway"])}
        Conditionals,
        {#each collection.members as member}
            Loops and {member}
            {#await fetch("https://jsonplaceholder.typicode.com/todos/1") then res}
                {#await res.json() then json}
                    <b>{json.title} other blocks</b>
                {/await}
            {/await}
            Supported
        {/each}
    {/if}
</p>
- But ignore me
