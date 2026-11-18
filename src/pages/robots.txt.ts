import type { APIRoute } from 'astro';

// Generated so it always points at the right domain (github.io now, howtospeakdata.com later).
export const GET: APIRoute = ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const notFound = new URL(`${base}/404`, site).pathname;
  return new Response(`User-agent: *\nAllow: /\nDisallow: ${notFound}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
