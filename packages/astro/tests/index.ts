// $$ cd .. && npm run test

import { test } from 'node:test'
import { testContent, testContentWithWrappers, astro } from './check.ts'
import { getDefaultLoaderPath } from '@wuchale/astro'
import { statfs } from 'fs/promises'

test('Default loader file paths', async () => {
    for (const loader of ['default', 'astro'] as const) {
        for (const bundle of [false, true]) {
            const path = getDefaultLoaderPath(loader, bundle)
            if (path && typeof path === 'string') {
                await statfs(path) // no error
            }
        }
    }
})

test('Astro basic text', async t => {
    await testContent(t, astro`
---
import Main from "@/layouts/main.astro";
---

<Main>
    <h1>Hello World</h1>
    <p>Welcome to our site</p>
</Main>
    `, astro`
---
import {getRuntime as _w_load_, getRuntimeRx as _w_load_} from "../test-tmp/astro.loader.js"
const _w_runtime_ = _w_load_('astro');
import Main from "@/layouts/main.astro";
---
<Main>
<h1>{_w_runtime_.t(0)}</h1>
<p>{_w_runtime_.t(1)}</p>
</Main>
    `, `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Hello World"
    msgstr "Hello World"

    #: tests/test-dir/test.astro
    msgid "Welcome to our site"
    msgstr "Welcome to our site"
    `, ['Hello World', 'Welcome to our site'])
})

test('Astro attributes', async t => {
    await testContent(t, astro`
---
---

<div title="Click here" aria-label="Navigation">
    <button>Submit</button>
</div>
    `, astro`
---
import {getRuntime as _w_load_, getRuntimeRx as _w_load_} from "../test-tmp/astro.loader.js"
const _w_runtime_ = _w_load_('astro');
---
<div title={_w_runtime_.t(0)} aria-label={_w_runtime_.t(1)}>
<button>{_w_runtime_.t(2)}</button>
</div>
    `, `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Click here"
    msgstr "Click here"

    #: tests/test-dir/test.astro
    msgid "Navigation"
    msgstr "Navigation"

    #: tests/test-dir/test.astro
    msgid "Submit"
    msgstr "Submit"
    `, ['Click here', 'Navigation', 'Submit'])
})

test('Astro directives ignored', async t => {
    await testContent(t, astro`
---
import Component from "./component.svelte";
---

<Component client:idle title="Hello">
    <span is:inline>Test</span>
</Component>
    `, astro`
---
import {getRuntime as _w_load_, getRuntimeRx as _w_load_} from "../test-tmp/astro.loader.js"
const _w_runtime_ = _w_load_('astro');
import Component from "./component.svelte";
---
<Component client:idle title={_w_runtime_.t(0)}>
<span is:inline>{_w_runtime_.t(1)}</span>
</Component>
    `, `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Hello"
    msgstr "Hello"

    #: tests/test-dir/test.astro
    msgid "Test"
    msgstr "Test"
    `, ['Hello', 'Test'])
})

test('Astro no frontmatter', async t => {
    await testContent(t, astro`
<html>
    <body>
        <h1>Hello World</h1>
    </body>
</html>
    `, astro`
---
import {getRuntime as _w_load_, getRuntimeRx as _w_load_} from "../test-tmp/astro.loader.js"
const _w_runtime_ = _w_load_('astro');
---
<html>
<body>
<h1>{_w_runtime_.t(0)}</h1>
</body>
</html>
    `, `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Hello World"
    msgstr "Hello World"
    `, ['Hello World'])
})

test('Expression string literals in attributes', async t => {
    await testContent(t, astro`
---
import Header from "@/components/header.svelte";
---

<Header
    title={"Welcome to Our Platform"}
    subtitle={"Quality Service · Fast Delivery"}
    client:idle
/>
    `, astro`
---
import {getRuntime as _w_load_, getRuntimeRx as _w_load_} from "../test-tmp/astro.loader.js"
const _w_runtime_ = _w_load_('astro');
import Header from "@/components/header.svelte";
---
<Header
title={_w_runtime_.t(0)}
subtitle={_w_runtime_.t(1)}
client:idle
/>
    `, `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Welcome to Our Platform"
    msgstr "Welcome to Our Platform"

    #: tests/test-dir/test.astro
    msgid "Quality Service · Fast Delivery"
    msgstr "Quality Service · Fast Delivery"
    `, ['Welcome to Our Platform', 'Quality Service · Fast Delivery'])
})

