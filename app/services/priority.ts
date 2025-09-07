import { PrismaClient } from '@prisma/client';
import { createShopifyGraphQLClient, addOrderTags, addOrderMetafield, addOrderNote, hasPriorityHandling } from './shopify';
import { generatePriorityNote, getCurrentSLAHours } from './sla';

/**
 * Priority handling service - core business logic
 */

const PRIORITY_TAG = 'PRIORITY_SKIP_LINE';
const PRIORITY_METAFIELD = {
  namespace: 'custom',
  key: 'priority_handling',
  type: 'boolean',
};

export interface PriorityOrderData {
  shopId: string;
  orderGid: string;
  orderNumber: string;
  shopDomain: string;
  slaHours: number;
}

/**
 * Check if an order has priority handling based on line items
 */
export function isPriorityOrder(order: any): boolean {
  return hasPriorityHandling(order);
}

/**
 * Mark an order as priority in Shopify (add tags, metafields, notes)
 */
export async function markOrderAsPriority(
  prisma: PrismaClient,
  shop: string,
  accessToken: string,
  orderData: PriorityOrderData
): Promise<void> {
  const { shopId, orderGid, orderNumber, slaHours } = orderData;
  
  // Check if already processed
  const existingMarker = await prisma.orderMarker.findUnique({
    where: { orderGid },
  });
  
  if (existingMarker?.priority) {
    console.log(`Order ${orderNumber} already marked as priority`);
    return;
  }

  const client = createShopifyGraphQLClient(shop, accessToken);
  
  try {
    // Add priority tag to order
    await addOrderTags(client, orderGid, [PRIORITY_TAG]);
    
    // Add priority metafield
    await addOrderMetafield(client, orderGid, {
      ...PRIORITY_METAFIELD,
      value: 'true',
    });
    
    // Add timeline note with dynamic SLA
    const note = generatePriorityNote(orderData.shopDomain === 'packr-test.myshopify.com' ? 'America/New_York' : 'America/New_York');
    await addOrderNote(client, orderGid, note);
    
    // Create or update order marker in database
    await prisma.orderMarker.upsert({
      where: { orderGid },
      create: {
        id: `${shopId}_${orderGid}`,
        shopId,
        orderGid,
        priority: true,
      },
      update: {
        priority: true,
      },
    });
    
    console.log(`Successfully marked order ${orderNumber} as priority in Shopify`);
  } catch (error) {
    console.error(`Error marking order ${orderNumber} as priority:`, error);
    throw error;
  }
}

/**
 * Process priority handling for an order (Shopify only)
 */
export async function processPriorityOrder(
  prisma: PrismaClient,
  shop: string,
  accessToken: string,
  orderData: PriorityOrderData
): Promise<void> {
  const { orderNumber } = orderData;
  
  // Mark order as priority in Shopify
  await markOrderAsPriority(prisma, shop, accessToken, orderData);
  
  console.log(`Successfully processed priority handling for order ${orderNumber}`);
}

/**
 * Count priority orders for a shop on a specific date
 */
export async function countPriorityOrdersForDate(
  prisma: PrismaClient,
  shopId: string,
  date: Date
): Promise<number> {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  
  const count = await prisma.orderMarker.count({
    where: {
      shopId,
      priority: true,
      createdAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
  });
  
  return count;
}

/**
 * Get priority order statistics for a shop
 */
export async function getPriorityOrderStats(
  prisma: PrismaClient,
  shopId: string,
  days: number = 30
): Promise<{
  totalCount: number;
  dailyBreakdown: Array<{ date: string; count: number }>;
}> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  const orders = await prisma.orderMarker.findMany({
    where: {
      shopId,
      priority: true,
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    select: {
      createdAt: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
  
  // Group by date
  const dailyBreakdown = new Map<string, number>();
  
  for (const order of orders) {
    const dateKey = order.createdAt.toISOString().split('T')[0];
    dailyBreakdown.set(dateKey, (dailyBreakdown.get(dateKey) || 0) + 1);
  }
  
  // Convert to array and fill missing dates with 0
  const breakdown: Array<{ date: string; count: number }> = [];
  
  for (let i = 0; i < days; i++) {
    const date = new Date(endDate);
    date.setDate(date.getDate() - i);
    const dateKey = date.toISOString().split('T')[0];
    
    breakdown.unshift({
      date: dateKey,
      count: dailyBreakdown.get(dateKey) || 0,
    });
  }
  
  return {
    totalCount: orders.length,
    dailyBreakdown: breakdown,
  };
}

/**
 * Check if an event has already been processed (idempotency)
 */
export async function isEventProcessed(
  prisma: PrismaClient,
  shopId: string,
  topic: string,
  orderGid: string
): Promise<boolean> {
  const existingEvent = await prisma.processedEvent.findFirst({
    where: {
      shopId,
      topic,
      orderGid,
    },
  });
  
  return !!existingEvent;
}

/**
 * Mark an event as processed
 */
export async function markEventAsProcessed(
  prisma: PrismaClient,
  shopId: string,
  topic: string,
  orderGid: string
): Promise<void> {
  await prisma.processedEvent.create({
    data: {
      id: `${shopId}_${topic}_${orderGid}_${Date.now()}`,
      shopId,
      topic,
      orderGid,
    },
  });
}

/**
 * Format date for database storage (YYYYMMDD)
 */
export function formatDateForStorage(date: Date): string {
  return date.toISOString().split('T')[0].replace(/-/g, '');
}

/**
 * Get today's date in ET timezone
 */
export function getTodayInET(): Date {
  const now = new Date();
  // Convert to ET timezone
  const etOffset = -5; // EST is UTC-5, EDT is UTC-4, but we'll use a library for proper handling
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const et = new Date(utc + (etOffset * 3600000));
  
  et.setHours(0, 0, 0, 0); // Start of day
  return et;
}

/**
 * Validate priority order data
 */
export function validatePriorityOrderData(data: Partial<PriorityOrderData>): data is PriorityOrderData {
  return !!(
    data.shopId &&
    data.orderGid &&
    data.orderNumber &&
    data.shopDomain &&
    typeof data.slaHours === 'number'
  );
}
