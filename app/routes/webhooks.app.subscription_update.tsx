import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { PrismaClient } from '@prisma/client';
import { verifyShopifyWebhook, extractWebhookHeaders, validateWebhookHeaders } from '~/lib/hmac';
import { createLogger } from '~/lib/logger';

const prisma = new PrismaClient();
const logger = createLogger({ webhook: 'app_subscriptions/update' });

export interface AppSubscriptionUpdatePayload {
  app_subscription: {
    admin_graphql_api_id: string;
    name: string;
    status: string;
    admin_graphql_api_shop_id: string;
    created_at: string;
    updated_at: string;
    line_items: Array<{
      id: number;
      plan: {
        pricing_details: {
          price: {
            amount: string;
            currency_code: string;
          };
          capped_amount?: {
            amount: string;
            currency_code: string;
          };
        };
      };
    }>;
  };
}

/**
 * Process app subscription update webhook
 */
async function processAppSubscriptionUpdate(
  prisma: PrismaClient,
  shopDomain: string,
  payload: AppSubscriptionUpdatePayload
): Promise<void> {
  logger.info('Processing app subscription update', {
    shopDomain,
    subscriptionId: payload.app_subscription.admin_graphql_api_id,
    status: payload.app_subscription.status,
  });

  const shop = await prisma.shop.findUnique({
    where: { domain: shopDomain },
  });

  if (!shop) {
    logger.error('Shop not found', { shopDomain });
    return;
  }

  const subscription = payload.app_subscription;
  
  // Update shop billing cap if subscription has capped amount
  const lineItem = subscription.line_items[0];
  if (lineItem?.plan?.pricing_details?.capped_amount) {
    const cappedAmountCents = Math.round(
      parseFloat(lineItem.plan.pricing_details.capped_amount.amount) * 100
    );

    await prisma.shop.update({
      where: { domain: shopDomain },
      data: {
        billingCapCents: cappedAmountCents,
        updatedAt: new Date(),
      },
    });

    logger.info('Updated shop billing cap', {
      shopDomain,
      newCapCents: cappedAmountCents,
      newCapFormatted: `$${(cappedAmountCents / 100).toFixed(2)}`,
    });
  }

  // Log subscription status changes
  if (subscription.status === 'CANCELLED') {
    logger.warn('App subscription cancelled', {
      shopDomain,
      subscriptionId: subscription.admin_graphql_api_id,
    });
  } else if (subscription.status === 'ACTIVE') {
    logger.info('App subscription activated', {
      shopDomain,
      subscriptionId: subscription.admin_graphql_api_id,
    });
  }
}

/**
 * Validate app subscription webhook payload
 */
function validateAppSubscriptionPayload(payload: any): payload is AppSubscriptionUpdatePayload {
  return !!(
    payload &&
    payload.app_subscription &&
    typeof payload.app_subscription.admin_graphql_api_id === 'string' &&
    typeof payload.app_subscription.name === 'string' &&
    typeof payload.app_subscription.status === 'string' &&
    Array.isArray(payload.app_subscription.line_items)
  );
}

/**
 * Handle app_subscriptions/update webhook
 */
export async function action({ request }: ActionFunctionArgs) {
  const method = request.method;
  
  if (method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }
  
  try {
    // Get headers
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    
    // Validate required headers
    const headerValidation = validateWebhookHeaders(headers);
    if (!headerValidation.isValid) {
      logger.error('Invalid webhook headers', { errors: headerValidation.errors });
      return json({ error: 'Invalid headers', details: headerValidation.errors }, { status: 400 });
    }
    
    // Extract webhook data
    const { signature, topic, shopDomain } = extractWebhookHeaders(headers);
    
    if (!signature || !shopDomain) {
      logger.error('Missing required headers', { signature: !!signature, shopDomain });
      return json({ error: 'Missing required headers' }, { status: 400 });
    }
    
    if (topic !== 'app_subscriptions/update') {
      logger.error('Unexpected webhook topic', { topic, expected: 'app_subscriptions/update' });
      return json({ error: 'Unexpected webhook topic' }, { status: 400 });
    }
    
    // Get raw body for HMAC verification
    const rawBody = await request.text();
    
    // Verify HMAC signature
    const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_API_SECRET;
    if (!webhookSecret) {
      logger.error('Webhook secret not configured');
      return json({ error: 'Server configuration error' }, { status: 500 });
    }
    
    const isValidSignature = verifyShopifyWebhook(rawBody, signature, webhookSecret);
    if (!isValidSignature) {
      logger.error('Invalid webhook signature', { shopDomain });
      return json({ error: 'Invalid signature' }, { status: 401 });
    }
    
    // Parse payload
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (parseError) {
      logger.error('Invalid JSON payload', { shopDomain }, parseError as Error);
      return json({ error: 'Invalid JSON' }, { status: 400 });
    }
    
    // Validate payload structure
    if (!validateAppSubscriptionPayload(payload)) {
      logger.error('Invalid app subscription webhook payload', { shopDomain, payload });
      return json({ error: 'Invalid payload structure' }, { status: 400 });
    }
    
    // Process the webhook
    logger.info('Processing app_subscriptions/update webhook', {
      shopDomain,
      subscriptionId: payload.app_subscription.admin_graphql_api_id,
      status: payload.app_subscription.status,
    });
    
    await processAppSubscriptionUpdate(prisma, shopDomain, payload);
    
    logger.info('Successfully processed app_subscriptions/update webhook', {
      shopDomain,
      subscriptionId: payload.app_subscription.admin_graphql_api_id,
    });
    
    return json({ success: true }, { status: 200 });
    
  } catch (error) {
    logger.error('Error processing app_subscriptions/update webhook', {}, error as Error);
    
    // Return 500 to trigger Shopify retry
    return json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Export empty loader to handle GET requests (for webhook verification)
export async function loader() {
  return json({ error: 'Method not allowed' }, { status: 405 });
}
