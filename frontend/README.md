# CareerScout frontend

React + TypeScript + Vite dashboard for the job-search backend.

## Development

Start the backend on `localhost:3000`, then run:

```sh
npm install
npm run dev
```

Open the Vite URL shown in the terminal (normally `http://localhost:5173`). Requests under `/api` are proxied to the backend. If the backend has `AUTH_TOKEN` set, enter that value at the sign-in screen. The token is retained in browser local storage until you sign out.

Build with `npm run build`. The generated static site is in `dist/`; deploy it behind the same-origin API proxy or configure a production reverse proxy to forward `/api/*` to Fastify.

The current UI supports job search/filtering, keyword match scoring, in-app job detail pages with structured role descriptions, CV upload with editable extracted details, application drafting/editing, PDF download, document selection, send preview/confirmation, and application tracking. CV extraction is heuristic, so verify all information before saving. General document uploads and source management are not yet exposed in the UI.
