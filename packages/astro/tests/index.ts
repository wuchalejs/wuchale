// $$ cd .. && npm run test

import { test } from 'node:test'
import { testContent, astro } from './check.ts'
import { getDefaultLoaderPath } from '../src/index'
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
const title = "Page Title";
---

<Main>
    <h1>Hello World</h1>
    <p>Welcome to our site</p>
</Main>
    `, astro`
---
import { getRuntime as _w_load_ } from '@/locales/astro.loader.server.js';
import Main from "@/layouts/main.astro";
const _w_runtime_ = _w_load_('astro');
const title = "Page Title";
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
import { getRuntime as _w_load_ } from '@/locales/astro.loader.server.js';

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
import { getRuntime as _w_load_ } from '@/locales/astro.loader.server.js';
import Component from "./component.svelte";

const _w_runtime_ = _w_load_('astro');
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
import { getRuntime as _w_load_ } from '@/locales/astro.loader.server.js';
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
