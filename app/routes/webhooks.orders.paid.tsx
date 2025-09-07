import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { PrismaClient } from '@prisma/client';
import { verifyShopifyWebhook, extractWebhookHeaders, validateWebhookHeaders } from '~/lib/hmac';
import { processOrdersPaidWebhook, validateOrderWebhookPayload } from '~/services/orders';
import { createLogger } from '~/lib/logger';

const prisma = new PrismaClient();
const logger = createLogger({ webhook: 'orders/paid' });

/**
 * Handle orders/paid webhook
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
    
    if (topic !== 'orders/paid') {
      logger.error('Unexpected webhook topic', { topic, expected: 'orders/paid' });
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
    if (!validateOrderWebhookPayload(payload)) {
      logger.error('Invalid order webhook payload', { shopDomain, payload });
      return json({ error: 'Invalid payload structure' }, { status: 400 });
    }
    
    // Process the webhook
    logger.info('Processing orders/paid webhook', {
      shopDomain,
      orderId: payload.admin_graphql_api_id,
      orderName: payload.name,
    });
    
    await processOrdersPaidWebhook(prisma, shopDomain, payload);
    
    logger.info('Successfully processed orders/paid webhook', {
      shopDomain,
      orderId: payload.admin_graphql_api_id,
      orderName: payload.name,
    });
    
    return json({ success: true }, { status: 200 });
    
  } catch (error) {
    logger.error('Error processing orders/paid webhook', {}, error as Error);
    
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

