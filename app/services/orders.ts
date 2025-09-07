import { PrismaClient } from '@prisma/client';
import { getOrder } from './shopify';
import { processPriorityOrder, isPriorityOrder, isEventProcessed, markEventAsProcessed, validatePriorityOrderData } from './priority';
import { createShopifyGraphQLClient } from './shopify';

/**
 * Order processing service
 */

export interface OrderWebhookPayload {
  id: number;
  admin_graphql_api_id: string;
  name: string;
  order_number: number;
  line_items: Array<{
    id: number;
    variant_id: number;
    title: string;
    quantity: number;
    product_id: number;
  }>;
  customer: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
  };
  total_price: string;
  currency: string;
  created_at: string;
  updated_at: string;
}

/**
 * Process orders/paid webhook
 */
export async function processOrdersPaidWebhook(
  prisma: PrismaClient,
  shopDomain: string,
  payload: OrderWebhookPayload
): Promise<void> {
  console.log(`Processing orders/paid webhook for order ${payload.name} in shop ${shopDomain}`);
  
  // Get shop configuration
  const shop = await prisma.shop.findUnique({
    where: { domain: shopDomain },
  });
  
  if (!shop) {
    console.error(`Shop not found: ${shopDomain}`);
    return;
  }
  
  const { id: shopId, accessToken, slaHours } = shop;
  const orderGid = payload.admin_graphql_api_id;
  const topic = 'orders/paid';
  
  // Check if already processed (idempotency)
  if (await isEventProcessed(prisma, shopId, topic, orderGid)) {
    console.log(`Order ${payload.name} already processed for ${topic}`);
    return;
  }
  
  try {
    // Get full order details from Shopify
    const client = createShopifyGraphQLClient(shopDomain, accessToken);
    const order = await getOrder(client, orderGid);
    
    if (!order) {
      console.error(`Could not retrieve order ${orderGid} from Shopify`);
      return;
    }
    
    // Check if this order has priority handling
    if (isPriorityOrder(order)) {
      console.log(`Order ${payload.name} contains priority handling - processing...`);
      
      // Prepare priority order data
      const orderData = {
        shopId,
        orderGid,
        orderNumber: payload.name,
        shopDomain,
        slaHours,
      };
      
      // Validate the data
      if (!validatePriorityOrderData(orderData)) {
        console.error(`Invalid priority order data for order ${payload.name}:`, orderData);
        return;
      }
      
      // Process priority handling
      await processPriorityOrder(prisma, shopDomain, accessToken, orderData);
      
      console.log(`Successfully processed priority handling for order ${payload.name}`);
    } else {
      console.log(`Order ${payload.name} does not contain priority handling`);
    }
    
    // Mark event as processed
    await markEventAsProcessed(prisma, shopId, topic, orderGid);
    
  } catch (error) {
    console.error(`Error processing orders/paid webhook for order ${payload.name}:`, error);
    throw error;
  }
}

/**
 * Get order statistics for a shop
 */
export async function getOrderStatistics(
  prisma: PrismaClient,
  shopId: string,
  days: number = 30
): Promise<{
  totalOrders: number;
  priorityOrders: number;
  priorityPercentage: number;
  totalRevenue: number;
  priorityRevenue: number;
}> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  // Get priority order markers
  const priorityOrders = await prisma.orderMarker.findMany({
    where: {
      shopId,
      priority: true,
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    },
  });
  
  // Get daily usage records for revenue calculation
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { feeCents: true },
  });
  
  const feeCents = shop?.feeCents || 500;
  const priorityCount = priorityOrders.length;
  const priorityRevenue = priorityCount * feeCents;
  
  // For now, we don't have total order count in our DB
  // In a real implementation, you might want to track all orders or query Shopify
  const totalOrders = priorityCount; // Placeholder
  const totalRevenue = priorityRevenue; // Placeholder
  
  return {
    totalOrders,
    priorityOrders: priorityCount,
    priorityPercentage: totalOrders > 0 ? (priorityCount / totalOrders) * 100 : 0,
    totalRevenue,
    priorityRevenue,
  };
}

/**
 * Get recent priority orders for a shop
 */
export async function getRecentPriorityOrders(
  prisma: PrismaClient,
  shopId: string,
  limit: number = 10
): Promise<Array<{
  orderGid: string;
  createdAt: Date;
}>> {
  const orders = await prisma.orderMarker.findMany({
    where: {
      shopId,
      priority: true,
    },
    select: {
      orderGid: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: limit,
  });
  
  return orders;
}

/**
 * Validate webhook payload
 */
export function validateOrderWebhookPayload(payload: any): payload is OrderWebhookPayload {
  return !!(
    payload &&
    typeof payload.id === 'number' &&
    typeof payload.admin_graphql_api_id === 'string' &&
    typeof payload.name === 'string' &&
    typeof payload.order_number === 'number' &&
    Array.isArray(payload.line_items) &&
    payload.customer &&
    typeof payload.total_price === 'string'
  );
}

/**
 * Extract shop domain from headers or payload
 */
export function extractShopDomain(headers: Record<string, string>): string | null {
  const shopDomain = headers['x-shopify-shop-domain'];
  
  if (!shopDomain) {
    console.error('Missing x-shopify-shop-domain header');
    return null;
  }
  
  return shopDomain;
}

