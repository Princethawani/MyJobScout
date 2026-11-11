# MyJobScout

A personal job-search assistant for Malawi. MyJobScout collects job listings, matches them against a user profile, extracts editable profile details from an uploaded CV, drafts fact-based cover letters, and tracks applications. Applications are never sent without review and explicit confirmation.

## Stack

- **Backend:** Node.js, TypeScript, Fastify, Drizzle ORM, PostgreSQL
- **Frontend:** React, TypeScript, Vite
- **Matching:** local keyword matching by default; optional semantic embeddings using Ollama or Gemini

## Run locally

### 1. Start PostgreSQL and the backend

```sh
cd backend
cp .env.example .env
npm install
docker compose up -d postgres
npm run db:migrate
npm run dev
```

### 2. Start the frontend

In another terminal:

```sh
cd frontend
npm install
npm run dev
```

Open the Vite URL printed in the frontend terminal. The frontend proxies API requests to the backend at `http://localhost:3000`. Configure `AUTH_TOKEN` in `backend/.env` if you want to protect API routes; enter the same token in the frontend when prompted.

See [`backend/README.md`](backend/README.md) and [`frontend/README.md`](frontend/README.md) for API details, CV upload, matching configuration, and workflows.

## Privacy and safety

- Keep `.env` files, API keys, CVs, documents, and database backups private; they are excluded from Git.
- CV extraction is heuristic. Review extracted details before saving them to your profile.
- Cover letters use profile facts and should be reviewed before use.
- Email sending is optional and requires SMTP configuration plus an explicit review-and-confirm step.
- Semantic matching is opt-in. Hosted Gemini embeddings send structured profile facts to Google's API; review its terms before enabling it. Keyword matching is the default.