test('Expression string literals in content', async t => {
    await testContent(t, astro`
---
---

<div>
    <h1>{"Terms of Service"}</h1>
    <p>{"Last updated: January 1, 2024"}</p>
</div>
    `, astro`
---
import {getRuntime as _w_load_, getRuntimeRx as _w_load_} from "../test-tmp/astro.loader.js"
const _w_runtime_ = _w_load_('astro');
---
<div>
<h1>{_w_runtime_.t(0)}</h1>
<p>{_w_runtime_.t(1)}</p>
</div>
    `, `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Terms of Service"
    msgstr "Terms of Service"

    #: tests/test-dir/test.astro
    msgid "Last updated: January 1, 2024"
    msgstr "Last updated: January 1, 2024"
    `, ['Terms of Service', 'Last updated: January 1, 2024'])
})

test('List items with text', async t => {
    await testContent(t, astro`
---
---

<ul>
    <li>Email address</li>
    <li>First name and last name</li>
    <li>Cookies and Usage Data</li>
</ul>
    `, astro`
---
import {getRuntime as _w_load_, getRuntimeRx as _w_load_} from "../test-tmp/astro.loader.js"
const _w_runtime_ = _w_load_('astro');
---
<ul>
<li>{_w_runtime_.t(0)}</li>
<li>{_w_runtime_.t(1)}</li>
<li>{_w_runtime_.t(2)}</li>
</ul>
    `, `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Email address"
    msgstr "Email address"

    #: tests/test-dir/test.astro
    msgid "First name and last name"
    msgstr "First name and last name"

    #: tests/test-dir/test.astro
    msgid "Cookies and Usage Data"
    msgstr "Cookies and Usage Data"
    `, ['Email address', 'First name and last name', 'Cookies and Usage Data'])
})

test('Expression in compound text', async t => {
    await testContent(t, astro`
---
const locale = 'en';
---

<p>You're viewing the {locale} page.</p>
    `, astro`
---
import {getRuntime as _w_load_, getRuntimeRx as _w_load_} from "../test-tmp/astro.loader.js"
const _w_runtime_ = _w_load_('astro');
import W_tx_ from "@wuchale/astro/runtime.astro";
const locale = 'en';
---
<p><W_tx_ x={_w_runtime_.cx(0)} a={[locale]} /></p>
    `, `
    msgid ""
    msgstr ""
    #. placeholder {0}: locale
    #: tests/test-dir/test.astro
    msgid "You're viewing the {0} page."
    msgstr "You're viewing the {0} page."
    `, [["You're viewing the ", 0, " page."]])
})

test('Nested components with slots', async t => {
    await testContent(t, astro`
---
import Dashboard from "@/components/dashboard.svelte";
import Table from "@/components/table.svelte";
---

<Dashboard client:idle>
    <h2>Financial Overview</h2>
    <Table client:idle />
</Dashboard>
    `, astro`
---
import {getRuntime as _w_load_, getRuntimeRx as _w_load_} from "../test-tmp/astro.loader.js"
const _w_runtime_ = _w_load_('astro');
import Dashboard from "@/components/dashboard.svelte";
import Table from "@/components/table.svelte";
---
<Dashboard client:idle>
<h2>{_w_runtime_.t(0)}</h2>
<Table client:idle />
</Dashboard>
    `, `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Financial Overview"
    msgstr "Financial Overview"
    `, ['Financial Overview'])
})

test('JSON-LD script content preserved', async t => {
    await testContent(t, astro`
---
---

<script type="application/ld+json" is:inline>
{
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "My Website"
}
</script>
<h1>Welcome</h1>
    `, astro`
---
import {getRuntime as _w_load_, getRuntimeRx as _w_load_} from "../test-tmp/astro.loader.js"
const _w_runtime_ = _w_load_('astro');
---
<script type="application/ld+json" is:inline>
{
"@context": "https://schema.org",
"@type": "WebSite",
"name": "My Website"
}
</script>
<h1>{_w_runtime_.t(0)}</h1>
    `, `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Welcome"
    msgstr "Welcome"
    `, ['Welcome'])
})

test('Mixed translatable and non-translatable attributes', async t => {
    await testContent(t, astro`
---
import Card from "@/components/card.svelte";
---

<Card
    id="item-123"
    title="Featured Product"
    isActive={false}
    client:idle
/>
    `, astro`
---
import {getRuntime as _w_load_, getRuntimeRx as _w_load_} from "../test-tmp/astro.loader.js"
const _w_runtime_ = _w_load_('astro');
import Card from "@/components/card.svelte";
---
<Card
id="item-123"
title={_w_runtime_.t(0)}
isActive={false}
client:idle
/>
    `, `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Featured Product"
    msgstr "Featured Product"
    `, ['Featured Product'])
})

