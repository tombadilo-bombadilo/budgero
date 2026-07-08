import type { ReactNode } from 'react';

interface SettingsPageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Optional slot rendered inline after the title (badge, actions). */
  children?: ReactNode;
}

/** Standard settings-page header: page title plus a muted description. */
export function SettingsPageHeader({ title, description, children }: SettingsPageHeaderProps) {
  const heading = <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{title}</h1>;

  return (
    <div className="space-y-2">
      {children ? (
        <div className="flex items-center gap-2">
          {heading}
          {children}
        </div>
      ) : (
        heading
      )}
      {description ? (
        <p className="text-sm sm:text-base text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
