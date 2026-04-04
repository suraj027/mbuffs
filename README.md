# mbuffs

mbuffs is a full-stack movie discovery and collection app for film buffs.

- Frontend: Vite + React 19 + TypeScript + React Query + shadcn/ui
- Backend: Express 5 + Better Auth + Drizzle ORM + Neon Postgres
- Integrations: TMDB content API, Reddit-assisted recommendation signals, IMDb parental-guidance scraping

## Features

- Browse trending movies and TV content
- Search movies, shows, and people
- Create collections, add collaborators, and manage permissions
- Track watched and not-interested items
- Personalized recommendations (`For You`, genre, and theatrical variants)
- Recommendation cache debug view for authorized users
- PWA support with service worker update prompts

## Project Structure

```txt
.
|-- src/                  # Frontend app
|   |-- pages/            # Route-level pages
|   |-- components/       # UI and shared components
|   |-- hooks/            # Reusable React hooks
|   `-- lib/              # API client and shared types
|-- backend/              # Express API
|   |-- api/              # Server entrypoint
|   |-- routes/           # Route definitions
|   |-- controllers/      # Request handlers
|   |-- services/         # Business logic (recommendations, scraping)
|   |-- middleware/       # Auth and permission middleware
|   `-- db/               # Schema and SQL migrations
`-- public/               # Static files and service worker
```

## Prerequisites

- Node.js 22.12+ (React Compiler setup uses `@rolldown/plugin-babel`)
- npm
- TMDB API key
- Google OAuth credentials
- Neon/Postgres database URL

## Setup

1. Install frontend dependencies:

```bash
npm install
```

2. Install backend dependencies:

```bash
cd backend
npm install
cd ..
```

3. Configure environment variables:

- Root `.env` (frontend):
  - `VITE_BACKEND_URL` (example: `http://localhost:5001`)
  - `VITE_TMDB_API_KEY`
- `backend/.env`:
  - `DATABASE_URL`
  - `FRONTEND_URL` (example: `http://localhost:8080`)
  - `BETTER_AUTH_URL` (example: `http://localhost:5001`)
  - `BETTER_AUTH_SECRET`
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
  - `TMDB_API_KEY`, `TMDB_BASE_URL`, `TMDB_IMAGE_BASE_URL`

## Run Locally

Terminal 1 (backend):

```bash
cd backend
npm run dev
```

Terminal 2 (frontend):

```bash
npm run dev
```

Default local URLs:

- Frontend: `http://localhost:8080`
- Backend: `http://localhost:5001`

## Commands

Frontend:

- `npm run dev`
- `npm run lint`
- `npm run build`
- `npm run preview`

Backend:

- `npm run dev`
- `npm run build`
- `npm run build:no-scrape`
- `npm run db:migrate`
- `npm run scrape:reddit`

## API Overview

- `GET/POST /api/auth/*` - Better Auth endpoints and session handling
- `GET/PUT /api/user/preferences` - recommendation preferences
- `GET/POST/PUT/DELETE /api/collections/*` - collections, collaborators, watched/not-interested state
- `POST /api/content` - TMDB proxy endpoint
- `GET /api/recommendations/*` - recommendation endpoints and cache debug endpoint
- `GET /api/ratings/*` - parental guidance endpoints
- `GET/POST /api/reddit/*` - Reddit recommendation data and scrape trigger

## Notes

- Recommendation generation is cached in Postgres for performance.
- Recommendation ranking uses a multi-stage pipeline: candidate retrieval -> multi-objective ranking (CTR/CVR/engagement proxies) -> diversity/freshness re-ranking -> contextual-bandit exploration.
- Cold-start recommendations can seed from watched history before falling back to trending + social (Reddit) signals.
- Backend build script (`npm run build`) runs migrations and a Reddit scrape step.
- Service worker updates are user-confirmed via an in-app toast.
