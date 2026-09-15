import { z } from 'zod';
import {
  INFOGRAPHIC_TEMPLATES,
  demoInfographicSpec,
  renderInfographic,
  type InfographicTemplate,
} from '@tactia/ai/infographics';
import { AppError, ErrorCode } from '@tactia/shared';
import { createApiHandler, searchParamsRecord } from '@/lib/api';

export const runtime = 'nodejs';

const querySchema = z.object({
  template: z.enum(INFOGRAPHIC_TEMPLATES as [InfographicTemplate, ...InfographicTemplate[]]),
  theme: z.enum(['light', 'dark']).default('light'),
});

/**
 * GET /api/v1/infographics/preview?template=&theme=
 * Renders a demo PNG for Ops visual QA (no persistence).
 */
export const GET = createApiHandler({ auth: 'operator' }, async (request) => {
  const parsed = querySchema.safeParse(searchParamsRecord(request));
  if (!parsed.success) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `Informe template (${INFOGRAPHIC_TEMPLATES.join('|')}) e theme opcional (light|dark).`,
    );
  }

  const rendered = await renderInfographic(
    demoInfographicSpec(parsed.data.template, parsed.data.theme),
  );

  return new Response(new Uint8Array(rendered.png), {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=60',
      'Content-Disposition': `inline; filename="${parsed.data.template}-${parsed.data.theme}.png"`,
    },
  });
});
