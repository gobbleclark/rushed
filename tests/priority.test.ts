import { describe, it, expect, beforeEach } from 'vitest';
import { isPriorityOrder, validatePriorityOrderData, formatDateForStorage } from '~/services/priority';

describe('Priority Service', () => {
  describe('isPriorityOrder', () => {
    it('should return true when order contains priority handling product', () => {
      const order = {
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
      
      expect(isPriorityOrder(order)).toBe(true);
    });
    
    it('should return false when order does not contain priority handling product', () => {
      const order = {
        lineItems: {
          edges: [
            {
              node: {
                variant: {
                  product: {
                    handle: 'regular-product',
                    tags: ['regular'],
                  },
                },
              },
            },
          ],
        },
      };
      
      expect(isPriorityOrder(order)).toBe(false);
    });
    
    it('should return false when order has no line items', () => {
      const order = {
        lineItems: {
          edges: [],
        },
      };
      
      expect(isPriorityOrder(order)).toBe(false);
    });
  });
  
  describe('validatePriorityOrderData', () => {
    it('should return true for valid priority order data', () => {
      const data = {
        shopId: 'test-shop',
        orderGid: 'gid://shopify/Order/123',
        orderNumber: '#1001',
        shopDomain: 'test-shop.myshopify.com',
        slaHours: 2,
      };
      
      expect(validatePriorityOrderData(data)).toBe(true);
    });
    
    it('should return false for incomplete priority order data', () => {
      const data = {
        shopId: 'test-shop',
        orderGid: 'gid://shopify/Order/123',
        // Missing required fields
      };
      
      expect(validatePriorityOrderData(data)).toBe(false);
    });
  });
  
  describe('formatDateForStorage', () => {
    it('should format date as YYYYMMDD', () => {
      const date = new Date('2024-01-15T12:00:00Z');
      expect(formatDateForStorage(date)).toBe('20240115');
    });
    
    it('should handle different dates correctly', () => {
      const date = new Date('2023-12-31T23:59:59Z');
      expect(formatDateForStorage(date)).toBe('20231231');
    });
  });
});

