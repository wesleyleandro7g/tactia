import { describe, expect, it } from 'vitest';
import { demoInfographicSpec, renderInfographic } from '@tactia/ai/infographics';

describe('admin infographic preview render', () => {
  it('renders PNG using package font resolution from admin cwd', async () => {
    const result = await renderInfographic(demoInfographicSpec('ranking', 'dark'));
    expect(result.png.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
    expect(result.png.byteLength).toBeGreaterThan(5000);
  }, 20000);
});
