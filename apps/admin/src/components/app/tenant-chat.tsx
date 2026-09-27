'use client';

import { useMemo } from 'react';
import { Alert, ChatPanel, operatorTenantChatEndpoints } from '@tactia/chat/ui';

/**
 * Ephemeral test chat of an operator on a tenant. Same UI and stack as the
 * client web chat; the history lives only in this page.
 */
export function TenantChat({
  tenantId,
  tenantName,
  llmConfigured,
}: {
  tenantId: string;
  tenantName: string;
  llmConfigured: boolean;
}) {
  const endpoints = useMemo(() => operatorTenantChatEndpoints(tenantId), [tenantId]);

  return (
    <ChatPanel
      mode="ephemeral"
      endpoints={endpoints}
      llmConfigured={llmConfigured}
      canApprove
      canControl
      emptyTitle="Testar o assistente"
      emptyDescription={`Converse com a Tactia usando os dados de ${tenantName}, exatamente como o cliente vê no app.`}
      placeholder={`Pergunte sobre ${tenantName}…`}
      notice={
        <Alert tone="warning" title="Sessão de teste">
          A conversa não é salva e some ao recarregar a página. Aprovações, fatos anotados, infográficos
          e tarefas do Browser Agent são reais neste tenant e ficam registrados no audit log em seu nome.
        </Alert>
      }
    />
  );
}
