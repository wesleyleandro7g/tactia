import { defineConfig } from 'astro/config';

const site = process.env.PUBLIC_SITE_URL;
if (site && !/^https?:\/\//.test(site))
  throw new Error('PUBLIC_SITE_URL must be an absolute HTTP(S) URL.');

export default defineConfig({
  site,
  output: 'static',
  redirects: {
    '/funcionarios-digitais': '/workforce',
  },
  server: { port: 4321 },
  vite: {
    server: {
      proxy: {
        '/api/v1/consultation-leads': {
          target: process.env.LANDING_API_ORIGIN || 'http://localhost:3000',
          changeOrigin: true,
          xfwd: true,
        },
      },
    },
  },
});
