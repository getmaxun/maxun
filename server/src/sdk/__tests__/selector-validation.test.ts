/**
 * Selector Validation Edge Case Tests
 * Tests the CSS selector validation logic for edge cases
 */

import { SelectorValidator } from '../selectorValidator';

// Mock Page interface for testing
const createMockPage = () => {
  const mockLocator = {
    first: () => mockLocator,
    count: jest.fn().mockResolvedValue(0),
    evaluate: jest.fn().mockResolvedValue('DIV'),
  };
  return {
    locator: jest.fn().mockReturnValue(mockLocator),
    goto: jest.fn().mockResolvedValue(undefined),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    click: jest.fn().mockResolvedValue(undefined),
    waitForSelector: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn().mockResolvedValue(undefined),
  };
};

describe('SelectorValidator', () => {
  let validator: SelectorValidator;
  let mockPage: any;

  beforeEach(() => {
    validator = new SelectorValidator();
    mockPage = createMockPage();
  });

  describe('validateSelector', () => {
    it('should return invalid for empty string selector', async () => {
      const result = await validator.validateSelector({ selector: '' });
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle very long selector strings', async () => {
      const longSelector = 'div'.repeat(10000);
      // Should not throw, should return valid or invalid gracefully
      const result = await validator.validateSelector({ selector: longSelector });
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('error');
    });

    it('should handle selectors with special characters that could break DOM', async () => {
      const specialSelectors = [
        '<script>alert(1)</script>',
        'div[data-test="<img src=x onerror=alert(1)>"]',
        'div::before{content:"x"}',
        'div[onclick="alert(1)"]',
      ];

      for (const selector of specialSelectors) {
        const result = await validator.validateSelector({ selector });
        // Should handle gracefully without throwing
        expect(result).toHaveProperty('valid');
        expect(result).toHaveProperty('error');
      }
    });

    it('should handle unicode in selectors', async () => {
      const unicodeSelectors = [
        'div[data-text="こんにちは"]',
        'div[data-text="🎉"]',
        'div[data-text="مرحبا"]',
        'div[data-text="你好"]',
        'div[data-text="💻🚀"]',
      ];

      for (const selector of unicodeSelectors) {
        const result = await validator.validateSelector({ selector });
        expect(result).toHaveProperty('valid');
        expect(result).toHaveProperty('error');
      }
    });

    it('should return error when browser is not initialized', async () => {
      const result = await validator.validateSelector({ selector: 'div' });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Browser not initialized');
    });

    it('should handle XPath selectors', async () => {
      mockPage.locator().count.mockResolvedValueOnce(1);
      mockPage.locator().evaluate.mockResolvedValueOnce('DIV');
      
      await validator.initialize(mockPage as any, 'http://example.com');
      
      const xpathSelector = '//div[@class="test"]';
      const result = await validator.validateSelector({ selector: xpathSelector });
      expect(result).toHaveProperty('valid');
    });

    it('should handle valid CSS selector without throwing', async () => {
      mockPage.locator().count.mockResolvedValueOnce(1);
      mockPage.locator().evaluate.mockResolvedValueOnce('DIV');
      
      await validator.initialize(mockPage as any, 'http://example.com');
      
      const result = await validator.validateSelector({ selector: 'div.test-class' });
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('error');
    });

    it('should handle selector with quotes properly', async () => {
      await validator.initialize(mockPage as any, 'http://example.com');
      
      const selectorWithQuotes = 'div[data-test="double\"quote"]';
      const result = await validator.validateSelector({ selector: selectorWithQuotes });
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('error');
    });

    it('should handle selector with newlines and whitespace', async () => {
      await validator.initialize(mockPage as any, 'http://example.com');
      
      const selectorWithWhitespace = 'div\n  .class\n  [data-test="value"]';
      const result = await validator.validateSelector({ selector: selectorWithWhitespace });
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('error');
    });

    it('should handle selector with ID containing special chars', async () => {
      await validator.initialize(mockPage as any, 'http://example.com');
      
      const selector = '#element-id-123';
      const result = await validator.validateSelector({ selector });
      expect(result).toHaveProperty('valid');
    });

    it('should handle multiple selectors (comma separated)', async () => {
      await validator.initialize(mockPage as any, 'http://example.com');
      
      const multiSelector = 'div, span, p';
      const result = await validator.validateSelector({ selector: multiSelector });
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('error');
    });
  });

  describe('validateSchemaFields', () => {
    it('should return invalid when browser not initialized', async () => {
      const result = await validator.validateSchemaFields({
        field1: { selector: 'div' }
      });
      expect(result.valid).toBe(false);
    });

    it('should handle empty fields object', async () => {
      await validator.initialize(mockPage as any, 'http://example.com');
      const result = await validator.validateSchemaFields({});
      expect(result.valid).toBe(true);
      expect(result.enriched).toEqual({});
    });
  });

  describe('detectInputType', () => {
    it('should throw when browser not initialized', async () => {
      await expect(validator.detectInputType('div')).rejects.toThrow('Browser not initialized');
    });

    it('should handle selector with no matches', async () => {
      mockPage.locator().count.mockResolvedValueOnce(0);
      await validator.initialize(mockPage as any, 'http://example.com');
      
      await expect(validator.detectInputType('div')).rejects.toThrow();
    });
  });
});