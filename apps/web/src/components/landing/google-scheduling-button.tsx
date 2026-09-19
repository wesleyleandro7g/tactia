'use client';

import Script from 'next/script';
import { useRef, useState } from 'react';
import { CONSULTATION_CALENDAR_URL } from '@tactia/shared/acquisition';

type SchedulingWindow = Window & {
  calendar?: {
    schedulingButton: {
      load: (options: { url: string; color: string; label: string; target: HTMLElement }) => void;
    };
  };
};

export function GoogleSchedulingButton() {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  function initialize() {
    const host = container.current;
    const schedulingButton = (window as SchedulingWindow).calendar?.schedulingButton;
    if (!host || host.childElementCount) return;
    if (!schedulingButton) {
      setStatus('error');
      return;
    }
    // Google inserts its button next to the target. Keep both inside a DOM
    // container owned by the widget, so React can safely unmount the whole thing.
    const target = document.createElement('span');
    host.appendChild(target);
    try {
      schedulingButton.load({
        url: CONSULTATION_CALENDAR_URL,
        color: '#039BE5',
        label: 'Agendar um compromisso',
        target,
      });
      setStatus('ready');
    } catch {
      host.replaceChildren();
      setStatus('error');
    }
  }

  return (
    <div className="space-y-3">
      <link
        href="https://calendar.google.com/calendar/scheduling-button-script.css"
        rel="stylesheet"
        precedence="google-calendar"
      />
      <div
        ref={container}
        className="min-h-12 [&_button]:max-w-full [&_button]:whitespace-normal"
      />
      {status !== 'ready' && (
        <p role="status" className="text-sm text-muted-foreground">
          {status === 'loading'
            ? 'Carregando o botão de agendamento…'
            : 'Não foi possível carregar o botão. Você pode abrir a agenda pelo link abaixo.'}
        </p>
      )}
      <Script
        src="https://calendar.google.com/calendar/scheduling-button-script.js"
        strategy="afterInteractive"
        onReady={initialize}
        onError={() => setStatus('error')}
      />
    </div>
  );
}
