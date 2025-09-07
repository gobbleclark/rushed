# Priority Handling Shopify App

A production-ready Shopify app that offers post-purchase "Skip the line / Priority Handling" upsells to customers, tags orders for priority processing, and bills merchants daily using Shopify app usage charges.

## Features

- **Post-purchase Upsell**: Customers can add priority handling after completing their purchase
- **Order Tagging**: Orders with priority handling are automatically tagged in Shopify
- **Metafields & Notes**: Priority orders get custom metafields and timeline notes
- **Usage Billing**: Daily billing for priority orders using Shopify app subscriptions
- **Admin Dashboard**: Merchants can view statistics and configure settings
- **Reliable Processing**: HMAC verified webhooks with idempotent processing

## Tech Stack

- **Framework**: Remix + TypeScript
- **Database**: Prisma + SQLite (dev) / PostgreSQL (prod)
- **Shopify APIs**: Admin GraphQL, Webhooks, Post-purchase Extensions
- **Scheduling**: node-cron for nightly billing
- **Testing**: Vitest for unit tests

## Quick Start

### 1. Environment Setup

Copy the environment template:
```bash
cp .env.example .env
```

Fill in your Shopify app credentials:
```env
SHOPIFY_API_KEY=your_api_key
SHOPIFY_API_SECRET=your_api_secret
SCOPES=read_products,read_orders,write_orders,write_own_subscription,read_own_subscription
SHOP=your-shop.myshopify.com
HOST=https://your-app-url.com
DATABASE_URL=file:./dev.db
NODE_ENV=development
TZ=America/New_York
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Database Setup

```bash
npm run db:push
```

### 4. Seed Data (Optional)

If you want to create the priority product automatically:
```bash
SHOPIFY_ACCESS_TOKEN=your_access_token npm run seed
```

### 5. Development

```bash
npm run dev
```

This starts:
- The Remix app server
- The post-purchase extension in development mode
- Automatic tunneling with ngrok

## Project Structure

```
app/
├── routes/                     # Remix routes
│   ├── app.settings.tsx       # Admin settings page
│   ├── webhooks.orders.paid.tsx # Orders webhook handler
│   └── api.priority-product.tsx # API for post-purchase extension
├── services/                   # Business logic
│   ├── shopify.ts             # Shopify GraphQL client & helpers
│   ├── billing.ts             # App subscription & usage billing
│   ├── priority.ts            # Core priority handling logic
│   ├── orders.ts              # Order processing
│   └── cron.ts                # Nightly billing job
├── lib/                       # Utilities
│   ├── hmac.ts               # Webhook verification
│   ├── logger.ts             # Structured logging
│   └── init.ts               # App initialization
extensions/
└── post-purchase/             # Post-purchase extension
    ├── shopify.extension.toml
    ├── package.json
    └── src/index.tsx
prisma/
└── schema.prisma             # Database schema
tests/                        # Unit tests
scripts/
└── seed.ts                   # Database seeding
```

## Core Functionality

### Post-purchase Flow

1. Customer completes checkout
2. Post-purchase extension offers priority handling
3. If accepted, adds priority fee product to order
4. Order is charged immediately

### Order Processing

1. `orders/paid` webhook received
2. Check if order contains priority product
3. Add `PRIORITY_SKIP_LINE` tag to order
4. Set `custom.priority_handling = true` metafield
5. Add timeline note with SLA information
6. Record in database for billing

### Daily Billing

1. Cron job runs at 23:55 ET daily
2. Count priority orders for each shop (previous day)
3. Create usage records in Shopify
4. Store billing records with idempotency

## Configuration

### Merchant Settings

Merchants can configure via `/app/settings`:
- Priority fee amount (default: $5.00)
- SLA hours (default: 2 hours)
- Monthly billing cap (default: $500.00)

### Extension Settings

The post-purchase extension can be configured:
- Enable/disable priority handling
- Custom fee amounts
- Custom SLA messaging

## API Endpoints

- `POST /webhooks/orders/paid` - Process paid orders
- `POST /api/priority-product` - Get/create priority product
- `GET /app/settings` - Admin settings page

## Database Models

- **Shop**: Store configuration and credentials
- **ProcessedEvent**: Idempotency for webhook processing
- **DailyUsage**: Track daily billing records
- **OrderMarker**: Track priority orders

## Testing

Run unit tests:
```bash
npm test
```

Run with UI:
```bash
npm run test:ui
```

## Deployment

### Environment Variables

Production requires:
- `DATABASE_URL`: PostgreSQL connection string
- `SHOPIFY_API_KEY` & `SHOPIFY_API_SECRET`
- `HOST`: Your app's public URL

### Database Migration

```bash
npm run setup
```

### Build & Start

```bash
npm run build
npm start
```

## Billing Model

- Merchants approve a monthly subscription with usage billing
- Default cap: $500/month
- Charge: Fee amount per priority order (configurable)
- Billing runs daily at 23:55 ET
- Idempotent processing prevents duplicate charges

## Error Handling

- All webhooks use HMAC verification
- Idempotent processing prevents duplicates
- Structured logging for debugging
- Graceful error handling with retries

## Monitoring

Check system status in admin panel:
- Recent priority orders
- Daily/weekly/monthly statistics
- Billing job status
- Revenue tracking

## Support

For issues or questions:
1. Check the admin panel system status
2. Review application logs
3. Verify webhook configurations
4. Test with development environment

## License

This is a production-ready Shopify app template. Customize as needed for your specific requirements.