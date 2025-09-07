import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createUsageRecord, generateUsageIdempotencyKey } from '../app/services/billing';
import { runDailyBilling } from '../app/services/cron';

// Mock Prisma
vi.mock('@prisma/client');
vi.mock('../app/services/shopify');

const mockPrisma = {
  shop: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  dailyUsage: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  orderMarker: {
    count: vi.fn(),
  },
} as any;

// Mock GraphQL client
const mockGraphQLClient = {
  request: vi.fn(),
};

vi.mock('graphql-request', () => ({
  GraphQLClient: vi.fn(() => mockGraphQLClient),
}));

describe('Billing Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateUsageIdempotencyKey', () => {
    it('should generate consistent idempotency keys', () => {
      const shopId = 'shop123';
      const date = '20240101';
      
      const key1 = generateUsageIdempotencyKey(shopId, date);
      const key2 = generateUsageIdempotencyKey(shopId, date);
      
      expect(key1).toBe(key2);
      expect(key1).toBe('priority-usage-shop123-20240101');
    });

    it('should generate different keys for different shops', () => {
      const date = '20240101';
      
      const key1 = generateUsageIdempotencyKey('shop1', date);
      const key2 = generateUsageIdempotencyKey('shop2', date);
      
      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different dates', () => {
      const shopId = 'shop123';
      
      const key1 = generateUsageIdempotencyKey(shopId, '20240101');
      const key2 = generateUsageIdempotencyKey(shopId, '20240102');
      
      expect(key1).not.toBe(key2);
    });
  });

  describe('createUsageRecord', () => {
    it('should create usage record successfully', async () => {
      // Mock successful subscription query
      mockGraphQLClient.request.mockResolvedValueOnce({
        currentAppInstallation: {
          activeSubscriptions: [
            {
              id: 'sub123',
              status: 'ACTIVE',
              lineItems: [
                {
                  id: 'line123',
                  plan: {
                    pricingDetails: {
                      cappedAmount: {
                        amount: '500.00',
                        currencyCode: 'USD',
                      },
                    },
                  },
                },
              ],
            },
          ],
        },
      });

      // Mock successful usage record creation
      mockGraphQLClient.request.mockResolvedValueOnce({
        appUsageRecordCreate: {
          appUsageRecord: {
            id: 'usage123',
            description: 'Test usage',
            price: {
              amount: '5.00',
              currencyCode: 'USD',
            },
          },
          userErrors: [],
        },
      });

      await createUsageRecord(
        'test-shop.myshopify.com',
        'access_token',
        500, // $5.00
        'Test usage record',
        'test-idempotency-key'
      );

      expect(mockGraphQLClient.request).toHaveBeenCalledTimes(2);
    });

    it('should throw error when no active subscription found', async () => {
      mockGraphQLClient.request.mockResolvedValueOnce({
        currentAppInstallation: {
          activeSubscriptions: [],
        },
      });

      await expect(
        createUsageRecord(
          'test-shop.myshopify.com',
          'access_token',
          500,
          'Test usage record',
          'test-idempotency-key'
        )
      ).rejects.toThrow('No active subscription found');
    });

    it('should throw error when usage record creation fails', async () => {
      // Mock successful subscription query
      mockGraphQLClient.request.mockResolvedValueOnce({
        currentAppInstallation: {
          activeSubscriptions: [
            {
              id: 'sub123',
              status: 'ACTIVE',
              lineItems: [
                {
                  id: 'line123',
                  plan: {
                    pricingDetails: {
                      cappedAmount: {
                        amount: '500.00',
                        currencyCode: 'USD',
                      },
                    },
                  },
                },
              ],
            },
          ],
        },
      });

      // Mock failed usage record creation
      mockGraphQLClient.request.mockResolvedValueOnce({
        appUsageRecordCreate: {
          appUsageRecord: null,
          userErrors: [
            {
              field: 'price',
              message: 'Price is invalid',
            },
          ],
        },
      });

      await expect(
        createUsageRecord(
          'test-shop.myshopify.com',
          'access_token',
          500,
          'Test usage record',
          'test-idempotency-key'
        )
      ).rejects.toThrow('Failed to create usage record');
    });
  });
});

