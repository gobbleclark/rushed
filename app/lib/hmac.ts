import { createHmac } from 'crypto';

/**
 * HMAC verification utilities for Shopify webhooks
 */

/**
 * Verify Shopify webhook HMAC signature
 */
export function verifyShopifyWebhook(
  payload: string,
  signature: string,
  secret: string
): boolean {
  if (!signature || !secret) {
    return false;
  }
  
  // Remove 'sha256=' prefix if present
  const cleanSignature = signature.replace(/^sha256=/, '');
  
  // Calculate expected HMAC
  const expectedHmac = createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('base64');
  
  // Compare signatures
  return cleanSignature === expectedHmac;
}

/**
 * Verify Shopify webhook using Buffer (for binary data)
 */
export function verifyShopifyWebhookBuffer(
  payload: Buffer,
  signature: string,
  secret: string
): boolean {
  if (!signature || !secret) {
    return false;
  }
  
  // Remove 'sha256=' prefix if present
  const cleanSignature = signature.replace(/^sha256=/, '');
  
  // Calculate expected HMAC
  const expectedHmac = createHmac('sha256', secret)
    .update(payload)
    .digest('base64');
  
  // Compare signatures
  return cleanSignature === expectedHmac;
}

/**
 * Extract and verify webhook headers
 */
export function extractWebhookHeaders(headers: Record<string, string>): {
  signature: string | null;
  topic: string | null;
  shopDomain: string | null;
} {
  return {
    signature: headers['x-shopify-hmac-sha256'] || null,
    topic: headers['x-shopify-topic'] || null,
    shopDomain: headers['x-shopify-shop-domain'] || null,
  };
}

/**
 * Validate required webhook headers
 */
export function validateWebhookHeaders(headers: Record<string, string>): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  if (!headers['x-shopify-hmac-sha256']) {
    errors.push('Missing x-shopify-hmac-sha256 header');
  }
  
  if (!headers['x-shopify-topic']) {
    errors.push('Missing x-shopify-topic header');
  }
  
  if (!headers['x-shopify-shop-domain']) {
    errors.push('Missing x-shopify-shop-domain header');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
  };
}

