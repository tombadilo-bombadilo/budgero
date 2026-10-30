/**
 * React error boundaries that report what they catch (error-capture.ts) and
 * keep the rest of the app alive. Before this, a render error anywhere was a
 * blank screen and reached analytics only as an anonymous window error.
 *
 * Variants:
 *  - page: full-screen fallback with Reload (the root).
 *  - section: inline card with Try again (route content inside the shell).
 *  - hidden: renders nothing and toasts once (floating widgets: chat, palette).
 */
/* eslint-disable react-refresh/only-export-components */
import { useLingui } from '@lingui/react/macro';
import React from 'react';
import { toast } from 'sonner';
import { captureAppError } from '@shared/lib/analytics/error-capture';
import { Button } from '@shared/ui/button';

type Variant = 'page' | 'section' | 'hidden';

interface Props {
  /** Reported as `component`; our own identifier, e.g. 'root', 'route', 'chat_panel'. */
  name: string;
  variant: Variant;
  /** When this changes (e.g. the route), a failed boundary resets and renders its children again. */
  resetKey?: string;
  children: React.ReactNode;
}

interface State {
  failed: boolean;
}

export class AppErrorBoundary extends React.Component<Props, State> {
  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  constructor(props: Props) {
    super(props);
    this.state = { failed: false };
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  componentDidCatch(error: unknown): void {
    captureAppError(error, {
      source: 'react',
      handled: true,
      component: this.props.name,
      code: 'render_error',
    });
  }

  private retry = (): void => this.setState({ failed: false });

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    switch (this.props.variant) {
      case 'page':
        return <PageFallback />;
      case 'section':
        return <SectionFallback onRetry={this.retry} />;
      default:
        return <HiddenFallback onRetry={this.retry} />;
    }
  }
}

function PageFallback() {
  const { t } = useLingui();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">{t`Something went wrong`}</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        {t`Budgero hit an error it could not recover from. Your data is safe on this device; reloading usually fixes it.`}
      </p>
      <Button onClick={() => window.location.reload()}>{t`Reload`}</Button>
    </div>
  );
}

function SectionFallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useLingui();
  return (
    <div className="m-6 flex flex-col items-start gap-3 rounded-lg border bg-card p-6">
      <h2 className="text-lg font-semibold">{t`This page could not be shown`}</h2>
      <p className="text-sm text-muted-foreground">
        {t`The error has been recorded. You can try again or open another page.`}
      </p>
      <Button variant="outline" onClick={onRetry}>
        {t`Try again`}
      </Button>
    </div>
  );
}

function HiddenFallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useLingui();
  React.useEffect(() => {
    toast.error(t`Part of the app stopped working`, {
      description: t`The error has been recorded. Reload the page if it keeps happening.`,
      action: { label: t`Try again`, onClick: onRetry },
    });
  }, [onRetry, t]);
  return null;
}
