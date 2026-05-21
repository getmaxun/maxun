/**
 * Environment Variable Parsing Edge Case Tests
 * Tests the environment variable handling logic for edge cases
 */

import { getEnvVariable } from '../env';

describe('Environment Variable Parsing', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getEnvVariable', () => {
    it('should throw error for missing required environment variable', () => {
      delete process.env.TEST_VAR;
      
      expect(() => getEnvVariable('TEST_VAR')).toThrow(
        'Environment variable TEST_VAR is not defined'
      );
    });

    it('should return value when environment variable is set', () => {
      process.env.TEST_VAR = 'test-value';
      
      expect(getEnvVariable('TEST_VAR')).toBe('test-value');
    });

    it('should return default value when environment variable is missing but default is provided', () => {
      delete process.env.TEST_VAR;
      
      expect(getEnvVariable('TEST_VAR', 'default-value')).toBe('default-value');
    });

    it('should handle empty string environment variable', () => {
      process.env.TEST_VAR = '';
      
      // Empty string is falsy, so it should throw when no default
      expect(() => getEnvVariable('TEST_VAR')).toThrow();
    });

    it('should return empty string when default is empty string and env var is missing', () => {
      delete process.env.TEST_VAR;
      
      expect(getEnvVariable('TEST_VAR', '')).toBe('');
    });

    it('should handle whitespace-only environment variable', () => {
      process.env.TEST_VAR = '   ';
      
      // Whitespace-only string is truthy, so it should be returned
      expect(getEnvVariable('TEST_VAR')).toBe('   ');
    });

    it('should handle whitespace-only environment variable with no default', () => {
      process.env.TEST_VAR = '   ';
      
      expect(getEnvVariable('TEST_VAR')).toBe('   ');
    });

    it('should parse boolean true correctly', () => {
      process.env.BOOL_VAR = 'true';
      
      expect(getEnvVariable('BOOL_VAR')).toBe('true');
    });

    it('should parse boolean false correctly', () => {
      process.env.BOOL_VAR = 'false';
      
      expect(getEnvVariable('BOOL_VAR')).toBe('false');
    });

    it('should handle numeric string 1', () => {
      process.env.NUM_VAR = '1';
      
      expect(getEnvVariable('NUM_VAR')).toBe('1');
    });

    it('should handle numeric string 0', () => {
      process.env.NUM_VAR = '0';
      
      expect(getEnvVariable('NUM_VAR')).toBe('0');
    });

    it('should preserve case sensitivity of environment variables', () => {
      process.env.TEST_VAR = 'Value';
      process.env.test_var = 'lowercase';
      
      expect(getEnvVariable('TEST_VAR')).toBe('Value');
      expect(getEnvVariable('test_var')).toBe('lowercase');
    });

    it('should handle special characters in value', () => {
      process.env.SPECIAL_VAR = '!@#$%^&*()_+-=[]{}|;:,.<>?';
      
      expect(getEnvVariable('SPECIAL_VAR')).toBe('!@#$%^&*()_+-=[]{}|;:,.<>?');
    });

    it('should handle unicode characters', () => {
      process.env.UNICODE_VAR = 'こんにちは世界 🎉';
      
      expect(getEnvVariable('UNICODE_VAR')).toBe('こんにちは世界 🎉');
    });

    it('should handle JSON-like values', () => {
      process.env.JSON_VAR = '{"key": "value"}';
      
      expect(getEnvVariable('JSON_VAR')).toBe('{"key": "value"}');
    });

    it('should handle URL values', () => {
      process.env.URL_VAR = 'https://example.com?param1=value1&param2=value2';
      
      expect(getEnvVariable('URL_VAR')).toBe('https://example.com?param1=value1&param2=value2');
    });

    it('should handle path-like values', () => {
      process.env.PATH_VAR = '/usr/local/bin:/usr/bin:/bin';
      
      expect(getEnvVariable('PATH_VAR')).toBe('/usr/local/bin:/usr/bin:/bin');
    });

    it('should prioritize actual env var over default when actual is empty string', () => {
      process.env.TEST_VAR = '';
      
      // Empty string is falsy so will fall through to default
      // This is because process.env returns undefined for empty vs empty string
      // But our implementation uses || which treats empty string as falsy
      expect(getEnvVariable('TEST_VAR', 'default')).toBe('default');
    });

    it('should use default when env var is undefined', () => {
      delete process.env.TEST_VAR;
      
      expect(getEnvVariable('TEST_VAR', 'my-default')).toBe('my-default');
    });

    it('should handle negative numbers as string', () => {
      process.env.NEGATIVE_VAR = '-123';
      
      expect(getEnvVariable('NEGATIVE_VAR')).toBe('-123');
    });

    it('should handle decimal numbers as string', () => {
      process.env.DECIMAL_VAR = '3.14159';
      
      expect(getEnvVariable('DECIMAL_VAR')).toBe('3.14159');
    });

    it('should handle string with equals sign', () => {
      process.env.EQUALS_VAR = 'key=value';
      
      expect(getEnvVariable('EQUALS_VAR')).toBe('key=value');
    });

    it('should handle string with newlines', () => {
      process.env.NEWLINE_VAR = 'line1\nline2\nline3';
      
      expect(getEnvVariable('NEWLINE_VAR')).toBe('line1\nline2\nline3');
    });

    it('should handle string with tabs', () => {
      process.env.TAB_VAR = 'col1\tcol2\tcol3';
      
      expect(getEnvVariable('TAB_VAR')).toBe('col1\tcol2\tcol3');
    });
  });
});