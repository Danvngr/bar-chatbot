# Secure AI Restaurant Chatbot (RAG SaaS)

Production-grade multi-tenant WhatsApp chatbot for restaurants with strict domain guardrails, human handoff, and learning loop.

## Stack

- Backend: Node.js + Express
- Auth/Data: Firebase Auth + Firestore
- Retrieval: Firestore Native Vector Search
- LLM: OpenAI `gpt-4o-mini` + `text-embedding-3-small`
- Frontend: React + Vite + Tailwind
- Process manager: PM2

## Project Structure

- `backend`: API server, webhook, RAG pipeline, onboarding provisioning
- `frontend`: admin dashboard
- `firestore.rules`: tenant isolation rules

## Backend Setup

1. Copy `backend/.env.example` to `backend/.env` and fill all values.
2. Install dependencies:
   - `cd backend`
   - `npm install`
3. Run in development:
   - `npm run dev`
4. Run in production:
   - `npm run start`

## Frontend Setup

1. Copy `frontend/.env.example` to `frontend/.env`.
2. Install dependencies:
   - `cd frontend`
   - `npm install`
3. Start dev server:
   - `npm run dev`
4. Build:
   - `npm run build`

## Key Security Controls

- WhatsApp webhook signature verification (`X-Hub-Signature-256`)
- Rate limiting on webhook and admin APIs
- Firebase Auth protected admin endpoints
- Firestore tenant isolation with `restaurant_id` claim
- Secrets only via environment variables

## Core Flow

1. Webhook receives message, validates signature, returns `200 OK` immediately.
2. Async worker loads session and checks status:
   - `HUMAN_ACTIVE`: store message and stop.
   - `BOT_ACTIVE`: continue with RAG.
3. RAG pulls top knowledge chunks for the restaurant.
4. Prompt enforces strict in-domain response policy.
5. If model returns `TRANSFER_TO_HUMAN`:
   - switch session to `HUMAN_ACTIVE`
   - store unanswered question
   - notify admin
6. Otherwise send WhatsApp response and store message.

## PM2 (VPS)

From `backend`:

- `pm2 start ecosystem.config.js --env production`
- `pm2 save`
- `pm2 startup`

## Notes

- Firestore Vector Search requires vector index support enabled in your project.
- For each admin user, set Firebase custom claim `restaurant_id` to enforce tenancy.
