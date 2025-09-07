import { PrismaClient } from '@prisma/client';
import { findOrCreatePriorityProduct, createShopifyGraphQLClient } from './shopify';
import { createSubscription } from './billing';

/**
 * Automatic setup service for new app installations
 */

export interface SetupResult {
  success: boolean;
  productId?: string;
  variantId?: string;
  subscriptionUrl?: string;
  errors: string[];
}

/**
 * Complete setup for a new shop installation
 */
export async function setupNewShop(
  prisma: PrismaClient,
  shopDomain: string,
  accessToken: string
): Promise<SetupResult> {
  const errors: string[] = [];
  let productId: string | undefined;
  let variantId: string | undefined;
  let subscriptionUrl: string | undefined;

  try {
    console.log(`🚀 Setting up Priority Handling for shop: ${shopDomain}`);

    // 1. Create or update shop record
    const shop = await prisma.shop.upsert({
      where: { domain: shopDomain },
      create: {
        id: `shop_${shopDomain.replace('.myshopify.com', '')}`,
        domain: shopDomain,
        accessToken: accessToken,
        currency: 'USD',
        timezone: 'America/New_York',
        billingCapCents: 50000, // $500 default cap
        feeCents: 500, // $5.00 fee
        slaHours: 3, // 3-hour SLA
      },
      update: {
        accessToken: accessToken,
        updatedAt: new Date(),
      },
    });

    console.log(`✅ Shop record created/updated: ${shop.id}`);

    // 2. Create priority handling product
    try {
      const client = createShopifyGraphQLClient(shopDomain, accessToken);
      const { productId: pid, variantId: vid } = await findOrCreatePriorityProduct(client, 500);
      
      productId = pid;
      variantId = vid;
      
      console.log(`✅ Priority product ready: ${productId}`);
      console.log(`✅ Variant ID: ${variantId}`);
    } catch (error) {
      const errorMsg = `Failed to create priority product: ${error.message}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
    }

    // 3. Set up billing subscription
    try {
      subscriptionUrl = await createSubscription(
        shopDomain,
        accessToken,
        shop.billingCapCents,
        'Priority Handling Usage'
      );
      
      console.log(`✅ Billing subscription created`);
      console.log(`📋 Merchant approval needed: ${subscriptionUrl}`);
    } catch (error) {
      const errorMsg = `Failed to create billing subscription: ${error.message}`;
      console.error(`⚠️ ${errorMsg}`);
      errors.push(errorMsg);
      // Billing errors are non-fatal - app can work without billing initially
    }

    // 4. Update extension configuration if we have a variant ID
    if (variantId) {
      try {
        await updateExtensionVariantId(variantId);
        console.log(`✅ Extension configured with variant ID`);
      } catch (error) {
        const errorMsg = `Failed to update extension: ${error.message}`;
        console.error(`⚠️ ${errorMsg}`);
        errors.push(errorMsg);
        // Extension errors are non-fatal - main app still works
      }
    }

    const success = errors.length === 0 || (productId && variantId); // Success if core product creation worked

    console.log(`${success ? '🎉' : '⚠️'} Setup completed for ${shopDomain} - ${errors.length} errors`);

    return {
      success,
      productId,
      variantId,
      subscriptionUrl,
      errors,
    };

  } catch (error) {
    const errorMsg = `Fatal setup error: ${error.message}`;
    console.error(`💥 ${errorMsg}`);
    
    return {
      success: false,
      errors: [errorMsg],
    };
  }
}

/**
 * Update extension file with the correct variant ID
 */
async function updateExtensionVariantId(variantId: string): Promise<void> {
  try {
    const fs = await import('fs');
    const path = 'extensions/post-purchase/src/index.js';
    
    if (!fs.existsSync(path)) {
      throw new Error('Extension file not found');
    }
    
    let content = fs.readFileSync(path, 'utf8');
    
    // Replace placeholder with real variant ID
    content = content.replace(
      'PRIORITY_HANDLING_VARIANT_ID',
      variantId
    );
    
    fs.writeFileSync(path, content);
    
    console.log(`✅ Updated extension with variant ID: ${variantId}`);
  } catch (error) {
    throw new Error(`Could not update extension file: ${error.message}`);
  }
}

/**
 * Setup existing shop (manual trigger)
 */
export async function setupExistingShop(
  prisma: PrismaClient,
  shopDomain: string
): Promise<SetupResult> {
  // Get shop from database
  const shop = await prisma.shop.findUnique({
    where: { domain: shopDomain },
  });

  if (!shop) {
    return {
      success: false,
      errors: ['Shop not found in database'],
    };
  }

  // Run setup with existing shop data
  return await setupNewShop(prisma, shop.domain, shop.accessToken);
}

/**
 * Check if shop needs setup (missing priority product)
 */
export async function checkShopNeedsSetup(
  prisma: PrismaClient,
  shopDomain: string,
  accessToken: string
): Promise<boolean> {
  try {
    const client = createShopifyGraphQLClient(shopDomain, accessToken);
    
    // Check if priority product exists
    const searchQuery = `
      query getProduct($handle: String!) {
        productByHandle(handle: $handle) {
          id
          variants(first: 1) {
            edges {
              node {
                id
              }
            }
          }
        }
      }
    `;

    const response = await client.request(searchQuery, { handle: 'priority-handling' });
    
    // If product exists and has variants, setup is complete
    return !(response.productByHandle && response.productByHandle.variants.edges.length > 0);
    
  } catch (error) {
    console.error(`Error checking shop setup status: ${error.message}`);
    // If we can't check, assume setup is needed
    return true;
  }
}

/**
 * Get the priority product variant ID for a shop
 */
export async function getPriorityVariantId(
  shopDomain: string,
  accessToken: string
): Promise<string | null> {
  try {
    const client = createShopifyGraphQLClient(shopDomain, accessToken);
    
    const searchQuery = `
      query getProduct($handle: String!) {
        productByHandle(handle: $handle) {
          id
          variants(first: 1) {
            edges {
              node {
                id
              }
            }
          }
        }
      }
    `;

    const response = await client.request(searchQuery, { handle: 'priority-handling' });
    
    return response.productByHandle?.variants.edges[0]?.node.id || null;
    
  } catch (error) {
    console.error(`Error getting priority variant ID: ${error.message}`);
    return null;
  }
}
