// Simple test to verify database and core functions work
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testDatabase() {
  console.log('🧪 Testing Priority Handling Database...\n');

  try {
    // Test 1: Create a test shop
    console.log('1. Creating test shop...');
    const shop = await prisma.shop.upsert({
      where: { domain: 'test-shop.myshopify.com' },
      create: {
        id: 'test-shop-123',
        domain: 'test-shop.myshopify.com',
        accessToken: 'test-token',
        currency: 'USD',
        timezone: 'America/New_York',
        billingCapCents: 50000, // $500
        feeCents: 500, // $5
        slaHours: 2,
      },
      update: {
        updatedAt: new Date(),
      },
    });
    console.log('✅ Shop created:', shop.domain);

    // Test 2: Create a priority order marker
    console.log('\n2. Creating priority order marker...');
    const orderMarker = await prisma.orderMarker.create({
      data: {
        id: 'test-order-123',
        shopId: shop.id,
        orderGid: 'gid://shopify/Order/123456',
        priority: true,
      },
    });
    console.log('✅ Order marker created:', orderMarker.orderGid);

    // Test 3: Create daily usage record
    console.log('\n3. Creating daily usage record...');
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const dailyUsage = await prisma.dailyUsage.upsert({
      where: {
        shopId_yyyymmdd: {
          shopId: shop.id,
          yyyymmdd: today,
        },
      },
      create: {
        id: `${shop.id}_${today}`,
        shopId: shop.id,
        yyyymmdd: today,
        count: 1,
        amountCents: 500,
      },
      update: {
        count: 1,
        amountCents: 500,
      },
    });
    console.log('✅ Daily usage record created:', `${dailyUsage.count} orders, $${(dailyUsage.amountCents / 100).toFixed(2)}`);

    // Test 4: Query statistics
    console.log('\n4. Querying statistics...');
    const totalOrders = await prisma.orderMarker.count({
      where: {
        shopId: shop.id,
        priority: true,
      },
    });
    
    const totalUsage = await prisma.dailyUsage.findMany({
      where: { shopId: shop.id },
    });
    
    const totalRevenue = totalUsage.reduce((sum, usage) => sum + usage.amountCents, 0);
    
    console.log('✅ Statistics:');
    console.log(`   - Total priority orders: ${totalOrders}`);
    console.log(`   - Total revenue: $${(totalRevenue / 100).toFixed(2)}`);
    console.log(`   - Shop settings: $${(shop.feeCents / 100).toFixed(2)} per order, ${shop.slaHours}h SLA`);

    console.log('\n🎉 All database tests passed! Your Priority Handling app is ready!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testDatabase();
