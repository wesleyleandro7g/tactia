import { describe, expect, it } from 'vitest';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import {
  browserStepNeedsApproval,
  requireBrowserTaskMember,
  type BrowserStepPolicyInput,
} from '../server/browser/policy';
import { safeProgressUrl, toPublicBrowserTask } from '../server/browser/task-view';
import { browserRuntimeErrorCode } from '../server/browser/runtime-client';
import { browserInitialToolChoice } from '../server/browser/tool-routing';
import {
  BrowserRepeatGuard,
  browserStepResultMessages,
  browserStepKey,
  browserStepValidationError,
  credentialFillKey,
} from '../server/browser/agent-progress';

function step(input: Partial<BrowserStepPolicyInput> = {}): BrowserStepPolicyInput {
  return { type: 'extract', category: 'READ', ...input };
}

function context(input: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: 'request-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'member',
    ...input,
  };
}

describe('browser automation approval policy', () => {
  it('runs every browser action autonomously regardless of risk category', () => {
    for (const type of ['click', 'fill', 'press', 'select', 'check', 'navigate', 'download'] as const) {
      for (const category of ['READ', 'WRITE', 'FINANCIAL', 'DESTRUCTIVE', 'EXTERNAL_COMMUNICATION'] as const) {
        expect(browserStepNeedsApproval(step({ type, category })), `${type}:${category}`).toBe(false);
      }
    }
  });
});

describe('browser task authorization', () => {
  it('allows authenticated tenant members and administrators', () => {
    expect(() => requireBrowserTaskMember(context({ role: 'member' }))).not.toThrow();
    expect(() => requireBrowserTaskMember(context({ role: 'admin' }))).not.toThrow();
    expect(() => requireBrowserTaskMember(context({ role: 'owner' }))).not.toThrow();
  });

  it('allows a backoffice operator acting on the tenant (admin test chat)', () => {
    expect(() =>
      requireBrowserTaskMember(context({ userId: null, operatorId: 'op-1', role: 'owner' })),
    ).not.toThrow();
  });

  it.each([
    context({ tenantId: null }),
    context({ userId: null }),
    context({ role: null }),
    context({ role: 'viewer' }),
  ])('rejects callers that cannot start browser tasks', (ctx) => {
    try {
      requireBrowserTaskMember(ctx);
      throw new Error('authorization should have failed');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCode.AUTHORIZATION_ERROR);
    }
  });
});

describe('browser task response', () => {
  it('uses the safeError contract consumed by the chat card', () => {
    const task = toPublicBrowserTask({
      id: 'task-1',
      profileId: 'profile-1',
      objective: 'Gerar relatório',
      status: 'FAILED',
      stepCount: 2,
      result: null,
      safeError: 'Sessão expirada.',
      createdAt: new Date('2026-09-25T12:00:00.000Z'),
      finishedAt: new Date('2026-09-25T12:01:00.000Z'),
      artifacts: [
        {
          id: 'artifact-1',
          filename: 'failure.png',
          mimeType: 'image/png',
          type: 'SCREENSHOT',
          byteSize: 42,
        },
      ],
      actionLogs: [
        {
          id: 'log-1',
          actionType: 'navigate',
          status: 'SUCCEEDED',
          errorCode: null,
          urlAfter: 'https://app.example.com/usuarios',
          createdAt: new Date('2026-09-25T12:00:30.000Z'),
        },
      ],
    });

    expect(task.safeError).toBe('Sessão expirada.');
    expect(task).not.toHaveProperty('error');
    expect(task.artifacts[0]?.url).toBe('/api/v1/browser/artifacts/artifact-1');
    expect(task.progress).toEqual([
      expect.objectContaining({ id: 'log-1', actionType: 'navigate', status: 'SUCCEEDED' }),
    ]);
  });

  it('returns chronological, sanitized progress capped at 50 actions', () => {
    const base = new Date('2026-09-26T13:00:00.000Z').getTime();
    const logs = Array.from({ length: 55 }, (_, index) => ({
      id: `log-${index}`,
      actionType: index % 2 ? 'click' : 'fill',
      status: 'SUCCEEDED',
      errorCode: null,
      urlAfter: 'https://app.example.com/login?token=super-secret#/usuarios?session=abc',
      createdAt: new Date(base + index * 1000),
    })).reverse();

    const task = toPublicBrowserTask({
      id: 'task-1',
      profileId: 'profile-1',
      objective: 'Listar usuários',
      status: 'RUNNING',
      stepCount: 55,
      result: null,
      safeError: null,
      createdAt: new Date(base),
      finishedAt: null,
      artifacts: [],
      actionLogs: logs,
    });

    expect(task.progress).toHaveLength(50);
    expect(task.progress[0]?.id).toBe('log-5');
    expect(task.progress.at(-1)?.id).toBe('log-54');
    expect(task.progress[0]).toEqual({
      id: 'log-5',
      actionType: 'click',
      label: 'Clicou em um elemento',
      status: 'SUCCEEDED',
      errorCode: null,
      url: 'https://app.example.com/login#/usuarios',
      createdAt: expect.any(Date),
    });
    const serialized = JSON.stringify(task);
    expect(serialized).not.toContain('super-secret');
    expect(serialized).not.toContain('session=abc');
    expect(task).not.toHaveProperty('approval');
    expect(task).not.toHaveProperty('approvalExecutionId');
  });

  it('flags tasks still parked by the legacy approval flow', () => {
    const task = toPublicBrowserTask({
      id: 'task-1',
      profileId: 'profile-1',
      objective: 'Entrar no ERP',
      status: 'WAITING_APPROVAL',
      stepCount: 2,
      result: null,
      safeError: null,
      createdAt: new Date('2026-09-26T12:00:00.000Z'),
      finishedAt: null,
      artifacts: [],
    });
    expect(task.legacyApproval).toBe(true);
    expect(task.progress).toEqual([]);
  });
});

