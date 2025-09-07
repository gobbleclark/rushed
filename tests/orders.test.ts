import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { processOrdersPaidWebhook, validateOrderWebhookPayload } from '../app/services/orders';
import { isPriorityOrder, isEventProcessed, markEventAsProcessed } from '../app/services/priority';

// Mock dependencies
vi.mock('@prisma/client');
vi.mock('../app/services/shopify');
vi.mock('../app/services/priority');

const mockPrisma = {
  shop: {
    findUnique: vi.fn(),
  },
  processedEvent: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
} as any;

const mockShopifyClient = {
  request: vi.fn(),
};

vi.mock('graphql-request', () => ({
  GraphQLClient: vi.fn(() => mockShopifyClient),
}));

// Mock the shopify service
vi.mock('../app/services/shopify', () => ({
  createShopifyGraphQLClient: vi.fn(() => mockShopifyClient),
  getOrder: vi.fn(),
}));

// Mock the priority service
const mockIsEventProcessed = vi.mocked(isEventProcessed);
const mockMarkEventAsProcessed = vi.mocked(markEventAsProcessed);
const mockIsPriorityOrder = vi.mocked(isPriorityOrder);

describe('Order Processing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateOrderWebhookPayload', () => {
    it('should validate correct payload', () => {
      const validPayload = {
        id: 12345,
        admin_graphql_api_id: 'gid://shopify/Order/12345',
        name: '#1001',
        order_number: 1001,
        line_items: [
          {
            id: 1,
            variant_id: 123,
            title: 'Test Product',
            quantity: 1,
            product_id: 456,
          },
        ],
        customer: {
          id: 789,
          email: 'test@example.com',
          first_name: 'John',
          last_name: 'Doe',
        },
        total_price: '10.00',
        currency: 'USD',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      expect(validateOrderWebhookPayload(validPayload)).toBe(true);
    });

    it('should reject invalid payloads', () => {
      // Missing required fields
      expect(validateOrderWebhookPayload({})).toBe(false);
      expect(validateOrderWebhookPayload(null)).toBe(false);
      expect(validateOrderWebhookPayload(undefined)).toBe(false);

      // Invalid field types
      const invalidPayload = {
        id: 'not-a-number',
        admin_graphql_api_id: 123,
        name: null,
        order_number: 'not-a-number',
        line_items: 'not-an-array',
        customer: null,
        total_price: 123,
      };

      expect(validateOrderWebhookPayload(invalidPayload)).toBe(false);
    });
  });

  describe('processOrdersPaidWebhook', () => {
    const mockShop = {
      id: 'shop123',
      domain: 'test-shop.myshopify.com',
      accessToken: 'access_token',
      slaHours: 2,
    };

    const mockOrderPayload = {
      id: 12345,
      admin_graphql_api_id: 'gid://shopify/Order/12345',
      name: '#1001',
      order_number: 1001,
      line_items: [],
      customer: {
        id: 789,
        email: 'test@example.com',
        first_name: 'John',
        last_name: 'Doe',
      },
      total_price: '10.00',
      currency: 'USD',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };

    const mockOrder = {
      id: 'gid://shopify/Order/12345',
      name: '#1001',
      tags: [],
      lineItems: {
        edges: [
          {
            node: {
              variant: {
                product: {
                  handle: 'priority-handling',
                  tags: ['priority_handling_fee'],
                },
              },
            },
          },
        ],
      },
    };

    beforeEach(() => {
      mockPrisma.shop.findUnique.mockResolvedValue(mockShop);
      mockIsEventProcessed.mockResolvedValue(false);
      mockMarkEventAsProcessed.mockResolvedValue(undefined);
    });

    it('should process priority order successfully', async () => {
      const { getOrder } = await import('../app/services/shopify');
      const { processPriorityOrder } = await import('../app/services/priority');
      
      vi.mocked(getOrder).mockResolvedValue(mockOrder);
      mockIsPriorityOrder.mockReturnValue(true);
      vi.mocked(processPriorityOrder).mockResolvedValue(undefined);

      await processOrdersPaidWebhook(
        mockPrisma,
        'test-shop.myshopify.com',
        mockOrderPayload
      );

      expect(mockIsEventProcessed).toHaveBeenCalledWith(
        mockPrisma,
        'shop123',
        'orders/paid',
        'gid://shopify/Order/12345'
      );
      
      expect(processPriorityOrder).toHaveBeenCalledWith(
        mockPrisma,
        'test-shop.myshopify.com',
        'access_token',
        {
          shopId: 'shop123',
          orderGid: 'gid://shopify/Order/12345',
          orderNumber: '#1001',
          shopDomain: 'test-shop.myshopify.com',
          slaHours: 2,
        }
      );

      expect(mockMarkEventAsProcessed).toHaveBeenCalledWith(
        mockPrisma,
        'shop123',
        'orders/paid',
        'gid://shopify/Order/12345'
      );
    });

    it('should skip non-priority orders', async () => {
      const { getOrder } = await import('../app/services/shopify');
      const { processPriorityOrder } = await import('../app/services/priority');
      
      vi.mocked(getOrder).mockResolvedValue(mockOrder);
      mockIsPriorityOrder.mockReturnValue(false);
      vi.mocked(processPriorityOrder).mockResolvedValue(undefined);

      await processOrdersPaidWebhook(
        mockPrisma,
        'test-shop.myshopify.com',
        mockOrderPayload
      );

      expect(processPriorityOrder).not.toHaveBeenCalled();
      expect(mockMarkEventAsProcessed).toHaveBeenCalled();
    });

    it('should skip already processed events', async () => {
      mockIsEventProcessed.mockResolvedValue(true);

      await processOrdersPaidWebhook(
        mockPrisma,
        'test-shop.myshopify.com',
        mockOrderPayload
      );

      const { getOrder } = await import('../app/services/shopify');
      expect(vi.mocked(getOrder)).not.toHaveBeenCalled();
      expect(mockMarkEventAsProcessed).not.toHaveBeenCalled();
    });

    it('should handle shop not found', async () => {
      mockPrisma.shop.findUnique.mockResolvedValue(null);

      await processOrdersPaidWebhook(
        mockPrisma,
        'nonexistent-shop.myshopify.com',
        mockOrderPayload
      );

      // Should return early without processing
      expect(mockIsEventProcessed).not.toHaveBeenCalled();
    });

    it('should handle Shopify API errors', async () => {
      const { getOrder } = await import('../app/services/shopify');
      vi.mocked(getOrder).mockRejectedValue(new Error('Shopify API error'));

      await expect(
        processOrdersPaidWebhook(
          mockPrisma,
          'test-shop.myshopify.com',
          mockOrderPayload
        )
      ).rejects.toThrow('Shopify API error');

      expect(mockMarkEventAsProcessed).not.toHaveBeenCalled();
    });

    it('should handle order not found in Shopify', async () => {
      const { getOrder } = await import('../app/services/shopify');
      vi.mocked(getOrder).mockResolvedValue(null);

      await processOrdersPaidWebhook(
        mockPrisma,
        'test-shop.myshopify.com',
        mockOrderPayload
      );

      // Should return early without processing
      expect(mockIsPriorityOrder).not.toHaveBeenCalled();
      expect(mockMarkEventAsProcessed).not.toHaveBeenCalled();
    });
  });
});
