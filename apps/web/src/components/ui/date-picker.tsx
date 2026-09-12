'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

type DatePickerProps = {
  id: string;
  name: string;
  value?: Date;
  onChange?: (date: Date | undefined) => void;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

/** Date picker (Button + Popover + Calendar) that submits `yyyy-MM-dd` via a named field. */
export function DatePicker({
  id,
  name,
  value,
  onChange,
  required,
  placeholder = 'Selecionar data',
  disabled,
  className,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [uncontrolled, setUncontrolled] = useState<Date | undefined>();
  const date = onChange ? value : uncontrolled;

  function setDate(next: Date | undefined) {
    if (onChange) onChange(next);
    else setUncontrolled(next);
  }

  return (
    <div className={cn('relative', className)}>
      <input
        type="text"
        name={name}
        value={date ? format(date, 'yyyy-MM-dd') : ''}
        required={required}
        tabIndex={-1}
        readOnly
        aria-hidden="true"
        className="pointer-events-none absolute size-px overflow-hidden opacity-0"
        onFocus={() => document.getElementById(id)?.focus()}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              type="button"
              variant="outline"
              size="md"
              disabled={disabled}
              data-empty={!date}
              aria-required={required || undefined}
              aria-haspopup="dialog"
              className="w-full justify-start text-left font-normal data-[empty=true]:text-muted-foreground"
            />
          }
        >
          <CalendarIcon data-icon="inline-start" />
          {date ? format(date, 'dd/MM/yyyy', { locale: ptBR }) : <span>{placeholder}</span>}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            locale={ptBR}
            selected={date}
            onSelect={(next) => {
              setDate(next);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
