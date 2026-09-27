import { notFound } from 'next/navigation';
import { SMTP_PROVIDER_IDS, getSmtpProviderPreset } from '@tactia/execution';
import { ErrorCode, isAppError } from '@tactia/shared';
import { EmailSettings, type EmailProviderOption } from '@/components/app/email-settings';
import { TabSection } from '@/components/app/tab-section';
import { getTenantEmailConfig } from '@/lib/tenant-email';
import { loadOperator } from '@/lib/tenant-loaders';

export const metadata = { title: 'Email · Empresa · Tactia Ops' };

const PROVIDERS: EmailProviderOption[] = SMTP_PROVIDER_IDS.map((id) => {
  const preset = getSmtpProviderPreset(id);
  return {
    id: preset.id,
    label: preset.label,
    requiresHost: preset.id === 'custom',
    ...(preset.hint ? { hint: preset.hint } : {}),
  };
});

export default async function TenantEmailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await loadOperator(id);

  let config: Awaited<ReturnType<typeof getTenantEmailConfig>>;
  try {
    config = await getTenantEmailConfig(ctx, id);
  } catch (error) {
    if (isAppError(error) && error.code === ErrorCode.NOT_FOUND) notFound();
    throw error;
  }

  return (
    <TabSection title="Email">
      <p className="text-sm text-muted-foreground">
        Configure a caixa de e-mail (SMTP) usada pela Tactia para enviar mensagens em nome desta
        empresa. Suporta Gmail, Outlook, Microsoft 365, Yahoo, Zoho e qualquer servidor SMTP.
      </p>
      <EmailSettings
        apiBasePath={`/api/v1/tenants/${id}/email`}
        providers={PROVIDERS}
        config={{
          configured: config.configured,
          hasPassword: config.hasPassword,
          ...(config.provider ? { provider: config.provider } : {}),
          ...(config.fromName ? { fromName: config.fromName } : {}),
          ...(config.fromEmail ? { fromEmail: config.fromEmail } : {}),
          ...(config.username ? { username: config.username } : {}),
          ...(config.host ? { host: config.host } : {}),
          ...(config.port !== undefined ? { port: config.port } : {}),
          ...(config.secure !== undefined ? { secure: config.secure } : {}),
          ...(config.updatedAt ? { updatedAt: config.updatedAt } : {}),
        }}
      />
    </TabSection>
  );
}
