import { ShieldCheck, AlertTriangle } from 'lucide-react';

interface PrivacyWarningsProps {
  /** True when the current config sends data off the local network. */
  isCloud: boolean;
}

export function PrivacyWarnings({ isCloud }: PrivacyWarningsProps) {
  if (isCloud) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-4">
        <div className="flex gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800 dark:text-amber-200">
            <p className="font-medium">Your data leaves this device</p>
            <p className="mt-1 text-amber-700 dark:text-amber-300">
              You&apos;ve configured a third-party server. Your financial data — transactions,
              payees, balances, receipt images and chat messages — will be sent to that provider,
              who can read and retain it. Only continue if you trust them and have reviewed their
              privacy policy. For full privacy, use a local server (Ollama or LM Studio) instead.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30 p-4">
      <div className="flex gap-3">
        <ShieldCheck className="h-5 w-5 text-green-600 dark:text-green-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-green-800 dark:text-green-200">
          <p className="font-medium">Privacy-First AI</p>
          <p className="mt-1 text-green-700 dark:text-green-300">
            All AI processing happens on your local network. No financial data is sent to external
            servers. You need to have Ollama or LM Studio running on your machine or local network.
          </p>
        </div>
      </div>
    </div>
  );
}
