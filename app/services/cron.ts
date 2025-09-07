import * as cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { createUsageRecord, generateUsageIdempotencyKey } from './billing';
import { countPriorityOrdersForDate, formatDateForStorage, getTodayInET } from './priority';

/**
 * Cron job service for nightly billing
 */

export interface CronJobStatus {
  lastRun?: Date;
  status: 'success' | 'error' | 'running';
  message?: string;
  processedShops: number;
  totalAmount: number;
}

let cronJobStatus: CronJobStatus = {
  status: 'success',
  processedShops: 0,
  totalAmount: 0,
};

/**
 * Process daily billing for a single shop
 */
async function processDailyBillingForShop(
  prisma: PrismaClient,
  shop: any,
  date: Date
): Promise<{ count: number; amount: number }> {
  const { id: shopId, domain, accessToken, feeCents } = shop;
  const dateString = formatDateForStorage(date);
  
  // Check if already processed for this date
  const existingUsage = await prisma.dailyUsage.findFirst({
    where: {
      shopId,
      yyyymmdd: dateString,
    },
  });
  
  if (existingUsage) {
    console.log(`Daily usage already processed for shop ${domain} on ${dateString}`);
    return { count: existingUsage.count, amount: existingUsage.amountCents };
  }
  
  // Count priority orders for the date
  const count = await countPriorityOrdersForDate(prisma, shopId, date);
  
  if (count === 0) {
    console.log(`No priority orders for shop ${domain} on ${dateString}`);
    
    // Still record 0 usage to mark as processed
    await prisma.dailyUsage.create({
      data: {
        id: `${shopId}_${dateString}`,
        shopId,
        yyyymmdd: dateString,
        count: 0,
        amountCents: 0,
      },
    });
    
    return { count: 0, amount: 0 };
  }
  
  // Calculate total amount (fee per order)
  const totalAmountCents = count * feeCents;
  
  // Create usage record in Shopify
  const idempotencyKey = generateUsageIdempotencyKey(shopId, dateString);
  const description = `Priority Handling: ${count} orders on ${date.toISOString().split('T')[0]}`;
  
  try {
    await createUsageRecord(
      domain,
      accessToken,
      totalAmountCents,
      description,
      idempotencyKey
    );
    
    console.log(`Created usage record for shop ${domain}: ${count} orders, $${(totalAmountCents / 100).toFixed(2)}`);
  } catch (error) {
    console.error(`Failed to create usage record for shop ${domain}:`, error);
    throw error;
  }
  
  // Record in our database
  await prisma.dailyUsage.create({
    data: {
      id: `${shopId}_${dateString}`,
      shopId,
      yyyymmdd: dateString,
      count,
      amountCents: totalAmountCents,
    },
  });
  
  return { count, amount: totalAmountCents };
}

/**
 * Run daily billing for all shops
 */
export async function runDailyBilling(prisma: PrismaClient): Promise<CronJobStatus> {
  const startTime = new Date();
  
  cronJobStatus = {
    lastRun: startTime,
    status: 'running',
    processedShops: 0,
    totalAmount: 0,
  };
  
  try {
    // Get yesterday's date in ET timezone (billing runs at 23:55 ET for the previous day)
    const yesterday = getTodayInET();
    yesterday.setDate(yesterday.getDate() - 1);
    
    console.log(`Starting daily billing for ${yesterday.toISOString().split('T')[0]}`);
    
    // Get all active shops
    const shops = await prisma.shop.findMany({
      select: {
        id: true,
        domain: true,
        accessToken: true,
        feeCents: true,
      },
    });
    
    let totalProcessedShops = 0;
    let totalAmountCents = 0;
    const errors: string[] = [];
    
    for (const shop of shops) {
      try {
        const result = await processDailyBillingForShop(prisma, shop, yesterday);
        totalProcessedShops++;
        totalAmountCents += result.amount;
        
        console.log(`Processed shop ${shop.domain}: ${result.count} orders, $${(result.amount / 100).toFixed(2)}`);
      } catch (error) {
        const errorMessage = `Error processing shop ${shop.domain}: ${error}`;
        console.error(errorMessage);
        errors.push(errorMessage);
      }
    }
    
    const endTime = new Date();
    const duration = endTime.getTime() - startTime.getTime();
    
    cronJobStatus = {
      lastRun: endTime,
      status: errors.length > 0 ? 'error' : 'success',
      message: errors.length > 0 
        ? `Completed with ${errors.length} errors: ${errors.join('; ')}`
        : `Successfully processed ${totalProcessedShops} shops in ${duration}ms`,
      processedShops: totalProcessedShops,
      totalAmount: totalAmountCents,
    };
    
    console.log(`Daily billing completed: ${cronJobStatus.message}`);
    
  } catch (error) {
    cronJobStatus = {
      lastRun: startTime,
      status: 'error',
      message: `Fatal error during daily billing: ${error}`,
      processedShops: 0,
      totalAmount: 0,
    };
    
    console.error('Fatal error during daily billing:', error);
  }
  
  return cronJobStatus;
}

/**
 * Get the current cron job status
 */
export function getCronJobStatus(): CronJobStatus {
  return cronJobStatus;
}

/**
 * Initialize and start the cron job
 * Runs daily at 23:55 ET
 */
export function initializeCronJob(prisma: PrismaClient): void {
  // Set timezone to America/New_York
  const timezone = 'America/New_York';
  
  // Schedule for 23:55 ET daily
  cron.schedule('55 23 * * *', async () => {
    console.log('Starting scheduled daily billing job...');
    await runDailyBilling(prisma);
  }, {
    scheduled: true,
    timezone,
  });
  
  console.log('Daily billing cron job initialized (23:55 ET)');
}

/**
 * Manually trigger daily billing (for testing)
 */
export async function triggerManualBilling(
  prisma: PrismaClient,
  date?: Date
): Promise<CronJobStatus> {
  console.log('Manually triggering daily billing...');
  
  if (date) {
    // For manual runs with specific date, we need to modify the logic slightly
    const shops = await prisma.shop.findMany({
      select: {
        id: true,
        domain: true,
        accessToken: true,
        feeCents: true,
      },
    });
    
    let totalProcessedShops = 0;
    let totalAmountCents = 0;
    const errors: string[] = [];
    
    for (const shop of shops) {
      try {
        const result = await processDailyBillingForShop(prisma, shop, date);
        totalProcessedShops++;
        totalAmountCents += result.amount;
      } catch (error) {
        errors.push(`Error processing shop ${shop.domain}: ${error}`);
      }
    }
    
    return {
      lastRun: new Date(),
      status: errors.length > 0 ? 'error' : 'success',
      message: errors.length > 0 
        ? `Manual run completed with ${errors.length} errors`
        : `Manual run successful`,
      processedShops: totalProcessedShops,
      totalAmount: totalAmountCents,
    };
  }
  
  return await runDailyBilling(prisma);
}

