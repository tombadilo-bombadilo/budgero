import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Card } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { CheckCircle } from 'lucide-react';
import { trackPurchase } from '@shared/lib/analytics/analytics';

export default function SubscriptionSuccess() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    // Invalidate profile query to refresh subscription status
    void queryClient.invalidateQueries({ queryKey: ['profile'] });

    // Fire Purchase event from the post-LemonSqueezy success page. We rely on
    // the localStorage payload that SubscriptionRequired writes pre-checkout
    // because the redirect strips any in-memory state.
    const raw = localStorage.getItem('budgero:last_checkout_plan');
    if (raw) {
      try {
        const data = JSON.parse(raw) as {
          plan_interval?: string;
          amount?: number;
          currency?: string;
          is_subscription?: boolean;
        };
        // Skip lifetime plans — Purchase event is subscription-only by spec.
        if (data.is_subscription !== false && typeof data.amount === 'number' && data.currency) {
          const plan = data.plan_interval === 'year' ? 'yearly' : 'monthly';
          trackPurchase({ plan, amount: data.amount, currency: data.currency });
        }
      } catch (err) {
        console.warn('Failed to send purchase event', err);
      } finally {
        localStorage.removeItem('budgero:last_checkout_plan');
      }
    }
  }, [queryClient]);

  const handleContinue = () => {
    void navigate('/', { replace: true });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <Card className="max-w-lg w-full p-8 text-center">
        <div className="flex justify-center mb-6">
          <CheckCircle className="w-16 h-16 text-green-500" />
        </div>

        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
          Welcome to Budgero!
        </h1>

        <p className="text-gray-600 dark:text-gray-300 mb-8">
          Your subscription is now active. You have full access to all features of Budgero. Start
          managing your finances with confidence!
        </p>

        <Button onClick={handleContinue} size="lg" className="w-full">
          Start Using Budgero
        </Button>

        <p className="text-sm text-gray-500 mt-4">
          You can manage your subscription anytime from your account settings.
        </p>
      </Card>
    </div>
  );
}
