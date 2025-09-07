#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';

/**
 * Create test data for Priority Handling dashboard
 */

const prisma = new PrismaClient();

async function createTestData() {
  console.log('🧪 Creating test data for Priority Handling dashboard...\n');

  try {
    // Get existing shops
    const shops = await prisma.shop.findMany();
    
    if (shops.length === 0) {
      console.log('❌ No shops found. Please install the app first.');
      return;
    }

    for (const shop of shops) {
      console.log(`📊 Creating test data for shop: ${shop.domain}`);
      
      // Create test priority orders from different dates
      const testOrders = [
        // Today
        { days: 0, count: 2 },
        // Yesterday  
        { days: 1, count: 3 },
        // 3 days ago
        { days: 3, count: 1 },
        // 7 days ago
        { days: 7, count: 4 },
        // 15 days ago
        { days: 15, count: 2 },
        // 25 days ago
        { days: 25, count: 1 },
      ];

      for (const { days, count } of testOrders) {
        const date = new Date();
        date.setDate(date.getDate() - days);
        
        for (let i = 0; i < count; i++) {
          const orderNumber = Math.floor(Math.random() * 10000) + 1000;
          
          // Create order marker
          await prisma.orderMarker.create({
            data: {
              id: `test_${shop.id}_${Date.now()}_${i}`,
              shopId: shop.id,
              orderGid: `gid://shopify/Order/${orderNumber}`,
              priority: true,
              createdAt: date,
            },
          });
        }
        
        // Create daily usage record for that date
        const dateString = date.toISOString().split('T')[0].replace(/-/g, '');
        const totalAmount = count * shop.feeCents;
        
        const existingUsage = await prisma.dailyUsage.findFirst({
          where: {
            shopId: shop.id,
            yyyymmdd: dateString,
          },
        });

        if (!existingUsage) {
          await prisma.dailyUsage.create({
            data: {
              id: `test_${shop.id}_${dateString}`,
              shopId: shop.id,
              yyyymmdd: dateString,
              count,
              amountCents: totalAmount,
              createdAt: date,
            },
          });
        }
        
        console.log(`  ✅ Created ${count} orders for ${date.toDateString()} ($${(totalAmount / 100).toFixed(2)})`);
      }

      // Update shop to be enabled
      await prisma.shop.update({
        where: { id: shop.id },
        data: {
          feeCents: 500, // $5
          slaHours: 2,
        },
      });
    }

    console.log('\n📈 Test Data Summary:');
    
    for (const shop of shops) {
      const totalOrders = await prisma.orderMarker.count({
        where: { shopId: shop.id, priority: true },
      });
      
      const totalUsage = await prisma.dailyUsage.findMany({
        where: { shopId: shop.id },
      });
      
      const totalRevenue = totalUsage.reduce((sum, usage) => sum + usage.amountCents, 0);
      
      console.log(`\n✅ ${shop.domain}:`);
      console.log(`   - Total priority orders: ${totalOrders}`);
      console.log(`   - Total revenue: $${(totalRevenue / 100).toFixed(2)}`);
      console.log(`   - Settings: $${(shop.feeCents / 100).toFixed(2)} fee, ${shop.slaHours}h SLA`);
    }

    console.log('\n🎉 Test data created successfully!');
    console.log('\n📋 Next steps:');
    console.log('1. Refresh your Priority Handling dashboard');
    console.log('2. Check the statistics and recent orders');
    console.log('3. Visit the Settings page to see the 3PL warnings');

  } catch (error) {
    console.error('💥 Error creating test data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
createTestData().catch((error) => {
  console.error('💥 Unhandled error:', error);
  process.exit(1);
});
