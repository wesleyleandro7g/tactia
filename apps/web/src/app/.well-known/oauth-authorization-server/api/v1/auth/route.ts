import { GET as authGet } from '@/app/api/v1/auth/[...all]/route';

// RFC 8414 inserts the issuer path after the well-known prefix. Route the
// resulting URL through the same Better Auth handler as the issuer-local URL.
export function GET(request: Request) {
  return authGet(request);
}
