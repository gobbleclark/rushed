import { GraphQLClient } from 'graphql-request';
import { createShopifyGraphQLClient } from './shopify';

/**
 * Shopify App Billing service for usage-based charges
 */

export interface AppSubscription {
  id: string;
  name: string;
  status: string;
  lineItems: Array<{
    id: string;
    plan: {
      pricingDetails: {
        cappedAmount: {
          amount: string;
          currencyCode: string;
        };
      };
    };
  }>;
}

export interface UsageRecord {
  id: string;
  description: string;
  price: {
    amount: string;
    currencyCode: string;
  };
  createdAt: string;
}

/**
 * Create an app subscription with usage-based pricing
 */
export async function createSubscription(
  shop: string,
  accessToken: string,
  cappedAmountCents: number,
  priceName: string = 'Priority Handling Usage'
): Promise<string> {
  const client = createShopifyGraphQLClient(shop, accessToken);
  
  const mutation = `
    mutation appSubscriptionCreate($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!) {
      appSubscriptionCreate(name: $name, lineItems: $lineItems, returnUrl: $returnUrl) {
        appSubscription {
          id
          status
        }
        confirmationUrl
        userErrors {
          field
          message
        }
      }
    }
  `;

  const cappedAmount = (cappedAmountCents / 100).toFixed(2);
  
  const variables = {
    name: 'Priority Handling Subscription',
    returnUrl: 'https://military-donors-seeks-operators.trycloudflare.com/app',
    lineItems: [
      {
        plan: {
          appUsagePricingDetails: {
            cappedAmount: {
              amount: cappedAmount,
              currencyCode: 'USD',
            },
            terms: `Usage charges for priority handling service. $5.00 per priority order, capped at $${cappedAmount} per month.`,
          },
        },
      },
    ],
    test: process.env.NODE_ENV !== 'production',
  };

  const response = await client.request(mutation, variables);
  
  if (response.appSubscriptionCreate.userErrors.length > 0) {
    throw new Error(`Failed to create subscription: ${JSON.stringify(response.appSubscriptionCreate.userErrors)}`);
  }

  // Return confirmation URL for merchant approval
  return response.appSubscriptionCreate.confirmationUrl;
}

/**
 * Create a usage record for billing
 */
export async function createUsageRecord(
  shop: string,
  accessToken: string,
  amountCents: number,
  description: string,
  idempotencyKey: string
): Promise<void> {
  const client = createShopifyGraphQLClient(shop, accessToken);
  
  // First, get the active subscription
  const subscription = await getActiveSubscription(client);
  if (!subscription) {
    throw new Error('No active subscription found');
  }

  const lineItemId = subscription.lineItems[0]?.id;
  if (!lineItemId) {
    throw new Error('No line item found in subscription');
  }

  const mutation = `
    mutation appUsageRecordCreate($input: AppUsageRecordInput!) {
      appUsageRecordCreate(input: $input) {
        appUsageRecord {
          id
          description
          price {
            amount
            currencyCode
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const amount = (amountCents / 100).toFixed(2);
  
  const variables = {
    input: {
      subscriptionLineItemId: lineItemId,
      description,
      price: {
        amount,
        currencyCode: 'USD',
      },
      idempotencyKey,
    },
  };

  const response = await client.request(mutation, variables);
  
  if (response.appUsageRecordCreate.userErrors.length > 0) {
    throw new Error(`Failed to create usage record: ${JSON.stringify(response.appUsageRecordCreate.userErrors)}`);
  }
}

/**
 * Get the active app subscription
 */
export async function getActiveSubscription(client: GraphQLClient): Promise<AppSubscription | null> {
  const query = `
    query {
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
          lineItems {
            id
            plan {
              pricingDetails {
                ... on AppUsagePricing {
                  cappedAmount {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await client.request(query);
  const subscriptions = response.currentAppInstallation?.activeSubscriptions || [];
  
  return subscriptions.find((sub: AppSubscription) => sub.status === 'ACTIVE') || null;
}

/**
 * Update the capped amount for an existing subscription
 */
export async function updateCappedAmount(
  shop: string,
  accessToken: string,
  newCappedAmountCents: number
): Promise<string> {
  const client = createShopifyGraphQLClient(shop, accessToken);
  
  const subscription = await getActiveSubscription(client);
  if (!subscription) {
    throw new Error('No active subscription found');
  }

  const lineItemId = subscription.lineItems[0]?.id;
  if (!lineItemId) {
    throw new Error('No line item found in subscription');
  }

  const mutation = `
    mutation appSubscriptionLineItemUpdate($input: AppSubscriptionLineItemUpdateInput!) {
      appSubscriptionLineItemUpdate(input: $input) {
        appSubscription {
          id
        }
        confirmationUrl
        userErrors {
          field
          message
        }
      }
    }
  `;

  const cappedAmount = (newCappedAmountCents / 100).toFixed(2);
  
  const variables = {
    input: {
      id: lineItemId,
      cappedAmount: {
        amount: cappedAmount,
        currencyCode: 'USD',
      },
    },
  };

  const response = await client.request(mutation, variables);
  
  if (response.appSubscriptionLineItemUpdate.userErrors.length > 0) {
    throw new Error(`Failed to update capped amount: ${JSON.stringify(response.appSubscriptionLineItemUpdate.userErrors)}`);
  }

  return response.appSubscriptionLineItemUpdate.confirmationUrl;
}

/**
 * Get usage records for a date range
 */
export async function getUsageRecords(
  client: GraphQLClient,
  startDate?: Date,
  endDate?: Date
): Promise<UsageRecord[]> {
  const subscription = await getActiveSubscription(client);
  if (!subscription) {
    return [];
  }

  const lineItemId = subscription.lineItems[0]?.id;
  if (!lineItemId) {
    return [];
  }

  let dateFilter = '';
  if (startDate && endDate) {
    dateFilter = `created_at:>='${startDate.toISOString()}' AND created_at:<='${endDate.toISOString()}'`;
  }

  const query = `
    query getUsageRecords($lineItemId: ID!, $query: String) {
      appInstallation {
        launchUrl
        subscriptions: activeSubscriptions {
          lineItems {
            usageRecords(first: 50, query: $query) {
              edges {
                node {
                  id
                  description
                  price {
                    amount
                    currencyCode
                  }
                  createdAt
                }
              }
            }
          }
        }
      }
    }
  `;

  const variables = {
    lineItemId,
    query: dateFilter || undefined,
  };

  const response = await client.request(query, variables);
  const subscriptions = response.appInstallation?.subscriptions || [];
  
  const usageRecords: UsageRecord[] = [];
  
  for (const subscription of subscriptions) {
    for (const lineItem of subscription.lineItems) {
      const records = lineItem.usageRecords?.edges || [];
      usageRecords.push(...records.map((edge: any) => edge.node));
    }
  }
  
  return usageRecords;
}

/**
 * Generate idempotency key for usage records
 */
export function generateUsageIdempotencyKey(shopId: string, date: string): string {
  return `priority-usage-${shopId}-${date}`;
}

