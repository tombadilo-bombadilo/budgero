import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';

export function ManualRatePrompt({
  from,
  to,
  onConfirm,
  onCancel,
}: {
  from: string;
  to: string;
  onConfirm: (rate: number, from: string, to: string) => void;
  onCancel: () => void;
}) {
  const [base, setBase] = useState(from);
  const [quote, setQuote] = useState(to);
  const [rateText, setRateText] = useState<string>('');

  const swap = () => {
    setBase(quote);
    setQuote(base);
    const val = parseFloat(rateText);
    if (!isNaN(val) && val > 0) setRateText((1 / val).toString());
  };

  const submit = () => {
    const val = parseFloat(rateText);
    if (!isNaN(val) && val > 0) onConfirm(val, base, quote);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Enter Exchange Rate</CardTitle>
          <CardDescription>
            No cached rate found. Provide a temporary rate for offline use.
          </CardDescription>
        </CardHeader>
        <div className="px-6 pb-2">
          <div className="text-sm mb-2">
            {base} → {quote}
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              placeholder="e.g. 1.5"
              value={rateText}
              onChange={(e) => setRateText(e.target.value)}
            />
            <Button variant="outline" onClick={swap}>
              Swap
            </Button>
          </div>
        </div>
        <CardFooter className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={submit}>Save</Button>
        </CardFooter>
      </Card>
    </div>
  );
}
