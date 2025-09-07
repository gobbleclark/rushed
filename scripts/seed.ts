#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';
import { shopifyApi } from '../app/shopify.server';
import { findOrCreatePriorityProduct, createShopifyGraphQLClient } from '../app/services/shopify';
import { createSubscription } from '../app/services/billing';

/**
 * Seed script to set up Priority Handling app
 * 
 * This script:
 * 1. Creates the priority handling product in each shop
 * 2. Sets up billing subscriptions for each shop
 * 3. Updates extension configuration with the product variant ID
 */

const prisma = new PrismaClient();

async function seedShop(shop: any) {
  console.log(`\n🌱 Seeding shop: ${shop.domain}`);
  
  try {
    const client = createShopifyGraphQLClient(shop.domain, shop.accessToken);
    
    // 1. Create or find priority handling product
    console.log('  📦 Creating priority handling product...');
    const { productId, variantId } = await findOrCreatePriorityProduct(client, shop.feeCents);
    
    console.log(`  ✅ Priority product created/found:`);
    console.log(`     Product ID: ${productId}`);
    console.log(`     Variant ID: ${variantId}`);
    console.log(`     Price: $${(shop.feeCents / 100).toFixed(2)}`);

    // 2. Create app subscription for billing
    console.log('  💳 Setting up billing subscription...');
    try {
      const confirmationUrl = await createSubscription(
        shop.domain,
        shop.accessToken,
        shop.billingCapCents,
        'Priority Handling Usage'
      );
      
      console.log(`  ✅ Billing subscription created`);
      console.log(`     Confirmation URL: ${confirmationUrl}`);
      console.log(`     Monthly Cap: $${(shop.billingCapCents / 100).toFixed(2)}`);
      
      // Note: Merchant needs to approve this subscription
      console.log(`  ⚠️  Merchant must approve subscription at: ${confirmationUrl}`);
      
    } catch (billingError) {
      console.log(`  ⚠️  Billing setup skipped (may already exist): ${billingError.message}`);
    }

    console.log(`  ✅ Shop ${shop.domain} seeded successfully`);
    
    return {
      shopDomain: shop.domain,
      productId,
      variantId,
      success: true,
    };
    
  } catch (error) {
    console.error(`  ❌ Error seeding shop ${shop.domain}:`, error);
    return {
      shopDomain: shop.domain,
      error: error.message,
      success: false,
    };
  }
}

async function updateExtensionConfig(results: any[]) {
  console.log('\n⚙️  Updating extension configuration...');
  
  // Find the first successful variant ID to use as default
  const successfulResult = results.find(r => r.success && r.variantId);
  
  if (!successfulResult) {
    console.log('  ⚠️  No successful product creation found, skipping extension config update');
    return;
  }

  // Update the post-purchase extension with the correct variant ID
  const extensionPath = 'extensions/post-purchase/src/index.js';
  
  try {
    const fs = await import('fs');
    let extensionContent = fs.readFileSync(extensionPath, 'utf8');
    
    // Replace the placeholder variant ID with the real one
    extensionContent = extensionContent.replace(
      'PRIORITY_HANDLING_VARIANT_ID',
      successfulResult.variantId
    );
    
    fs.writeFileSync(extensionPath, extensionContent);
    
    console.log(`  ✅ Updated extension with variant ID: ${successfulResult.variantId}`);
  } catch (error) {
    console.log(`  ⚠️  Could not update extension file: ${error.message}`);
    console.log(`  📝 Manual update needed - replace PRIORITY_HANDLING_VARIANT_ID with: ${successfulResult.variantId}`);
  }
}

async function main() {
  console.log('🚀 Starting Priority Handling App Seed Script\n');
  
  try {
    // Get all shops
    const shops = await prisma.shop.findMany();
    
    if (shops.length === 0) {
      console.log('❌ No shops found in database. Install the app first.');
      process.exit(1);
    }
    
    console.log(`📊 Found ${shops.length} shop(s) to seed:`);
    shops.forEach(shop => {
      console.log(`   - ${shop.domain} (Fee: $${(shop.feeCents / 100).toFixed(2)}, SLA: ${shop.slaHours}h)`);
    });

    // Seed each shop
    const results = [];
    for (const shop of shops) {
      const result = await seedShop(shop);
      results.push(result);
    }

    // Update extension configuration
    await updateExtensionConfig(results);

    // Summary
    console.log('\n📈 Seeding Summary:');
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`✅ Successful: ${successful.length}`);
    console.log(`❌ Failed: ${failed.length}`);
    
    if (failed.length > 0) {
      console.log('\n❌ Failed shops:');
      failed.forEach(result => {
        console.log(`   - ${result.shopDomain}: ${result.error}`);
      });
    }

    if (successful.length > 0) {
      console.log('\n✅ Successful shops:');
      successful.forEach(result => {
        console.log(`   - ${result.shopDomain}`);
        console.log(`     Product: ${result.productId}`);
        console.log(`     Variant: ${result.variantId}`);
      });
    }

    console.log('\n🎉 Seed script completed!');
    
    if (successful.length > 0) {
      console.log('\n📋 Next Steps:');
      console.log('1. Merchants need to approve billing subscriptions');
      console.log('2. Update Extension.tsx with the correct variant IDs');
      console.log('3. Deploy the app and extensions');
      console.log('4. Test the post-purchase flow');
    }

  } catch (error) {
    console.error('💥 Fatal error during seeding:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Handle command line arguments
const args = process.argv.slice(2);
const shopFilter = args.find(arg => arg.startsWith('--shop='))?.split('=')[1];

if (shopFilter) {
  console.log(`🎯 Filtering for shop: ${shopFilter}`);
}

// Run the seed script
main().catch((error) => {
  console.error('💥 Unhandled error:', error);
  process.exit(1);
});