// ============================================
// Wrapper Component Generation Tests
// ============================================

test('Nested element - simple bold text', async t => {
    await testContentWithWrappers(t, astro`
---
---

<p>Click <b>here</b> to continue</p>
    `,
    // Expected pattern: imports wrapper and W_tx_ component (order flexible), uses W_tx_ with t prop
    /import W_tx_ from ['"]@wuchale\/astro\/runtime\.astro['"];[\s\S]*import _w_tag_0 from ['"].*\.wuchale\/w_0_[a-f0-9]+\.astro['"];[\s\S]*<p><W_tx_ t=\{\[_w_tag_0\]\} x=\{_w_runtime_\.cx\(0\)\} \/><\/p>/,
    `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Click <0>here</0> to continue"
    msgstr "Click <0>here</0> to continue"
    `,
    [['Click ', [0], ' to continue']],
    1, // One wrapper file expected
    [/<b>\{_w_runtime_\.tx\(ctx\)\}<\/b>/] // Wrapper should contain <b> with tx(ctx)
    )
})

test('Nested element - multiple nested elements', async t => {
    await testContentWithWrappers(t, astro`
---
---

<p>Click <b>here</b> or <i>there</i> to proceed</p>
    `,
    // Expected pattern: two wrapper imports (after W_tx_ import)
    /import W_tx_ from ['"]@wuchale\/astro\/runtime\.astro['"];[\s\S]*import _w_tag_0 from ['"].*\.wuchale\/w_0_[a-f0-9]+\.astro['"];[\s\S]*import _w_tag_1 from ['"].*\.wuchale\/w_1_[a-f0-9]+\.astro['"];[\s\S]*<W_tx_ t=\{\[_w_tag_0, _w_tag_1\]\}/,
    `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Click <0>here</0> or <1>there</1> to proceed"
    msgstr "Click <0>here</0> or <1>there</1> to proceed"
    `,
    [['Click ', [0], ' or ', [1], ' to proceed']],
    2 // Two wrapper files expected
    )
})

test('Nested element - link with href', async t => {
    await testContentWithWrappers(t, astro`
---
---

<p>Read our <a href="/terms">terms of service</a> for details</p>
    `,
    /import W_tx_ from ['"]@wuchale\/astro\/runtime\.astro['"];[\s\S]*import _w_tag_0 from ['"].*\.wuchale\/w_0_[a-f0-9]+\.astro['"];[\s\S]*<W_tx_ t=\{\[_w_tag_0\]\}/,
    `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Read our <0>terms of service</0> for details"
    msgstr "Read our <0>terms of service</0> for details"
    `,
    [['Read our ', [0], ' for details']],
    1,
    [/<a href="\/terms">\{_w_runtime_\.tx\(ctx\)\}<\/a>/] // Wrapper preserves href attribute
    )
})

test('Nested element - Astro component', async t => {
    await testContentWithWrappers(t, astro`
---
import Button from "@/components/Button.astro";
---

<p>Click <Button>here</Button> to submit</p>
    `,
    /import W_tx_ from ['"]@wuchale\/astro\/runtime\.astro['"];[\s\S]*import _w_tag_0 from ['"].*\.wuchale\/w_0_[a-f0-9]+\.astro['"];[\s\S]*<W_tx_ t=\{\[_w_tag_0\]\}/,
    `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Click <0>here</0> to submit"
    msgstr "Click <0>here</0> to submit"
    `,
    [['Click ', [0], ' to submit']],
    1,
    [/<Button>\{_w_runtime_\.tx\(ctx\)\}<\/Button>/] // Wrapper contains Astro component
    )
})

test('Nested element - non-translatable content preserved', async t => {
    await testContentWithWrappers(t, astro`
---
---

<p>Open the <code><pre>src/pages</pre></code> directory</p>
    `,
    // Wrapper should be created but with original content (not tx(ctx))
    /import W_tx_ from ['"]@wuchale\/astro\/runtime\.astro['"];[\s\S]*import _w_tag_0 from ['"].*\.wuchale\/w_0_[a-f0-9]+\.astro['"];[\s\S]*<W_tx_ t=\{\[_w_tag_0\]\}/,
    `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Open the <0/> directory"
    msgstr "Open the <0/> directory"
    `,
    [['Open the ', [0], ' directory']],
    1,
    [/<code><pre>src\/pages<\/pre><\/code>/] // Wrapper preserves original non-translatable text
    )
})

test('Nested element - slot left in place', async t => {
    // Slot elements should be left in place, not wrapped
    // The text around the slot should be translated separately
    await testContentWithWrappers(t, astro`
---
---

<h1>This is a <slot /> component</h1>
    `,
    // Pattern: slot should remain in the output, no W_tx_ wrapper for slot
    /<h1>\{_w_runtime_\.t\(0\)\} <slot \/> \{_w_runtime_\.t\(1\)\}<\/h1>/,
    `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "This is a"
    msgstr "This is a"

    #: tests/test-dir/test.astro
    msgid "component"
    msgstr "component"
    `,
    ['This is a', 'component'],
    0 // No wrapper files expected - slot is left in place
    )
})

test('Nested element - self-closing tag in wrapper', async t => {
    await testContentWithWrappers(t, astro`
---
import Icon from "@/components/Icon.astro";
---

<p>Click <Icon name="star" /> to favorite</p>
    `,
    /import W_tx_ from ['"]@wuchale\/astro\/runtime\.astro['"];[\s\S]*import _w_tag_0 from ['"].*\.wuchale\/w_0_[a-f0-9]+\.astro['"];/,
    `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Click <0/> to favorite"
    msgstr "Click <0/> to favorite"
    `,
    [['Click ', [0], ' to favorite']],
    1,
    [/<Icon name="star" \/>/] // Self-closing tag preserved as-is
    )
})

test('Nested element - complex expression with free variables', async t => {
    await testContentWithWrappers(t, astro`
---
import Nested from "@/components/Nested.astro";
const locale = "en";
---

<p>You're viewing the <Nested>{locale == "en" ? "ENGLISH" : "SPANISH"}</Nested> page.</p>
    `,
    // Should have wrapper import and W_tx_ with a prop containing the variable
    /import W_tx_ from ['"]@wuchale\/astro\/runtime\.astro['"];[\s\S]*import _w_tag_0 from ['"].*\.wuchale\/w_0_[a-f0-9]+\.astro['"];[\s\S]*<W_tx_ t=\{\[_w_tag_0\]\}.*a=\{\[locale/,
    `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "You're viewing the <0/> page."
    msgstr "You're viewing the <0/> page."
    `,
    [["You're viewing the ", [0], ' page.']],
    1,
    // Wrapper should have the expression with a[0] replacing locale
    [/<Nested>\{a\[0\] == "en" \? "ENGLISH" : "SPANISH"\}<\/Nested>/]
    )
})

test('Nested element - expression with $-prefixed variable', async t => {
    await testContentWithWrappers(t, astro`
---
const $count = 5;
---

<p>You have <b>{$count > 0 ? "items" : "nothing"}</b> in cart.</p>
    `,
    // Should have wrapper import and W_tx_ with a prop containing the $count variable
    /import W_tx_ from ['"]@wuchale\/astro\/runtime\.astro['"];[\s\S]*import _w_tag_0 from ['"].*\.wuchale\/w_0_[a-f0-9]+\.astro['"];[\s\S]*<W_tx_ t=\{\[_w_tag_0\]\}.*a=\{\[\$count\]\}/,
    `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "You have <0/> in cart."
    msgstr "You have <0/> in cart."
    `,
    [["You have ", [0], ' in cart.']],
    1,
    // Wrapper should have the expression with a[0] replacing $count
    [/<b>\{a\[0\] > 0 \? "items" : "nothing"\}<\/b>/]
    )
})

test('Nested element - JSX expression with variable inside', async t => {
    await testContentWithWrappers(t, astro`
---
import Nested from "@/components/Nested.astro";
const locale = "en";
---

<p>You're viewing the <Nested>{(<a href="test">{locale}</a>)}</Nested> page.</p>
    `,
    // Should have wrapper import and W_tx_ with a prop containing the locale variable
    /import W_tx_ from ['"]@wuchale\/astro\/runtime\.astro['"];[\s\S]*import _w_tag_0 from ['"].*\.wuchale\/w_0_[a-f0-9]+\.astro['"];[\s\S]*<W_tx_ t=\{\[_w_tag_0\]\}.*a=\{\[locale\]\}/,
    `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "You're viewing the <0/> page."
    msgstr "You're viewing the <0/> page."
    `,
    [["You're viewing the ", [0], ' page.']],
    1,
    // Wrapper should have the JSX expression with a[0] replacing locale inside the nested element
    [/<Nested>\{\(<a href="test">\{a\[0\]\}<\/a>\)\}<\/Nested>/]
    )
})
