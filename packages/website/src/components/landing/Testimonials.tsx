import { Star } from 'lucide-react';
import { pricing } from '@/lib/pricing';

const testimonials = [
  {
    quote:
      'I used YNAB for years and love zero-based budgeting. Budgero nails the same methodology with a design I actually enjoy using. I keep coming back because I\'m a budget geek. The SQL Explorer is a dream if you have a technical background.',
    highlight: 'a design I actually enjoy using',
    name: 'Developer & self-described budget geek',
    detail: 'Switched from YNAB',
    initial: 'D',
    badge: 'Ex-YNAB',
  },
  {
    quote:
      'I started with YNAB and then tried a bunch of different tools over the past year. Budgero is the closest to perfect for my use case while also matching what I want visually. Transaction entry is fast, the savings goals with sub-sections are exactly what I need, and the whole experience just feels right.',
    highlight: 'the closest to perfect for my use case',
    name: 'Savings-focused budgeter',
    detail: 'Tried 5+ apps before Budgero',
    initial: 'S',
    badge: 'Ex-YNAB',
  },
  {
    quote:
      'The app is really advanced in both functionality and UI. I was impressed by how polished the whole experience feels. This is a serious budgeting tool with a design that competes with anything on the market.',
    highlight: 'really advanced in both functionality and UI',
    name: 'Personal finance enthusiast',
    detail: 'Evaluated multiple budgeting tools',
    initial: 'B',
  },
  {
    quote:
      'The latest update made a noticeable difference. Animations are smoother, everything feels faster. Nice to see a budgeting tool where the developer actually cares about performance.',
    highlight: 'animations are smoother, everything feels faster',
    name: 'Long-time Budgero user',
    detail: 'Self-hosted',
    initial: 'M',
  },
];


const trustStats = [
  { value: '168', label: 'Currencies supported' },
  { value: '100%', label: 'Zero-knowledge encrypted' },
  { value: pricing.monthly, label: '/mo for Cloud' },
  { value: '0', label: 'Third parties see your data' },
];

function Stars() {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
      ))}
    </div>
  );
}

function HighlightedQuote({ text, highlight }: { text: string; highlight: string }) {
  const idx = text.toLowerCase().indexOf(highlight.toLowerCase());
  if (idx === -1) return <p className="text-sm leading-7 text-foreground/85 flex-1">{text}</p>;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + highlight.length);
  const after = text.slice(idx + highlight.length);
  return (
    <p className="text-sm leading-7 text-foreground/85 flex-1">
      {before}
      <em className="not-italic font-medium text-foreground">{match}</em>
      {after}
    </p>
  );
}

function Card({
  item,
  className,
}: {
  item: (typeof testimonials)[number];
  className?: string;
}) {
  return (
    <div
      className={`bg-card rounded-2xl border border-border/70 p-6 sm:p-7 flex flex-col gap-4 transition-colors hover:border-border ${className ?? ''}`}
    >
      <Stars />
      <HighlightedQuote text={item.quote} highlight={item.highlight} />
      <div className="flex items-center gap-3 pt-3 border-t border-border/60">
        <div className="w-9 h-9 rounded-full bg-muted/50 flex items-center justify-center text-sm font-bold text-foreground/70 flex-shrink-0">
          {item.initial}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-semibold text-foreground">{item.name}</span>
          <span className="text-xs text-foreground/55">{item.detail}</span>
        </div>
        {item.badge && (
          <span className="ml-auto whitespace-nowrap rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            {item.badge}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Shared testimonials section. Drop into any page.
 */
export function TestimonialsSection() {
  return (
    <section className="py-16 max-w-5xl mx-auto px-4 sm:px-6">
      <div className="text-center mb-12">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-3">
          Real Users, Real Budgets
        </p>
        <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-3">
          What Budgero Users Are Saying
        </h2>
        <p className="text-foreground/60 max-w-lg mx-auto">
          People who switched from YNAB and other tools share their experience.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-5 max-w-lg md:max-w-none mx-auto">
        {testimonials.map((t) => (
          <Card key={t.initial} item={t} />
        ))}

      </div>

      <div className="flex justify-center gap-10 sm:gap-14 flex-wrap mt-10 pt-6 border-t border-border/60">
        {trustStats.map((stat) => (
          <div key={stat.label} className="text-center">
            <div className="text-2xl font-bold text-foreground">{stat.value}</div>
            <div className="text-xs text-foreground/55 mt-1">{stat.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
