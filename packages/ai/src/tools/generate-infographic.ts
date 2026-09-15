import { defineTool } from '../tool-registry';
import { renderInfographic } from '../infographics/render';
import { infographicSpecSchema } from '../infographics/schema';
import type { ChatAttachment, Tool, ToolContext } from '../types';

/**
 * Port implemented at the app layer: persists the PNG and returns a durable
 * attachment reference for chat UI + WhatsApp delivery.
 */
export type InfographicStore = {
  save(
    ctx: ToolContext,
    input: {
      title: string;
      template: string;
      mime: string;
      bytes: Buffer;
      width: number;
      height: number;
    },
  ): Promise<ChatAttachment>;
};

/**
 * generate_infographic — renders a branded PNG from structured data.
 * Call only when the user asks for a visual or the answer benefits from one.
 */
export function createGenerateInfographicTool(store: InfographicStore): Tool {
  return defineTool({
    name: 'generate_infographic',
    description:
      'Gera um infográfico PNG com a marca Tactia. Templates: kpi_snapshot (1–4 KPIs com label/value/delta), ' +
      'comparison (left/right + metricLabel), ranking (items top N), insight_card (highlight + bullets). ' +
      'Use SOMENTE quando o usuário pedir imagem/infográfico/visual OU quando a resposta tiver ' +
      '3+ números/comparações que ganham clareza em um quadro. NÃO use em respostas curtas de 1 número. ' +
      'Os valores devem vir de ferramentas anteriores — nunca invente. Após gerar, mencione o visual na resposta.',
    inputSchema: infographicSpecSchema,
    async execute(ctx, input) {
      const rendered = await renderInfographic(input);

      const attachment = await store.save(ctx, {
        title: rendered.title,
        template: rendered.template,
        mime: rendered.mime,
        bytes: rendered.png,
        width: rendered.width,
        height: rendered.height,
      });

      return {
        data: {
          attachmentId: attachment.id,
          title: attachment.title,
          template: attachment.template,
          url: attachment.url,
          message:
            'Infográfico gerado. Ele será anexado à mensagem. Mencione o visual na resposta, ' +
            'sem inventar números além dos já obtidos nas ferramentas.',
        },
        sources: [],
        attachment,
      };
    },
  });
}