describe('Daily Billing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should skip billing when no priority orders', async () => {
    const mockShop = {
      id: 'shop123',
      domain: 'test-shop.myshopify.com',
      accessToken: 'access_token',
      feeCents: 500,
    };

    mockPrisma.shop.findMany.mockResolvedValue([mockShop]);
    mockPrisma.dailyUsage.findUnique.mockResolvedValue(null);
    mockPrisma.orderMarker.count.mockResolvedValue(0);
    mockPrisma.dailyUsage.create.mockResolvedValue({});

    const result = await runDailyBilling(mockPrisma);

    expect(result.status).toBe('success');
    expect(result.processedShops).toBe(1);
    expect(result.totalAmount).toBe(0);
    expect(mockPrisma.dailyUsage.create).toHaveBeenCalledWith({
      data: {
        id: expect.stringContaining('shop123_'),
        shopId: 'shop123',
        yyyymmdd: expect.any(String),
        count: 0,
        amountCents: 0,
      },
    });
  });

  it('should process billing when priority orders exist', async () => {
    const mockShop = {
      id: 'shop123',
      domain: 'test-shop.myshopify.com',
      accessToken: 'access_token',
      feeCents: 500,
    };

    mockPrisma.shop.findMany.mockResolvedValue([mockShop]);
    mockPrisma.dailyUsage.findUnique.mockResolvedValue(null);
    mockPrisma.orderMarker.count.mockResolvedValue(3); // 3 priority orders
    mockPrisma.dailyUsage.create.mockResolvedValue({});

    // Mock successful subscription and usage record creation
    mockGraphQLClient.request.mockResolvedValueOnce({
      currentAppInstallation: {
        activeSubscriptions: [
          {
            id: 'sub123',
            status: 'ACTIVE',
            lineItems: [
              {
                id: 'line123',
                plan: {
                  pricingDetails: {
                    cappedAmount: {
                      amount: '500.00',
                      currencyCode: 'USD',
                    },
                  },
                },
              },
            ],
          },
        ],
      },
    });

    mockGraphQLClient.request.mockResolvedValueOnce({
      appUsageRecordCreate: {
        appUsageRecord: {
          id: 'usage123',
          description: 'Priority Handling: 3 orders',
          price: {
            amount: '15.00',
            currencyCode: 'USD',
          },
        },
        userErrors: [],
      },
    });

    const result = await runDailyBilling(mockPrisma);

    expect(result.status).toBe('success');
    expect(result.processedShops).toBe(1);
    expect(result.totalAmount).toBe(1500); // 3 orders * 500 cents
    expect(mockPrisma.dailyUsage.create).toHaveBeenCalledWith({
      data: {
        id: expect.stringContaining('shop123_'),
        shopId: 'shop123',
        yyyymmdd: expect.any(String),
        count: 3,
        amountCents: 1500,
      },
    });
  });

  it('should skip already processed dates', async () => {
    const mockShop = {
      id: 'shop123',
      domain: 'test-shop.myshopify.com',
      accessToken: 'access_token',
      feeCents: 500,
    };

    mockPrisma.shop.findMany.mockResolvedValue([mockShop]);
    mockPrisma.dailyUsage.findUnique.mockResolvedValue({
      id: 'existing',
      shopId: 'shop123',
      yyyymmdd: '20240101',
      count: 2,
      amountCents: 1000,
    });

    const result = await runDailyBilling(mockPrisma);

    expect(result.status).toBe('success');
    expect(result.processedShops).toBe(1);
    expect(result.totalAmount).toBe(1000); // From existing record
    expect(mockPrisma.orderMarker.count).not.toHaveBeenCalled();
    expect(mockPrisma.dailyUsage.create).not.toHaveBeenCalled();
  });

  it('should handle errors gracefully', async () => {
    const mockShop = {
      id: 'shop123',
      domain: 'test-shop.myshopify.com',
      accessToken: 'access_token',
      feeCents: 500,
    };

    mockPrisma.shop.findMany.mockResolvedValue([mockShop]);
    mockPrisma.dailyUsage.findUnique.mockResolvedValue(null);
    mockPrisma.orderMarker.count.mockRejectedValue(new Error('Database error'));

    const result = await runDailyBilling(mockPrisma);

    expect(result.status).toBe('error');
    expect(result.message).toContain('Database error');
    expect(result.processedShops).toBe(0);
  });
});
