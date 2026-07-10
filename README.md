# Official Assembly Website V2

Next.js website for the Office of Assemblywoman Carmen Morales, organized around constituent services, civic updates, voting information, community news, newsletter signup, resident feedback, and office contact workflows.

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Project Structure

- `app/data/site.ts` controls the page copy, navigation, cards, and image assignments.
- `app/ui/` contains reusable layout, card, image, and form components.
- `public/images/` contains the local image assets used across the public pages.
- `tests/site-data.test.ts` guards route structure and public copy requirements.
