import React from 'react';
import { Button } from '@shared/ui/button';
import { Plus } from 'lucide-react';

interface RuleEditorSectionProps {
  title: string;
  description: string;
  addLabel: string;
  onAdd: () => void;
  children: React.ReactNode;
}

export function RuleEditorSection({
  title,
  description,
  addLabel,
  onAdd,
  children,
}: RuleEditorSectionProps) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={onAdd}>
          <Plus className="mr-2 h-4 w-4" />
          {addLabel}
        </Button>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
