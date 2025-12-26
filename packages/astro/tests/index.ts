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
    `<p><W_tx_ t={[_w_tag_0]} x={_w_runtime_.cx(0)} /></p>`,
    `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Click <0>here</0> to continue"
    msgstr "Click <0>here</0> to continue"
    `,
    [['Click ', [0, 'here'], ' to continue']],
    [`<b>{_w_runtime_.tx(ctx)}</b>`]
    )
})

test('Nested element - multiple nested elements', async t => {
    await testContentWithWrappers(t, astro`
---
---

<p>Click <b>here</b> or <i>there</i> to proceed</p>
    `,
    `<p><W_tx_ t={[_w_tag_0, _w_tag_1]} x={_w_runtime_.cx(0)} /></p>`,
    `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Click <0>here</0> or <1>there</1> to proceed"
    msgstr "Click <0>here</0> or <1>there</1> to proceed"
    `,
    [['Click ', [0, 'here'], ' or ', [1, 'there'], ' to proceed']],
    [`<b>{_w_runtime_.tx(ctx)}</b>`, `<i>{_w_runtime_.tx(ctx)}</i>`]
    )
})

test('Nested element - link with href', async t => {
    await testContentWithWrappers(t, astro`
---
---

<p>Read our <a href="/terms">terms of service</a> for details</p>
    `,
    `<p><W_tx_ t={[_w_tag_0]} x={_w_runtime_.cx(0)} /></p>`,
    `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Read our <0>terms of service</0> for details"
    msgstr "Read our <0>terms of service</0> for details"
    `,
    [['Read our ', [0, 'terms of service'], ' for details']],
    [`<a href="/terms">{_w_runtime_.tx(ctx)}</a>`]
    )
})

test('Nested element - Astro component', async t => {
    await testContentWithWrappers(t, astro`
---
import Button from "@/components/Button.astro";
---

<p>Click <Button>here</Button> to submit</p>
    `,
    `<p><W_tx_ t={[_w_tag_0]} x={_w_runtime_.cx(0)} /></p>`,
    `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Click <0>here</0> to submit"
    msgstr "Click <0>here</0> to submit"
    `,
    [['Click ', [0, 'here'], ' to submit']],
    [`<Button>{_w_runtime_.tx(ctx)}</Button>`]
    )
})

test('Nested element - non-translatable content preserved', async t => {
    await testContentWithWrappers(t, astro`
---
---

<p>Open the <code><pre>src/pages</pre></code> directory</p>
    `,
    `<p><W_tx_ t={[_w_tag_0]} x={_w_runtime_.cx(0)} /></p>`,
    `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Open the <0/> directory"
    msgstr "Open the <0/> directory"
    `,
    [['Open the ', [0], ' directory']],
    [`<code><pre>src/pages</pre></code>`]
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
    `<h1>{_w_runtime_.t(0)} <slot /> {_w_runtime_.t(1)}</h1>`,
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
    ['This is a', 'component']
    // No wrapper files expected - slot is left in place
    )
})

test('Nested element - self-closing tag in wrapper', async t => {
    await testContentWithWrappers(t, astro`
---
import Icon from "@/components/Icon.astro";
---

<p>Click <Icon name="star" /> to favorite</p>
    `,
    `<p><W_tx_ t={[_w_tag_0]} x={_w_runtime_.cx(0)} /></p>`,
    `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Click <0/> to favorite"
    msgstr "Click <0/> to favorite"
    `,
    [['Click ', [0], ' to favorite']],
    [`<Icon name="star" />`]
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
    `<p><W_tx_ t={[_w_tag_0]} x={_w_runtime_.cx(0)} a={[locale]} /></p>`,
    `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "You're viewing the <0/> page."
    msgstr "You're viewing the <0/> page."
    `,
    [["You're viewing the ", [0], ' page.']],
    [`<Nested>{a[0] == "en" ? "ENGLISH" : "SPANISH"}</Nested>`]
    )
})

test('Nested element - expression with $-prefixed variable', async t => {
    await testContentWithWrappers(t, astro`
---
const $count = 5;
---

<p>You have <b>{$count > 0 ? "items" : "nothing"}</b> in cart.</p>
    `,
    `<p><W_tx_ t={[_w_tag_0]} x={_w_runtime_.cx(0)} a={[$count]} /></p>`,
    `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "You have <0/> in cart."
    msgstr "You have <0/> in cart."
    `,
    [["You have ", [0], ' in cart.']],
    [`<b>{a[0] > 0 ? "items" : "nothing"}</b>`]
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
    `<p><W_tx_ t={[_w_tag_0]} x={_w_runtime_.cx(0)} a={[locale]} /></p>`,
    `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "You're viewing the <0/> page."
    msgstr "You're viewing the <0/> page."
    `,
    [["You're viewing the ", [0], ' page.']],
    [`<Nested>{(<a href="test">{a[0]}</a>)}</Nested>`]
    )
})

// ============================================
// Edge Case Tests - Escape Sequences & Quotes
// ============================================

test('Expression with escaped quotes', async t => {
    await testContent(t, astro`
---
---

<p>{"He said \"hello\" to me"}</p>
    `, astro`
---
import {getRuntime as _w_load_, getRuntimeRx as _w_load_} from "../test-tmp/astro.loader.js"
const _w_runtime_ = _w_load_('astro');
---
<p>{_w_runtime_.t(0)}</p>
    `, `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "He said \\"hello\\" to me"
    msgstr "He said \\"hello\\" to me"
    `, ['He said "hello" to me'])
})

