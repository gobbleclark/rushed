import { GraphQLClient } from 'graphql-request';
import { shopifyApi } from '../shopify.server';

/**
 * Shopify GraphQL Admin API client and helper functions
 */

export interface ShopifyOrderTag {
  id: string;
  tags: string[];
}

export interface ShopifyOrderMetafield {
  namespace: string;
  key: string;
  value: string;
  type: string;
}

export interface ShopifyProduct {
  id: string;
  handle: string;
  title: string;
  tags: string[];
  variants: {
    edges: Array<{
      node: {
        id: string;
        price: string;
        title: string;
      }
    }>
  }
}

/**
 * Create a GraphQL client for Shopify Admin API
 */
export function createShopifyGraphQLClient(shop: string, accessToken: string) {
  return new GraphQLClient(`https://${shop}/admin/api/2024-01/graphql.json`, {
    headers: {
      'X-Shopify-Access-Token': accessToken,
    },
  });
}

/**
 * Add tags to a Shopify order
 */
export async function addOrderTags(
  client: GraphQLClient,
  orderId: string,
  tags: string[]
): Promise<void> {
  const mutation = `
    mutation orderUpdate($input: OrderInput!) {
      orderUpdate(input: $input) {
        order {
          id
          tags
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    input: {
      id: orderId,
      tags: tags,
    },
  };

  const response = await client.request(mutation, variables);
  
  if (response.orderUpdate.userErrors.length > 0) {
    throw new Error(`Failed to add tags: ${JSON.stringify(response.orderUpdate.userErrors)}`);
  }
}

/**
 * Add a metafield to a Shopify order
 */
export async function addOrderMetafield(
  client: GraphQLClient,
  orderId: string,
  metafield: ShopifyOrderMetafield
): Promise<void> {
  const mutation = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          namespace
          key
          value
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    metafields: [
      {
        ownerId: orderId,
        namespace: metafield.namespace,
        key: metafield.key,
        value: metafield.value,
        type: metafield.type,
      },
    ],
  };

  const response = await client.request(mutation, variables);
  
  if (response.metafieldsSet.userErrors.length > 0) {
    throw new Error(`Failed to add metafield: ${JSON.stringify(response.metafieldsSet.userErrors)}`);
  }
}

/**
 * Add a timeline note to a Shopify order
 */
export async function addOrderNote(
  client: GraphQLClient,
  orderId: string,
  note: string
): Promise<void> {
  const mutation = `
    mutation orderUpdate($input: OrderInput!) {
      orderUpdate(input: $input) {
        order {
          id
          note
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    input: {
      id: orderId,
      note: note,
    },
  };

  const response = await client.request(mutation, variables);
  
  if (response.orderUpdate.userErrors.length > 0) {
    throw new Error(`Failed to add note: ${JSON.stringify(response.orderUpdate.userErrors)}`);
  }
}

/**
 * Get order details by ID
 */
export async function getOrder(
  client: GraphQLClient,
  orderId: string
): Promise<any> {
  const query = `
    query getOrder($id: ID!) {
      order(id: $id) {
        id
        name
        tags
        totalPrice
        lineItems(first: 50) {
          edges {
            node {
              id
              title
              quantity
              variant {
                id
                title
                product {
                  id
                  handle
                  tags
                }
              }
            }
          }
        }
        metafields(first: 50) {
          edges {
            node {
              id
              namespace
              key
              value
            }
          }
        }
      }
    }
  `;

  const variables = { id: orderId };
  const response = await client.request(query, variables);
  return response.order;
}

/**
 * Find or create the priority handling product
 */
export async function findOrCreatePriorityProduct(
  client: GraphQLClient,
  feeCents: number
): Promise<{ productId: string; variantId: string }> {
  const handle = 'priority-handling';
  
  // First, try to find existing product
  const searchQuery = `
    query getProduct($handle: String!) {
      productByHandle(handle: $handle) {
        id
        handle
        variants(first: 1) {
          edges {
            node {
              id
              price
            }
          }
        }
      }
    }
  `;

  const searchResponse = await client.request(searchQuery, { handle });
  
  if (searchResponse.productByHandle) {
    const product = searchResponse.productByHandle;
    const variantId = product.variants.edges[0]?.node.id;
    
    if (variantId) {
      return {
        productId: product.id,
        variantId,
      };
    }
  }

  // Create new product if not found
  const createMutation = `
    mutation productCreate($input: ProductInput!) {
      productCreate(input: $input) {
        product {
          id
          handle
          variants(first: 1) {
            edges {
              node {
                id
                price
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const price = (feeCents / 100).toFixed(2);
  
  const createVariables = {
    input: {
      title: 'Priority Handling Fee',
      handle: handle,
      descriptionHtml: '<p>Skip the line - Priority handling service</p>',
      productType: 'Service',
      tags: ['priority_handling_fee', 'service'],
      status: 'ACTIVE',
    },
  };

  const createResponse = await client.request(createMutation, createVariables);
  
  if (createResponse.productCreate.userErrors.length > 0) {
    throw new Error(`Failed to create priority product: ${JSON.stringify(createResponse.productCreate.userErrors)}`);
  }

  const product = createResponse.productCreate.product;
  const variantId = product.variants.edges[0]?.node.id;
  
  if (!variantId) {
    throw new Error('Failed to get variant ID from created product');
  }

  // Update the variant with the correct price and settings
  const updateVariantMutation = `
    mutation productVariantUpdate($input: ProductVariantInput!) {
      productVariantUpdate(input: $input) {
        productVariant {
          id
          price
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const updateVariantVariables = {
    input: {
      id: variantId,
      price: price,
      requiresShipping: false,
      taxable: false,
      inventoryManagement: null,
      inventoryPolicy: 'CONTINUE',
    },
  };

  const updateResponse = await client.request(updateVariantMutation, updateVariantVariables);
  
  if (updateResponse.productVariantUpdate.userErrors.length > 0) {
    console.warn(`Warning: Could not update variant settings: ${JSON.stringify(updateResponse.productVariantUpdate.userErrors)}`);
    // Don't throw error here, as the product was created successfully
  }

  return {
    productId: product.id,
    variantId,
  };
}

/**
 * Check if an order contains the priority handling fee
 */
export function hasPriorityHandling(order: any): boolean {
  if (!order.lineItems?.edges) return false;
  
  return order.lineItems.edges.some((edge: any) => {
    const product = edge.node.variant?.product;
    return product?.handle === 'priority-handling' || 
           product?.tags?.includes('priority_handling_fee');
  });
}

