# Secure AI Restaurant Chatbot

A production-ready WhatsApp chatbot platform for restaurants and hospitality businesses.

The system helps businesses answer customer questions automatically, manage their own knowledge base, transfer conversations to a human representative when needed, and keep each business fully separated in a multi-tenant environment.

## What It Does

- Answers customer questions on WhatsApp using the restaurant's own saved information
- Supports multiple businesses from the same backend
- Uses RAG to keep answers grounded in the business knowledge base
- Transfers customers to a human representative when the bot should not answer alone
- Sends human handoff alerts through Telegram
- Includes an admin bot for onboarding and knowledge management
- Logs unanswered questions so the business can improve the bot over time
- Protects each restaurant's data with Firebase Auth and Firestore security rules

## Tech Stack

- Backend: Node.js, Express
- Database: Firebase Firestore
- Authentication: Firebase Auth
- AI: OpenAI chat models and embeddings
- Retrieval: Firestore vector search
- Frontend: React, Vite
- Messaging: WhatsApp Cloud API, Telegram Bot API
- Production process manager: PM2

## Project Structure

```text
restaurant-chatbot/
├── backend/          # API server, webhooks, AI logic, RAG, onboarding, Telegram handoff
├── frontend/         # Admin dashboard
├── firestore.rules   # Firestore security rules
└── README.md
```

## Backend Setup

1. Go to the backend folder:

```bash
cd backend
```

2. Install dependencies:

```bash
npm install
```

3. Create your environment file:

```bash
cp .env.example .env
```

4. Fill in the required values in `.env`, including Firebase, OpenAI, WhatsApp, and Telegram credentials.

5. Start the backend in development:

```bash
npm run dev
```

For production:

```bash
npm start
```

## Frontend Setup

1. Go to the frontend folder:

```bash
cd frontend
```

2. Install dependencies:

```bash
npm install
```

3. Create your environment file:

```bash
cp .env.example .env
```

4. Start the development server:

```bash
npm run dev
```

5. Build for production:

```bash
npm run build
```

## Core Customer Flow

1. A customer sends a WhatsApp message.
2. The webhook verifies the request and loads the correct restaurant.
3. The system checks the customer session state.
4. If the bot is active, it searches the restaurant's knowledge base.
5. The AI generates a response using relevant business information.
6. If the bot should not answer alone, the conversation is transferred to a human representative.
7. The representative receives the alert in Telegram.
8. Unanswered or unclear questions can be reviewed and added back into the knowledge base.

## Human Handoff

The bot does not try to answer every question at all costs.

When a question is sensitive, unclear, missing important information, or requires human judgment, the system can move the conversation to a human representative. Telegram is used for internal alerts, which keeps operational communication separate from the customer-facing WhatsApp conversation.

## Admin Bot

The admin bot helps the business owner:

- Complete onboarding
- Add new business information
- Edit existing knowledge
- View saved questions and answers
- Connect a Telegram group for human handoff alerts
- Improve the bot over time

## Security

The system includes several security controls:

- WhatsApp webhook signature verification
- Firebase Auth for protected admin access
- Firestore tenant isolation
- Environment-based secrets
- Rate limiting
- Strict response guardrails to prevent off-topic or invented answers

## Production Deployment

The backend can be run on a VPS using PM2.

From the `backend` folder:

```bash
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

## Notes

- Firestore vector search must be enabled in the Firebase project.
- Each admin user should have the correct `restaurant_id` custom claim.
- Secrets should never be committed to Git.
- Use `.env.example` as a template only.
