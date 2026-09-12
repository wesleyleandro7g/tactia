import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        },
      }
    : {}),
  redact: {
    paths: [
      'password',
      'encrypted_data',
      'encryptedData',
      'ENCRYPTION_KEY',
      'req.headers.cookie',
      'content',
      'body',
      'question',
      '*.content',
      '*.body',
      '*.question',
    ],
    censor: '[redacted]',
  },
});

export type OperationLog = {
  request_id?: string;
  tenant_id?: string | null;
  user_id?: string | null;
  operation: string;
  duration_ms: number;
  status: number | string;
  error?: string;
};
