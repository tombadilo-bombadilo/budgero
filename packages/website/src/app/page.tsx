export const dynamic = 'force-static';
export const revalidate = false;
import type { Metadata } from 'next';
import LandingPage from '@/components/landing/LandingPage';
import { pricing } from '@/lib/pricing';

export const metadata: Metadata = {
  title: 'Budgero: Private Budgeting Without Bank Connections',
  description:
    'Manual-first budgeting with rule-based automation. Start a 35-day Cloud trial with encrypted sync, or self-host Budgero for free.',
  alternates: { canonical: 'https://budgero.app/' },
  openGraph: {
    title: 'Budgero: Private Budgeting Without Bank Connections',
    description:
      'Manual-first budgeting with rule-based automation. Start a 35-day Cloud trial with encrypted sync, or self-host Budgero for free.',
    url: 'https://budgero.app/',
    // OG image is auto-emitted by /src/app/opengraph-image.tsx (1200x630 PNG).
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Budgero: Private Budgeting Without Bank Connections',
    description:
      'Manual-first budgeting with rule-based automation. Start a 35-day Cloud trial with encrypted sync, or self-host Budgero for free.',
    // Twitter image is auto-emitted by the same file convention.
  },
};

const faqs = [
  {
    question: 'How is my data kept private?',
    answer:
      'Your data is encrypted with your password using AES-256 encryption before it ever leaves your device. We use zero-knowledge architecture, meaning we literally cannot decrypt or view your financial information - only you can.',
  },
  {
    question: "What's the difference between Budgero Cloud and Self-Host?",
    answer:
      'Budgero Cloud is fully managed by us and includes encrypted sync, collaboration, and automatic updates. Self-Host gives you the same core feature set on your own infrastructure, so you manage hosting, backups, and operations yourself.',
  },
  {
    question: 'Does Budgero automatically connect to my bank?',
    answer:
      "No, and that's by design. To protect your privacy, we will never ask for your bank credentials. This approach, combined with our end-to-end encryption, ensures your data remains yours alone. For convenience, you can easily import transactions via a CSV file from your bank.",
  },
  {
    question: 'Can I import from YNAB or other apps?',
    answer:
      'Absolutely! We support direct YNAB imports and CSV files from most banking apps and budgeting tools. The import process takes just a few minutes and preserves your categories, transactions, and account structure.',
  },
  {
    question: 'Does it work offline?',
    answer:
      "Yes, completely! You can add transactions, update budgets, and review your finances without any internet connection. All changes sync automatically when you're back online.",
  },
  {
    question: 'What happens if Budgero shuts down?',
    answer:
      "We're committed to open-sourcing the code if we ever shut down. Plus, you can export all your data anytime in standard formats, so you're never locked in.",
  },
  {
    question: 'Can I export my data?',
    answer:
      'Yes. You can download a full SQLite backup or CSV bundle from Data Management. You retain complete ownership of your budgets.',
  },
  {
    question: 'Do paid plans include a free trial?',
    answer:
      'Yes. Every paid plan comes with a 35-day free trial — no credit card required. Try the full app with encrypted sync and collaboration. When your trial ends, subscribe to keep using the app.',
  },
  {
    question: 'Can I earn a discount on my annual plan?',
    answer:
      "Yes — three tiers tied to real budgeting habits, not gamification badges. Foundation (10% off) rewards logging transactions on 7 of your first 10 days. Discipline (20% off) requires reconciling an account and funding a goal. Persistence (35% off) requires budgeting across two calendar months. All discounts apply to the annual plan for two full years, and codes stay valid for 7 days after your trial ends.",
  },
  {
    question: 'What devices does it work on?',
    answer:
      'Budgero works on all devices — iPhone, Android, Windows, Mac, and Linux. The web app is fully responsive and optimized for a great experience across platforms.',
  },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareApplication',
      image: 'https://budgero.app/logo_512.png',
      '@id': 'https://budgero.app/#software',
      name: 'Budgero',
      applicationCategory: 'FinanceApplication',
      operatingSystem: ['Web', 'Windows', 'macOS', 'Linux', 'Android', 'iOS'],
      url: 'https://budgero.app/',
      description:
        'Stop living paycheck to paycheck. The zero-based budgeting app with zero-knowledge encryption. Start with managed Cloud or self-host for free.',
      offers: [
        {
          '@type': 'Offer',
          '@id': 'https://budgero.app/#offer-self-host',
          name: 'Budgero Self-Host',
          price: '0',
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock',
        },
        {
          '@type': 'Offer',
          '@id': 'https://budgero.app/#offer-cloud-monthly',
          name: 'Budgero Cloud (monthly)',
          price: pricing.monthly.replace(/[^0-9.]/g, ''),
          priceCurrency: 'USD',
          description: 'Monthly Cloud plan with encrypted sync',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: pricing.monthly.replace(/[^0-9.]/g, ''),
            priceCurrency: 'USD',
            unitText: 'per month',
          },
          availability: 'https://schema.org/InStock',
        },
        {
          '@type': 'Offer',
          '@id': 'https://budgero.app/#offer-cloud-yearly',
          name: 'Budgero Cloud (yearly)',
          price: pricing.yearly.replace(/[^0-9.]/g, ''),
          priceCurrency: 'USD',
          description: 'Yearly Cloud plan with encrypted sync',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: pricing.yearly.replace(/[^0-9.]/g, ''),
            priceCurrency: 'USD',
            unitText: 'per year',
          },
          availability: 'https://schema.org/InStock',
        },
      ],
    },
    {
      '@type': 'FAQPage',
      '@id': 'https://budgero.app/#faqs',
      mainEntity: faqs.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: faq.answer,
        },
      })),
    },
  ],
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <LandingPage />
    </>
  );
}
