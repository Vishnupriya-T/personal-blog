// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	site: 'https://vishnuk8s.vercel.app',
	output: 'server',
	adapter: vercel(),
	integrations: [mdx(), sitemap()],
});
