# Priority Handling Shopify App 🚀

A production-ready Shopify app that offers post-purchase priority handling upsells, automatically tags orders, and bills merchants using Shopify's usage-based billing system.

## Features

- **Post-Purchase Upsell**: Customers can purchase priority handling after checkout
- **Order Tagging**: Orders with priority handling are automatically tagged in Shopify
- **Usage-Based Billing**: Merchants are billed monthly based on priority orders processed
- **Admin Dashboard**: Merchants can configure pricing, SLA hours, and view statistics
- **Automated Processing**: Nightly cron job handles billing automatically
- **Webhook Processing**: Secure webhook handlers with HMAC verification

## Architecture

- **Framework**: Remix + TypeScript
- **Database**: Prisma + SQLite (dev) / PostgreSQL (prod)
- **Authentication**: Shopify OAuth
- **Billing**: Shopify App Usage Charges
- **Extensions**: Post-Purchase UI Extension
- **Scheduling**: node-cron for daily billing
- **Testing**: Vitest + mocked dependencies

## Quick Start

### 1. Environment Setup

```bash
# Copy environment variables
cp env.example .env

# Fill in your Shopify app credentials
SHOPIFY_API_KEY=your_api_key_here
SHOPIFY_API_SECRET=your_api_secret_here
SHOP=your-dev-shop.myshopify.com
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Database Setup

```bash
# Generate Prisma client
npm run prisma generate

# Run migrations
npm run db:migrate
```

### 4. Run Development

```bash
# Start the development server
npm run dev
```

### 5. Seed the App

After installing the app on a shop:

```bash
# Create priority product and setup billing
npm run seed
```

## Project Structure

```
├── app/
│   ├── routes/                    # Remix routes
│   │   ├── app.settings.tsx       # Admin settings page
│   │   ├── webhooks.orders.paid.tsx
│   │   └── webhooks.app.subscription_update.tsx
│   ├── services/                  # Business logic
│   │   ├── billing.ts             # Shopify billing integration
│   │   ├── priority.ts            # Priority handling logic
│   │   ├── orders.ts              # Order processing
│   │   ├── shopify.ts             # Shopify GraphQL client
│   │   └── cron.ts                # Daily billing cron
│   └── lib/                       # Utilities
│       ├── hmac.ts                # Webhook verification
│       ├── logger.ts              # Structured logging
│       └── init.ts                # App initialization
├── extensions/
│   └── post-purchase/             # Post-purchase extension
│       ├── shopify.extension.toml
│       └── src/Extension.tsx
├── prisma/
│   └── schema.prisma              # Database schema
├── tests/                         # Test files
├── scripts/
│   └── seed.ts                    # Setup script
└── package.json
```

## Database Schema

### Core Models

- **Shop**: Store configuration (pricing, SLA, billing caps)
- **OrderMarker**: Track priority orders
- **ProcessedEvent**: Idempotency for webhooks
- **DailyUsage**: Billing records per shop per day

## Configuration

### Shop Settings (via Admin UI)

- **Priority Fee**: Amount charged per priority order (cents)
- **SLA Hours**: Guaranteed processing time
- **Billing Cap**: Monthly maximum charge

### Extension Settings

Configure in `extensions/post-purchase/shopify.extension.toml`:

- `priority_fee_cents`: Default fee amount
- `sla_hours`: Default SLA
- `enabled`: Enable/disable the upsell

## Billing Flow

1. **Daily Cron Job** (23:55 ET):
   - Count priority orders from previous day
   - Calculate total charges (count × fee)
   - Create usage record in Shopify
   - Store in local database for tracking

2. **Usage Records**:
   - Idempotent with unique keys per shop/date
   - Respect monthly caps set by merchant
   - Automatic retry on failures

## Post-Purchase Flow

1. Customer completes checkout
2. Post-purchase extension shows priority handling offer
3. On acceptance:
   - Priority product variant added to order
   - Order attributes updated
   - Customer charged immediately
4. `orders/paid` webhook triggered:
   - Order tagged with `PRIORITY_SKIP_LINE`
   - Metafield `custom.priority_handling = true` added
   - Timeline note added with SLA information

## API Endpoints

### Webhooks
- `POST /webhooks/orders/paid` - Process priority orders
- `POST /webhooks/app/subscription_update` - Handle billing changes

### Admin Routes
- `GET /app` - Dashboard
- `GET /app/settings` - Configuration page
- `POST /app/settings` - Update settings

## Testing

```bash
# Run all tests
npm test

