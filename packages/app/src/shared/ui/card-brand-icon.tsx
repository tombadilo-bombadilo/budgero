import { useEffect, useState } from 'react';

interface CardBrandIconProps {
  brand: string;
  className?: string;
}

export function CardBrandIcon({ brand, className = 'h-6 w-10' }: CardBrandIconProps) {
  const [PaymentIconComponent, setPaymentIconComponent] = useState<
    (typeof import('react-svg-credit-card-payment-icons'))['PaymentIcon'] | null
  >(null);

  useEffect(() => {
    let mounted = true;
    void import('react-svg-credit-card-payment-icons')
      .then((module) => {
        if (mounted) {
          setPaymentIconComponent(() => module.PaymentIcon);
        }
      })
      .catch((error) => {
        console.error('[CardBrandIcon] Failed to load payment icon library', error);
        if (mounted) {
          setPaymentIconComponent(null);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const normalizedBrand = brand.toLowerCase().trim();

  // Map brand names to the library's type format
  const brandMap: Record<string, string> = {
    visa: 'visa',
    mastercard: 'mastercard',
    master: 'mastercard',
    amex: 'amex',
    'american express': 'amex',
    american_express: 'amex',
    discover: 'discover',
    diners: 'diners',
    'diners club': 'diners',
    jcb: 'jcb',
    unionpay: 'unionpay',
    'union pay': 'unionpay',
    maestro: 'maestro',
    elo: 'elo',
    hiper: 'hiper',
    hipercard: 'hipercard',
    mir: 'mir',
  };

  const cardType = brandMap[normalizedBrand] || 'generic';

  // Extract width from className if present, default to 40
  const widthMatch = className.match(/w-(\d+)/);
  const width = widthMatch ? parseInt(widthMatch[1]) * 4 : 40; // Tailwind uses 4px per unit

  if (!PaymentIconComponent) {
    const fallbackLabel = normalizedBrand.slice(0, 2).toUpperCase() || '??';
    const fallbackClasses = [
      'flex items-center justify-center rounded bg-muted text-xs font-medium text-muted-foreground uppercase',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return <div className={fallbackClasses}>{fallbackLabel}</div>;
  }

  return (
    <div className={className}>
      <PaymentIconComponent type={cardType as never} format="flatRounded" width={width} />
    </div>
  );
}
