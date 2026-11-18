import { defineConfig } from 'astro/config';

// SITE and BASE_PATH are set by the GitHub Action from the Pages settings,
// so the site works both at <user>.github.io/<repo>/ and, once the custom
// domain is attached, at howtospeakdata.com/ with no code change.
export default defineConfig({
  site: process.env.SITE || 'https://howtospeakdata.com',
  base: process.env.BASE_PATH || '/',
  trailingSlash: 'ignore',
});
