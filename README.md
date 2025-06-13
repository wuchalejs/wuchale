# (WIP)

# wuchale

This is my attempt to solve something that has been bothering me for some time, i18n.
I come to svelte from preact where there is LinguiJS, and I was OK with that workflow,
but it seems that a different workflow is more prevalent, which I didn't like. And I didn't like Lingui 100% either.

## Main points
- I don't want to manually maintain another source file
  - LinguiJS solves this, automatic message extraction
- I want to keep the direct messages inside my source files
  - `page.home.welcome` is not for me.
- I want to keep the simple, clean markup that we use when we don't need i18n.
  - Lingui fails me here, when I look at my preact components, it's overwhelming.
- I don't want to juggle a lot of dependencies
  - More downloads on `npm i`
  - More probability of vulnerabilities
  - Doesn't feel good
  - Lingui fails here as well, over 200 dependencies!
 
## Goals

It should be possible to write your svelte files as you would without the need for i18n.

The final version should be able to do the following:

- Try to find and extract all user facing text into a catalog for translation
- Compile the text fragments into a structure that is as small as possible with just the right info for runtime swapping
- Modify your code to a version that imports the runtime and uses the compiled catalog
  - The translations should be reactive.
  - The runtime is tiny, doesn't do much, not even `.replace`, just lookup and swap.
  - The bulk of the work is done at build time
- All of this should work with HMR
- Should work behind the scenes so it should be configure and forget (mostly).

## Supported syntax

Currently most of the syntax supported by Lingui is supported **except plurals**. And the default behaviour is:

- Text inside the markup is automatically extracted, with optional opt out (`-`).
- Text inside the script is ignored by default, with optional opt in (`+`)
- Text inside the mustache tags follows the script convention.
- Attributes, if specified literally, are ignored by default, with optional opt in (`+`)

- Simple text: `<p>Foo</p>`
- Text with value: `Foo {42}`
- Nested text (in progress)
  - `Foo <b>bar</b>`
  - `Foo {42} <b>{56}</b>`
- JS strings: should be prefixed with +:
  - `+Foo`
  - ``a = '+Foo'; b = `+${a} Bar` ``
- Attributes: `label="+Foo"`

