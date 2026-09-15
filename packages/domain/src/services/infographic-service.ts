import type { InfographicAssetRepository } from '@tactia/database';
import {
  AppError,
  ErrorCode,
  createId,
  storageKey,
  type ObjectStorage,
  type RequestContext,
} from '@tactia/shared';
import { assertTenantContext } from '../authz';

export type InfographicAttachment = {
  id: string;
  type: 'infographic';
  title: string;
  mime: string;
  template: string;
  url: string;
};

export class InfographicService {
  constructor(
    private readonly assets: InfographicAssetRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async create(
    ctx: RequestContext,
    input: {
      title: string;
      template: string;
      mime: string;
      bytes: Buffer;
      width: number;
      height: number;
    },
  ): Promise<InfographicAttachment> {
    assertTenantContext(ctx);
    const id = createId();
    const key = storageKey({
      tenantId: ctx.tenantId,
      kind: 'image',
      id,
      ext: 'png',
    });

    await this.storage.put({
      key,
      body: input.bytes,
      contentType: input.mime,
    });

    const asset = await this.assets.create({
      id,
      tenantId: ctx.tenantId,
      title: input.title,
      template: input.template,
      mime: input.mime,
      storageKey: key,
      byteSize: input.bytes.byteLength,
      width: input.width,
      height: input.height,
      createdBy: ctx.userId,
    });

    return {
      id: asset.id,
      type: 'infographic',
      title: asset.title,
      mime: asset.mime,
      template: asset.template,
      url: `/api/v1/infographics/${asset.id}`,
    };
  }

  async getBytes(ctx: RequestContext, id: string): Promise<{
    body: Buffer;
    contentType: string;
    title: string;
    template: string;
  }> {
    assertTenantContext(ctx);
    const asset = await this.assets.findById({ tenantId: ctx.tenantId, id });
    if (!asset) throw new AppError(ErrorCode.NOT_FOUND, 'Infográfico não encontrado');

    const object = await this.storage.get(asset.storageKey);
    return {
      body: object.body,
      contentType: object.contentType || asset.mime,
      title: asset.title,
      template: asset.template,
    };
  }
}
