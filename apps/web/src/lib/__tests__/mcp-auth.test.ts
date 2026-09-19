import { describe, expect, it } from 'vitest';
import { isChatGptClientMetadataUrl, parseOAuthScopes } from '../mcp-auth';

describe('MCP OAuth helpers', () => {
  it('allows only the ChatGPT HTTPS client metadata documents', () => {
    expect(isChatGptClientMetadataUrl('https://chatgpt.com/oauth/client.json')).toBe(true);
    expect(isChatGptClientMetadataUrl('https://chatgpt.com/oauth/connector_123/client.json')).toBe(true);
    expect(isChatGptClientMetadataUrl('http://chatgpt.com/oauth/client.json')).toBe(false);
    expect(isChatGptClientMetadataUrl('https://evil.example/oauth/client.json')).toBe(false);
    expect(isChatGptClientMetadataUrl('https://chatgpt.com.evil.example/oauth/client.json')).toBe(false);
    expect(isChatGptClientMetadataUrl('https://chatgpt.com:8443/oauth/client.json')).toBe(false);
    expect(isChatGptClientMetadataUrl('https://user@chatgpt.com/oauth/client.json')).toBe(false);
    expect(isChatGptClientMetadataUrl('https://chatgpt.com/oauth/client.json?redirect=evil')).toBe(false);
  });

  it('normalizes OAuth scope claims', () => {
    expect(parseOAuthScopes('tools:read  tools:propose')).toEqual([
      'tools:read',
      'tools:propose',
    ]);
    expect(parseOAuthScopes(['tools:read', 7, 'tools:propose'])).toEqual([
      'tools:read',
      'tools:propose',
    ]);
  });
});