describe('safe progress url', () => {
  it.each([
    ['https://app.torge.com.br/#/usuarios', 'https://app.torge.com.br/#/usuarios'],
    ['https://app.example.com/cb?code=abc', 'https://app.example.com/cb'],
    ['https://app.example.com/#access_token=abc', 'https://app.example.com/'],
    ['not a url', null],
    [null, null],
  ])('%s -> %s', (raw, expected) => {
    expect(safeProgressUrl(raw)).toBe(expected);
  });
});

describe('browser runtime error contract', () => {
  it('exposes authentication failures instead of masking them as a generic runtime error', () => {
    expect(browserRuntimeErrorCode(401, '{"detail":"Unauthorized"}')).toBe(
      'BROWSER_RUNTIME_UNAUTHORIZED',
    );
    expect(browserRuntimeErrorCode(403, 'Forbidden')).toBe('BROWSER_RUNTIME_UNAUTHORIZED');
  });

  it('preserves known runtime errors and classifies unavailable gateways', () => {
    expect(browserRuntimeErrorCode(400, '{"detail":"NETWORK_BLOCKED"}')).toBe(
      'NETWORK_BLOCKED',
    );
    expect(browserRuntimeErrorCode(503, 'Service Unavailable')).toBe(
      'BROWSER_RUNTIME_UNAVAILABLE',
    );
  });
});

describe('browser tool routing', () => {
  const tools = ['get_revenue', 'list_browser_profiles', 'browser_delegate'];

  it.each([
    'Acesse o sistema Torge e verifique a empresa autenticada',
    'Entre no ERP e gere o relatório de ontem',
    'Abra https://railway.com/pricing e consulte o plano Pro',
    'Navegue até o portal cadastrado',
    'Verifique no portal qual empresa está autenticada',
    'Busque no sistema o pedido mais recente',
  ])('forces autonomous profile discovery for: %s', (question) => {
    expect(browserInitialToolChoice(question, tools)).toEqual({
      type: 'tool',
      toolName: 'list_browser_profiles',
    });
  });

  it('does not hijack ordinary analytical questions', () => {
    expect(browserInitialToolChoice('Consulte o faturamento deste mês', tools)).toBeUndefined();
  });

  it('does not force a tool hidden from the caller role', () => {
    expect(browserInitialToolChoice('Acesse o sistema Torge', ['get_revenue'])).toBeUndefined();
  });
});

describe('browser agent progress', () => {
  const usernameFill = {
    type: 'fill',
    target: '@e184',
    credentialField: 'username',
    category: 'READ',
    reason: 'Preencher usuário',
  };

  it('identifies the same credential fill independently of the risk label', () => {
    expect(credentialFillKey(usernameFill)).toBe('@e184:username');
    expect(credentialFillKey({ ...usernameFill, category: 'WRITE' })).toBe(
      '@e184:username',
    );
    expect(credentialFillKey({ ...usernameFill, type: 'click' })).toBeNull();
  });

  it('returns a structured, secret-free tool result that tells the model to move on', () => {
    const messages = browserStepResultMessages({
      call: { id: 'call-1', name: 'browser_step', input: usernameFill },
      step: { ...usernameFill, value: 'must-not-leak' },
      label: 'textbox text',
      status: 'SUCCEEDED',
      urlBefore: 'https://app.example.com/login',
      urlAfter: 'https://app.example.com/login',
    });

    expect(messages[0]).toMatchObject({
      role: 'assistant',
      toolCalls: [{ id: 'call-1', name: 'browser_step' }],
    });
    expect(messages[1]).toMatchObject({
      role: 'tool',
      toolCallId: 'call-1',
      output: {
        status: 'SUCCEEDED',
        credentialField: 'username',
      },
    });
    expect(JSON.stringify(messages)).not.toContain('must-not-leak');
    expect(JSON.stringify(messages)).toContain('Não repita');
  });

  it('rejects element actions without a current target before reaching the runtime', () => {
    expect(browserStepValidationError({ ...usernameFill, target: undefined })).toContain(
      'exige a referência target',
    );
    expect(
      browserStepValidationError({
        type: 'navigate',
        url: 'https://app.example.com',
        category: 'READ',
        reason: 'Abrir sistema',
      }),
    ).toBeNull();
  });

  it('detects consecutive repeated element actions while allowing waits and scrolls', () => {
    expect(browserStepKey(usernameFill)).toBe(browserStepKey({ ...usernameFill, category: 'WRITE' }));
    expect(
      browserStepKey({
        type: 'click',
        target: '@e1033',
        category: 'READ',
        reason: 'Abrir usuários',
      }),
    ).toContain('@e1033');
    expect(browserStepKey({ type: 'wait', category: 'READ', reason: 'Aguardar' })).toBeNull();
  });
});

