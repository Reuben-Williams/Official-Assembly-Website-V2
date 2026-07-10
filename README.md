# Official Assembly Website V2

Next.js demo site for the Office of Assemblywoman Carmen Morales. The project is configured for a static GitHub Pages preview today and can move to Vercel with Supabase later.

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## GitHub Pages Demo

The workflow in `.github/workflows/github-pages.yml` builds a static export with:

```bash
GITHUB_PAGES=true npm run build
```

The deployed demo URL will be:

```text
https://reuben-williams.github.io/Official-Assembly-Website-V2/
```

In GitHub, enable **Settings > Pages > Source: GitHub Actions** for the repository.

## Vercel and Supabase Preparation

Copy `.env.example` to `.env.local` when a Supabase project exists:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

The browser client helper is in `lib/supabase/client.ts`. Current forms run as static demo forms; after Supabase confirmation, wire submissions to tables such as `contact_messages`, `newsletter_subscribers`, and `survey_responses`.

When moving to Vercel, unset `GITHUB_PAGES` and remove `output: "export"` if server routes, image optimization, or server actions are needed.
