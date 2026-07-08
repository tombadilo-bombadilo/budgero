import { useState, useEffect } from 'react';
import { Card, CardContent } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { betaApi } from '@shared/api/api-client';
import { Info, Mail, CheckCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface EarlyAccessBannerProps {
  message?: string;
}

export function EarlyAccessBanner({ message }: EarlyAccessBannerProps) {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);

  const defaultMessage =
    "We're currently in invite-only early access. Subscribe to our mailing list to get 15% off when we launch!";
  const displayMessage = message || defaultMessage;

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setIsLoading(true);
    try {
      const result = await betaApi.subscribeNewsletter(email);
      if (result.success) {
        setIsSubscribed(true);
        toast.success('Success!', {
          description: "You're on the list! Check your email for confirmation.",
        });
        localStorage.setItem('newsletter_subscribed', 'true');
      } else {
        toast.error('Error', {
          description: result.message || 'Failed to subscribe. Please try again.',
        });
      }
    } catch {
      toast.error('Error', {
        description: 'Failed to subscribe. Please try again later.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const subscribed = localStorage.getItem('newsletter_subscribed');
    if (subscribed === 'true') {
      setIsSubscribed(true);
    }
  }, []);

  return (
    <Card className="bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border-indigo-200 dark:border-indigo-800">
      <CardContent className="p-4 md:p-6">
        <div className="flex items-start gap-2 md:gap-3">
          <Info className="w-4 h-4 md:w-5 md:h-5 text-indigo-600 dark:text-indigo-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 space-y-3 md:space-y-4">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white mb-1 text-sm md:text-base">
                Early Access Mode
              </h3>
              <p className="text-xs md:text-sm text-gray-600 dark:text-gray-300">
                {displayMessage}
              </p>
            </div>

            {!isSubscribed ? (
              <form onSubmit={handleSubscribe} className="flex flex-col sm:flex-row gap-2">
                <Input
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={isLoading}
                  className="flex-1 sm:max-w-xs text-sm md:text-base"
                />
                <Button type="submit" disabled={isLoading} className="w-full sm:w-auto">
                  {isLoading ? (
                    <>
                      <Loader2 className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2 animate-spin" />
                      <span className="text-sm md:text-base">Subscribing...</span>
                    </>
                  ) : (
                    <>
                      <Mail className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                      <span className="text-sm md:text-base">Get 15% Off</span>
                    </>
                  )}
                </Button>
              </form>
            ) : (
              <Alert className="bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
                <CheckCircle className="w-3 h-3 md:w-4 md:h-4 text-green-600 dark:text-green-400" />
                <AlertDescription className="text-xs md:text-sm text-green-800 dark:text-green-300">
                  You're on the list! We'll notify you when we launch with your exclusive discount.
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