describe('browser repeat guard', () => {
  const genericClick = {
    type: 'click',
    target: '@e1033',
    category: 'READ',
    reason: 'Abrir usuários',
  };

  it('never lets the same click reach the runtime twice in a row (Torge @e1033 case)', () => {
    const guard = new BrowserRepeatGuard(3);
    expect(guard.check(genericClick)).toBe('EXECUTE');
    guard.recordSuccess(genericClick);

    // Different category/reason must not mask the repetition.
    expect(guard.check({ ...genericClick, category: 'WRITE', reason: 'Tentar de novo' })).toBe(
      'SKIP',
    );
    expect(guard.check(genericClick)).toBe('SKIP');
    expect(guard.check(genericClick)).toBe('ABORT');
    expect(guard.blockedTotal).toBe(3);
  });

  it('resets the counter once a different action progresses', () => {
    const guard = new BrowserRepeatGuard(3);
    guard.recordSuccess(genericClick);
    expect(guard.check(genericClick)).toBe('SKIP');

    const navigate = {
      type: 'navigate',
      url: 'https://app.torge.com.br/#/usuarios',
      category: 'READ',
      reason: 'Ir direto',
    };
    expect(guard.check(navigate)).toBe('EXECUTE');
    guard.recordSuccess(navigate);
    expect(guard.repeatedCount).toBe(0);
    expect(guard.check(genericClick)).toBe('EXECUTE');
  });

  it('allows repeated waits and scrolls without hiding a repeated click behind them', () => {
    const guard = new BrowserRepeatGuard(3);
    const wait = { type: 'wait', category: 'READ', reason: 'Aguardar' };
    const scroll = { type: 'scroll', category: 'READ', reason: 'Rolar' };
    guard.recordSuccess(genericClick);
    for (let i = 0; i < 5; i++) {
      expect(guard.check(wait)).toBe('EXECUTE');
      guard.recordSuccess(wait);
      expect(guard.check(scroll)).toBe('EXECUTE');
      guard.recordSuccess(scroll);
    }
    expect(guard.check(genericClick)).toBe('SKIP');
  });

  it('treats different typed values as different actions but ignores vault values', () => {
    const guard = new BrowserRepeatGuard(3);
    const search = { type: 'fill', target: '@e5', value: 'ana', category: 'READ', reason: 'Buscar' };
    guard.recordSuccess(search);
    expect(guard.check({ ...search, value: 'bruno' })).toBe('EXECUTE');
    expect(guard.check(search)).toBe('SKIP');
  });
});


describe('strict browser step validation', () => {
  it('requires bounded seconds for waits', () => {
    expect(browserStepValidationError({ type: 'wait', seconds: 1, category: 'READ', reason: 'Aguardar SPA' })).toBeNull();
    expect(browserStepValidationError({ type: 'wait', category: 'READ', reason: 'Aguardar' })).toContain('seconds');
    expect(browserStepValidationError({ type: 'wait', seconds: 11, category: 'READ', reason: 'Aguardar' })).toContain('seconds');
  });

  it('requires a key for press and a single fill source', () => {
    expect(browserStepValidationError({ type: 'press', category: 'READ', reason: 'Enviar' })).toContain('value');
    expect(browserStepValidationError({
      type: 'fill', target: '@e1', value: 'x', credentialField: 'username', category: 'READ', reason: 'Preencher',
    })).toContain('nunca ambos');
  });
});


describe('browser task chat response', () => {
  it('returns a structured assistant message linked to the task', () => {
    const task = toPublicBrowserTask({
      id: 'task-result-1',
      profileId: 'profile-1',
      objective: 'Liste as abas principais',
      status: 'COMPLETED',
      stepCount: 2,
      result: { summary: 'As abas são Início, Clientes e Usuários.' },
      resultMessage: { id: 'message-1', content: '## Resultado do Browser Agent\n\nResposta persistida', metadata: {} },
      safeError: null,
      createdAt: new Date(),
      finishedAt: new Date(),
      artifacts: [],
    });

    expect(task.chatResponse).toEqual({
      id: 'message-1',
      role: 'assistant',
      content: '## Resultado do Browser Agent\n\nResposta persistida',
      browserResultTaskId: 'task-result-1',
      toolsUsed: ['browser_agent'],
    });
  });
});
