# Job Search backend

Fastify + TypeScript + PostgreSQL backend for collecting and reviewing Malawi job listings. Sending is deliberately review-first: preview the exact recipient, letter and attachments, then confirm the current letter version.

## Local setup

```sh
cp .env.example .env
# Keep DATABASE_URL on the host port configured in docker-compose.yml (default 5434).
npm ci
docker compose up -d postgres
npm run db:migrate
npm run dev
```

The API is available on `http://localhost:3000`; `GET /health` is public. Set `AUTH_TOKEN` to a random secret of at least 32 characters in `.env` to protect all other routes with `Authorization: Bearer <token>`. Production refuses to start without it.

## Workflow endpoints

- `GET /jobs?limit=25&offset=0&minScore=70` — browse and filter collected listings.
- `POST /jobs/:id/score` — score locally using skills, preferred locations, and seniority where present; no AI service or API key is used. Saving a profile rescales existing jobs; each collection run scores newly collected jobs.
- `GET/PUT /profile` — read or replace structured profile JSON. Use fields such as `name`, `email`, `phone`, `location`, `skills`, `roles`, and `education`. Supply only verified facts.
- `POST /profile/import-cv` — upload a PDF or DOCX (10 MB max). The API extracts likely fields and registers the original CV document; it does **not** overwrite the profile. Review and save the returned information from the profile editor. Image-only/scanned PDFs are not supported.
- `GET/POST /documents` — manage document metadata; put files under `DOCUMENTS_DIR` and use paths contained within that directory.
- `POST /jobs/:id/draft`, `PATCH /applications/:id/letter`, `GET /applications/:id/versions`, `GET /applications/:id/letter.pdf` — create, edit, inspect versions, and export letters.
- `POST /applications/:id/send-preview` then `POST /applications/:id/send-confirm` — preview first; confirmation requires `{ "confirm": true, "letterVersion": N, "documentIds": [] }`. SMTP must be configured. A sent application cannot be sent again.
- `GET /applications` and `PATCH /applications/:id/status` — track application state.

## Optional semantic matching

Keyword matching remains the default. For local embeddings, install [Ollama](https://ollama.com/), start it, and run `ollama pull nomic-embed-text`; keep `EMBEDDING_PROVIDER=ollama`.

For a hosted option, create a Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey), then set `EMBEDDING_PROVIDER=gemini`, `GEMINI_API_KEY=...`, and `MATCHING_MODE=hybrid` in `.env`. The default model is `gemini-embedding-001`; `gemini-embedding-2` can also be selected. Google currently lists a free tier for its embedding endpoint, but quotas and availability can change. Check Google's current [pricing](https://ai.google.dev/gemini-api/docs/pricing) and [terms](https://ai.google.dev/gemini-api/terms) before enabling it. Google says free-tier content may be used to improve its products; structured profile facts (summary, skills, experience, education, preferences) are sent to generate embeddings. Do not enable the hosted provider unless you are comfortable with that data handling.

`hybrid` combines semantic similarity (70%) with the keyword/location/seniority score (30%); `MATCHING_MODE=semantic` uses semantic similarity alone. If the selected provider is unavailable or missing its key, scoring falls back to keyword matching. The first rescore can take longer while embeddings are generated and cached. Defaults remain `MATCHING_MODE=keyword` and `EMBEDDING_PROVIDER=ollama`.

The collector runs on startup and every four hours. It currently includes only the Job Search Malawi source. Source HTML can change; inspect logs and check the jobs endpoint after startup.

## Database changes

After changing `src/db/schema.ts`, run `npm run db:generate`, review the new SQL under `drizzle/`, then apply it with `npm run db:migrate`. Keep migration files in source control. Back up before applying migrations to important data.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

## Operational/security notes

- Keep `.env`, uploaded documents, and database backups private; never commit secrets or CV files.
- Use TLS via a reverse proxy for remote access. Restrict network access to the API and PostgreSQL.
- Back up PostgreSQL and `DOCUMENTS_DIR` together. Configure SMTP only if email sending is wanted.
- This initial backend does not yet include a web dashboard, OAuth/Gmail, Telegram notifications, robust document upload, or a managed production deployment. Add those only with the relevant credentials and destination confirmed.
