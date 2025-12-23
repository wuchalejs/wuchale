// $$ cd .. && npm run test

import { test } from 'node:test'
import { testContent, astro } from './check.ts'
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
import { getRuntime as _w_load_ } from '@/locales/astro.loader.js';
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
import { getRuntime as _w_load_ } from '@/locales/astro.loader.js';

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
import { getRuntime as _w_load_ } from '@/locales/astro.loader.js';
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
import { getRuntime as _w_load_ } from '@/locales/astro.loader.js';
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
import { getRuntime as _w_load_ } from '@/locales/astro.loader.js';
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
import { getRuntime as _w_load_ } from '@/locales/astro.loader.js';
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
import { getRuntime as _w_load_ } from '@/locales/astro.loader.js';
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
import { getRuntime as _w_load_ } from '@/locales/astro.loader.js';
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
import { getRuntime as _w_load_ } from '@/locales/astro.loader.js';
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
import { getRuntime as _w_load_ } from '@/locales/astro.loader.js';
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
