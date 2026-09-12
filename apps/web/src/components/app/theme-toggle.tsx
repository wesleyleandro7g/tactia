'use client';

import { useSyncExternalStore } from 'react';
import { Check, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const THEMES = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
  { value: 'system', label: 'Sistema' },
] as const;

const emptySubscribe = () => () => undefined;

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);

  const current = theme ?? 'system';
  const isDark = mounted && resolvedTheme === 'dark';
  const currentLabel = THEMES.find((item) => item.value === current)?.label ?? current;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={mounted ? `Tema: ${currentLabel}` : 'Alternar tema'}
          />
        }
      >
        {isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        {THEMES.map((item) => {
          const active = current === item.value;
          return (
            <DropdownMenuItem
              key={item.value}
              onClick={() => setTheme(item.value)}
              className={cn('flex items-center justify-between gap-2', active && 'text-primary')}
            >
              {item.label}
              {active ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
