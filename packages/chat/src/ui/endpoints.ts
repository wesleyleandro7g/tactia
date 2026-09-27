import type { EphemeralTurnInput } from '../protocol';

/**
 * HTTP surface used by ChatPanel. Each app provides its routes; the panel
 * itself never hard-codes URLs, so the same UI runs in apps/web (persistent
 * conversations) and apps/admin (ephemeral operator test chat).
 */
export type ChatEndpoints = {
  /** Persistent mode only: creates the conversation on the first question. */
  createConversation?: () => Promise<string | null>;
  /** Starts a turn; must resolve to the SSE response. */
  sendTurn: (input: {
    conversationId: string | null;
    content: string;
    history: EphemeralTurnInput['history'];
  }) => Promise<Response>;
  browserTaskUrl: (taskId: string) => string;
  cancelBrowserTaskUrl: (taskId: string) => string;
  approvalDecisionUrl: (approvalId: string, decision: 'approve' | 'reject') => string;
  /** Maps URLs produced by the domain (`/api/v1/infographics/:id`…) to the host app. */
  assetUrl: (url: string) => string;
};

function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const DOMAIN_ASSET_ROUTES: Array<{ prefix: string; target: string }> = [
  { prefix: '/api/v1/infographics/', target: 'infographics' },
  { prefix: '/api/v1/browser/artifacts/', target: 'browser/artifacts' },
];

/**
 * Rewrites the tenant-session asset URLs emitted by the domain to a base path
 * (e.g. the admin test chat routes). Unknown URLs are returned untouched.
 */
export function rewriteChatAssetUrl(url: string, basePath: string): string {
  for (const route of DOMAIN_ASSET_ROUTES) {
    if (url.startsWith(route.prefix)) {
      const id = url.slice(route.prefix.length).split(/[/?#]/)[0] ?? '';
      if (id) return `${basePath}/${route.target}/${encodeURIComponent(id)}`;
    }
  }
  return url;
}

/** apps/web: persisted conversations of the signed-in user. */
export function persistentChatEndpoints(): ChatEndpoints {
  return {
    async createConversation() {
      const response = await postJson('/api/v1/conversations', {});
      if (!response.ok) return null;
      const body = (await response.json()) as { data: { id: string } };
      return body.data.id;
    },
    sendTurn: ({ conversationId, content }) => {
      if (!conversationId) throw new Error('Não foi possível iniciar a conversa.');
      return postJson(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {
        content,
        stream: true,
      });
    },
    browserTaskUrl: (taskId) => `/api/v1/browser/tasks/${encodeURIComponent(taskId)}`,
    cancelBrowserTaskUrl: (taskId) => `/api/v1/browser/tasks/${encodeURIComponent(taskId)}/cancel`,
    approvalDecisionUrl: (approvalId, decision) =>
      `/api/v1/approvals/${encodeURIComponent(approvalId)}/${decision}`,
    assetUrl: (url) => url,
  };
}

/** apps/admin: ephemeral test chat of an operator on a tenant. */
export function operatorTenantChatEndpoints(tenantId: string): ChatEndpoints {
  const base = `/api/v1/tenants/${encodeURIComponent(tenantId)}/chat`;
  return {
    sendTurn: ({ content, history }) => postJson(base, { content, history }),
    browserTaskUrl: (taskId) => `${base}/browser/tasks/${encodeURIComponent(taskId)}`,
    cancelBrowserTaskUrl: (taskId) => `${base}/browser/tasks/${encodeURIComponent(taskId)}/cancel`,
    approvalDecisionUrl: (approvalId, decision) =>
      `${base}/approvals/${encodeURIComponent(approvalId)}/${decision}`,
    assetUrl: (url) => rewriteChatAssetUrl(url, base),
  };
}
