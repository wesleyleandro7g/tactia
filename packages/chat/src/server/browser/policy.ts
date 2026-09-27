import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';

export type BrowserStepPolicyInput = {
  type:
    | 'click'
    | 'fill'
    | 'press'
    | 'wait'
    | 'scroll'
    | 'select'
    | 'check'
    | 'hover'
    | 'download'
    | 'navigate'
    | 'extract'
    | 'screenshot';
  category: 'READ' | 'WRITE' | 'FINANCIAL' | 'DESTRUCTIVE' | 'EXTERNAL_COMMUNICATION';
  credentialField?: string;
};

/**
 * Members, admins and owners control Browser Agent tasks. A backoffice operator
 * acting on the tenant (admin test chat: `operatorId` set, `userId` null)
 * counts as a principal too.
 */
export function requireBrowserTaskMember(
  ctx: RequestContext,
): asserts ctx is RequestContext & { tenantId: string } {
  const principal = ctx.userId ?? ctx.operatorId;
  if (!ctx.tenantId || !principal || !ctx.role || ctx.role === 'viewer') {
    throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'Browser tasks require a tenant member');
  }
}

/** Browser tasks run autonomously; the user can observe and stop them at any time. */
export function browserStepNeedsApproval(step: BrowserStepPolicyInput): boolean {
  void step;
  return false;
}