# Run with UI
npm run test:ui

# Run specific test file
npm test billing.test.ts
```

### Test Coverage

- **Unit Tests**: Core business logic (billing, priority processing)
- **Integration Tests**: Webhook processing with mocked dependencies
- **Validation Tests**: Payload validation and error handling

## Deployment

### Prerequisites

1. Shopify Partner account
2. App created in Partner Dashboard
3. Production database (PostgreSQL recommended)
4. Hosting platform (Heroku, Railway, etc.)

### Environment Variables

```bash
# Production settings
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@host:5432/db
ENABLE_CRON=true

# Shopify credentials
SHOPIFY_API_KEY=your_production_key
SHOPIFY_API_SECRET=your_production_secret
SHOPIFY_WEBHOOK_SECRET=your_webhook_secret

# App URL
HOST=https://your-app-domain.com
```

### Deploy Steps

1. **Build the app**:
   ```bash
   npm run build
   ```

2. **Run database migrations**:
   ```bash
   npm run setup
   ```

3. **Deploy extensions**:
   ```bash
   npm run deploy
   ```

4. **Seed production shops**:
   ```bash
   npm run seed
   ```

## Monitoring

### Logs

The app uses structured JSON logging:

```javascript
import { createLogger } from '~/lib/logger';
const logger = createLogger({ service: 'billing' });

logger.info('Processing daily billing', { shopId, date });
logger.error('Billing failed', { shopId }, error);
```

### Key Metrics

- Daily priority order counts per shop
- Billing success/failure rates
- Webhook processing times
- Extension conversion rates

## Security

### HMAC Verification

All webhooks are verified using Shopify's HMAC signatures:

```javascript
import { verifyShopifyWebhook } from '~/lib/hmac';

const isValid = verifyShopifyWebhook(payload, signature, secret);
```

### Idempotency

- **Webhooks**: `ProcessedEvent` table prevents duplicate processing
- **Billing**: `DailyUsage` unique constraints prevent double billing
- **Usage Records**: Shopify idempotency keys prevent duplicates

## Troubleshooting

### Common Issues

1. **Extension not showing**:
   - Check extension configuration in Partner Dashboard
   - Verify shop has post-purchase extensions enabled
   - Check extension settings in admin

2. **Billing not working**:
   - Verify subscription is approved by merchant
   - Check webhook endpoints are accessible
   - Review cron job logs

3. **Orders not tagged**:
   - Verify webhook delivery in Partner Dashboard
   - Check HMAC signature verification
   - Review order processing logs

### Debug Commands

```bash
# Test webhook locally
curl -X POST http://localhost:3000/webhooks/orders/paid \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Topic: orders/paid" \
  -d @test-order.json

# Trigger manual billing
npm run seed -- --trigger-billing

# Check database
npx prisma studio
```

## Development

### Adding Features

1. **New Services**: Add to `app/services/`
2. **New Routes**: Add to `app/routes/`
3. **Database Changes**: Update `prisma/schema.prisma` and migrate
4. **Tests**: Add corresponding test files in `tests/`

### Code Style

- TypeScript everywhere
- Structured error handling
- Comprehensive logging
- Idempotent operations
- Security-first approach

## License

MIT - See LICENSE file for details

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review logs for error details
3. Test with Shopify's webhook testing tools
4. Verify all environment variables are set correctly

---

Built with ❤️ for Shopify merchants who want to offer priority handling to their customers.
