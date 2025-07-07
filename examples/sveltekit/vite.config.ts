import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { wuchale } from 'wuchale'

export default defineConfig({
	plugins: [wuchale(), sveltekit()]
});
