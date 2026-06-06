# Vishnu Priya Thanda Portfolio

Astro SSR portfolio and technical blog for Vishnu Priya Thanda.

The site presents a broad technical profile across DevOps, cloud infrastructure, CI/CD, automation, reliability, security, data, and practical AI-enabled systems. It includes a homepage portfolio, an About page, technical blog posts, RSS/sitemap support, and a Gemini-powered assistant endpoint.

## Stack

- Astro 6 with server output
- Vercel adapter
- Markdown and MDX content collections
- Gemini API via `@google/genai`
- RSS and sitemap integrations

## Commands

| Command | Action |
| :-- | :-- |
| `npm install` | Install dependencies |
| `npm run dev` | Start local dev server at `localhost:4321` |
| `npm run build` | Build production output |
| `npm run preview` | Preview the production build locally |
| `npm run astro -- --help` | Show Astro CLI help |

## Content

Published blog posts live in `src/content/blog`.

Draft or sample posts can stay in the content folder by setting:

```yaml
draft: true
```

Draft posts are excluded from the blog index, RSS feed, and prerendered blog routes.

## Gemini Assistant

The homepage includes an "Ask Vishnu" assistant. The API route is:

```text
/api/gemini
```

Set one of these environment variables in Vercel or locally:

- `GENAI_API_KEY`
- `VERCEL_GEMINI_API_KEY`
- `GEMINI_API_KEY`

Example request:

```bash
curl -X POST https://vishnuk8s.vercel.app/api/gemini \
  -H "Content-Type: application/json" \
  -d '{"question":"What roles fit Vishnu Priya Thanda?"}'
```

If no key is configured, the endpoint returns a friendly fallback response.
