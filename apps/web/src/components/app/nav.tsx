'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/cn';

export type NavItem = { href: string; label: string };

/** Marca o item ativo com aria-current e destaca visualmente. */
export function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'block rounded-lg px-3 py-2 text-sm transition-colors',
                active ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-card hover:text-fg',
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    router.push('/login');
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      className="rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-card hover:text-fg"
    >
      Sair
    </button>
  );
}