test('Expression with template literal containing ${}', async t => {
    await testContentWithWrappers(t, astro`
---
const name = "World";
---

<p>Hello <b>{\`dear \${name}\`}</b>!</p>
    `,
    `<p><W_tx_ t={[_w_tag_0]} x={_w_runtime_.cx(1)} a={[name]} /></p>`,
    `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "World"
    msgstr "World"

    #: tests/test-dir/test.astro
    msgid "Hello <0/>!"
    msgstr "Hello <0/>!"
    `,
    ['World', ['Hello ', [0], '!']],
    [`<b>{\`dear \${a[0]}\`}</b>`]
    )
})

test('Attribute with single quote inside double quotes', async t => {
    await testContent(t, astro`
---
---

<button title="Don't click me">Submit</button>
    `, astro`
---
import {getRuntime as _w_load_, getRuntimeRx as _w_load_} from "../test-tmp/astro.loader.js"
const _w_runtime_ = _w_load_('astro');
---
<button title={_w_runtime_.t(0)}>{_w_runtime_.t(1)}</button>
    `, `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Don't click me"
    msgstr "Don't click me"

    #: tests/test-dir/test.astro
    msgid "Submit"
    msgstr "Submit"
    `, ["Don't click me", 'Submit'])
})

test('Attribute with double quote inside single quotes', async t => {
    await testContent(t, astro`
---
---

<button title='Say "hello"'>Submit</button>
    `, astro`
---
import {getRuntime as _w_load_, getRuntimeRx as _w_load_} from "../test-tmp/astro.loader.js"
const _w_runtime_ = _w_load_('astro');
---
<button title={_w_runtime_.t(0)}>{_w_runtime_.t(1)}</button>
    `, `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Say \\"hello\\""
    msgstr "Say \\"hello\\""

    #: tests/test-dir/test.astro
    msgid "Submit"
    msgstr "Submit"
    `, ['Say "hello"', 'Submit'])
})

test('Multiline attribute value', async t => {
    await testContent(t, astro`
---
---

<div title="Line one
Line two
Line three">Content</div>
    `, astro`
---
import {getRuntime as _w_load_, getRuntimeRx as _w_load_} from "../test-tmp/astro.loader.js"
const _w_runtime_ = _w_load_('astro');
---
<div title={_w_runtime_.t(0)}>{_w_runtime_.t(1)}</div>
    `, `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid ""
    "Line one\\n"
    "Line two\\n"
    "Line three"
    msgstr ""
    "Line one\\n"
    "Line two\\n"
    "Line three"

    #: tests/test-dir/test.astro
    msgid "Content"
    msgstr "Content"
    `, ['Line one\nLine two\nLine three', 'Content'])
})

test('Expression with consecutive backslashes', async t => {
    await testContent(t, astro`
---
---

<p>{"Path: C:\\\\Users\\\\test"}</p>
    `, astro`
---
import {getRuntime as _w_load_, getRuntimeRx as _w_load_} from "../test-tmp/astro.loader.js"
const _w_runtime_ = _w_load_('astro');
---
<p>{_w_runtime_.t(0)}</p>
    `, `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Path: C:\\\\Users\\\\test"
    msgstr "Path: C:\\\\Users\\\\test"
    `, ['Path: C:\\Users\\test'])
})

test('Nested template literal with multiple expressions', async t => {
    await testContentWithWrappers(t, astro`
---
const firstName = "John";
const lastName = "Doe";
---

<p>Welcome <b>{\`\${firstName} \${lastName}\`}</b> to the site!</p>
    `,
    `<p><W_tx_ t={[_w_tag_0]} x={_w_runtime_.cx(2)} a={[firstName, lastName]} /></p>`,
    `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "John"
    msgstr "John"

    #: tests/test-dir/test.astro
    msgid "Doe"
    msgstr "Doe"

    #: tests/test-dir/test.astro
    msgid "Welcome <0/> to the site!"
    msgstr "Welcome <0/> to the site!"
    `,
    ['John', 'Doe', ['Welcome ', [0], ' to the site!']],
    [`<b>{\`\${a[0]} \${a[1]}\`}</b>`]
    )
})

test('Multiple variable replacements in single expression', async t => {
    // This test verifies that when multiple variables appear in a single expression,
    // they are replaced correctly. The replacement algorithm must process variables
    // in descending position order to avoid invalidating positions.
    await testContentWithWrappers(t, astro`
---
const firstName = "John";
const lastName = "Doe";
---

<p>Hello <b>{firstName + " " + lastName}</b>!</p>
    `,
    `<p><W_tx_ t={[_w_tag_0]} x={_w_runtime_.cx(2)} a={[firstName, lastName]} /></p>`,
    `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "John"
    msgstr "John"

    #: tests/test-dir/test.astro
    msgid "Doe"
    msgstr "Doe"

    #: tests/test-dir/test.astro
    msgid "Hello <0/>!"
    msgstr "Hello <0/>!"
    `,
    ['John', 'Doe', ['Hello ', [0], '!']],
    [`<b>{a[0] + " " + a[1]}</b>`]
    )
})

test('Template literal with nested braces (object literal inside ${})', async t => {
    // This test verifies that object literals inside template expressions
    // are handled correctly. The brace matcher must track the depth at which
    // each template expression was opened to avoid prematurely exiting.
    await testContentWithWrappers(t, astro`
---
const obj = { x: 1 };
---

<p>Value is <b>{\`result: \${ {x: 1}.x }\`}</b>!</p>
    `,
    `<p><W_tx_ t={[_w_tag_0]} x={_w_runtime_.cx(0)} /></p>`,
    `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Value is <0/>!"
    msgstr "Value is <0/>!"
    `,
    [['Value is ', [0], '!']],
    [`<b>{\`result: \${ {x: 1}.x }\`}</b>`]
    )
})
