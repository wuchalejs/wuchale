<script lang="ts">
  import { setTranslations } from 'wuchale/runtime.svelte.js'
  import Counter from './lib/Counter.svelte'

  let locale = $state('en')
    
  async function loadTranslations(locale: string) {
    setTranslations(await import(`./locales/${locale}.svelte.js`))
  }
</script>

{#await loadTranslations(locale)}
  <!-- @wc-ignore -->
  Loading translations...
{:then}
  <main>
    <button onclick={() => {locale = locale === 'en' ? 'es' : locale === 'es' ? 'fr' : 'en'}}>Current locale: {locale}</button>
    <h1>Vite + Svelte</h1>
  
    <div class="card">
      <Counter />
    </div>
  
    <p>
      Check out <a href="https://github.com/sveltejs/kit#readme" target="_blank" rel="noreferrer">SvelteKit</a>, the official Svelte app framework powered by Vite!
    </p>
  
    <p class="read-the-docs">
      Click on the Vite and Svelte logos to learn more
    </p>
  </main>
  
  <style>
    .logo {
      height: 6em;
      padding: 1.5em;
      will-change: filter;
      transition: filter 300ms;
    }
    .logo:hover {
      filter: drop-shadow(0 0 2em #646cffaa);
    }
    .logo.svelte:hover {
      filter: drop-shadow(0 0 2em #ff3e00aa);
    }
    .read-the-docs {
      color: #888;
    }
  </style>
{/await}
