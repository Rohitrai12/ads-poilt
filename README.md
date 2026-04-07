This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Stripe Billing Setup

This project now includes Stripe subscription billing with a free trial.

### Plans configured

- `free` (default): 7-day trial window, then free tier limits
- `pro`: $9/month
- `agency`: $20/month

### Enforced limits

- **Free**
  - 1 ad account
  - 1 platform
  - 50 AI messages/month
  - 1 AI report/month
  - no cross-platform dashboard
  - no campaign edits via AI
- **Pro**
  - 5 ad accounts
  - 3 platforms
  - unlimited AI messages/reports
  - campaign edits enabled
- **Agency**
  - unlimited ad accounts
  - 3 platforms
  - unlimited AI messages/reports
  - white-label/multi-client support flags enabled

### Required environment variables

Add these to `.env.local`:

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_AGENCY=price_...
STRIPE_TRIAL_DAYS=14
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### New billing endpoints

- `POST /api/billing/checkout` - create Stripe Checkout session for subscription + trial
- `POST /api/billing/portal` - open Stripe Billing Portal
- `GET /api/billing/status` - current user's billing status
- `POST /api/billing/webhook` - Stripe webhook endpoint for subscription sync

### UI

- Billing page: `/dashboard/billing`
- Sidebar includes a Billing link.

