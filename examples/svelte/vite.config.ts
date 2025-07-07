import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { wuchale } from 'wuchale'

// https://vite.dev/config/
export default defineConfig({
  plugins: [wuchale(), svelte()],
})
