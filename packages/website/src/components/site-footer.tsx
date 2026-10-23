import { EmailLink } from '@/components/email-link';
import Image from 'next/image';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { TrackedLink } from '@/components/TrackedLink';

export async function SiteFooter() {
  const locale = await getLocale();
  const copy = await getTranslations('updates');
  const t = await getTranslations('common');
  return (
    <footer className="bg-[#f5f0e3] border-t border-[#9e9e9e]/70 text-[#141414] py-16">
      <div className="container mx-auto px-4">
        <div className="grid md:grid-cols-4 gap-12">
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <Image
                src="/favicon.png"
                alt={copy('u_f2d99ab2c739')}
                width={32}
                height={32}
                className="w-8 h-8"
              />
              <span className="text-xl font-bold tracking-tight">{copy('u_045497ff4fcf')}</span>
            </div>
            <p className="text-[#404040] text-sm leading-relaxed max-w-xs">{t('footer_tagline')}</p>
          </div>
          <div>
            <h3 className="font-medium text-[#141414] mb-6">{t('footer_product')}</h3>
            <ul className="space-y-3 text-sm text-[#4b5563]">
              <li>
                <Link href="/#features" className="hover:text-[#141414] transition-colors">
                  {t('footer_features')}
                </Link>
              </li>
              <li>
                <Link href="/#pricing" className="hover:text-[#141414] transition-colors">
                  {t('footer_pricing')}
                </Link>
              </li>
              <li>
                <Link href="/#security" className="hover:text-[#141414] transition-colors">
                  {t('footer_security')}
                </Link>
              </li>
              <li>
                <Link href="/vs-ynab" className="hover:text-[#141414] transition-colors">
                  {' '}
                  {copy('u_ada0cbd08be4')}{' '}
                </Link>
              </li>
              <li>
                <Link
                  href="/best-ynab-alternatives"
                  className="hover:text-[#141414] transition-colors"
                >
                  {t('footer_best_alternatives')}
                </Link>
              </li>
              {locale === 'en' && (
                <li>
                  <Link
                    href="/actual-budget-alternative"
                    className="hover:text-[#141414] transition-colors"
                  >
                    Actual Budget alternative
                  </Link>
                </li>
              )}
              <li>
                <Link
                  href="/monarch-money-alternative"
                  className="hover:text-[#141414] transition-colors"
                >
                  {t('footer_monarch_alt')}
                </Link>
              </li>
              <li>
                <TrackedLink
                  href="/self-hostable"
                  event="Self-Host Link - Footer"
                  className="hover:text-[#141414] transition-colors"
                >
                  {t('footer_self_hostable')}
                </TrackedLink>
              </li>
              <li>
                <Link href="/blog" className="hover:text-[#141414] transition-colors">
                  {t('nav_blog')}
                </Link>
              </li>
              <li>
                <a href="https://my.budgero.app" className="hover:text-[#141414] transition-colors">
                  {t('footer_try_now')}
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium text-[#141414] mb-6">{t('footer_support')}</h3>
            <ul className="space-y-3 text-sm text-[#4b5563]">
              <li>
                <Link href="/docs" className="hover:text-[#141414] transition-colors">
                  {t('nav_docs')}
                </Link>
              </li>
              <li>
                <TrackedLink
                  href="/docs/self-hosting-guide"
                  event="Self-Host Setup Guide - Footer"
                  className="hover:text-[#141414] transition-colors"
                >
                  {' '}
                  {copy('u_65858866917e')}{' '}
                </TrackedLink>
              </li>
              <li>
                <a
                  href="https://feedback.budgero.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[#141414] transition-colors"
                >
                  {t('feedback')}
                </a>
              </li>
              <li>
                <Link href="/privacy" className="hover:text-[#141414] transition-colors">
                  {t('footer_privacy')}
                </Link>
              </li>
              <li>
                <EmailLink
                  email="hello@budgero.app"
                  className="hover:text-[#141414] transition-colors"
                  label={copy('u_98b67063cf8e')}
                />
              </li>
              <li>
                <a
                  href="https://status.budgero.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[#141414] transition-colors"
                >
                  {t('footer_status')}
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium text-[#141414] mb-6">{t('footer_community')}</h3>
            <ul className="space-y-3 text-sm text-[#4b5563]">
              <li>
                <TrackedLink
                  href="/donate"
                  event="Donate Link - Footer"
                  className="hover:text-[#141414] transition-colors"
                >
                  {' '}
                  {copy('u_39013cf1b1ca')}{' '}
                </TrackedLink>
              </li>
              <li>
                <a
                  href="https://discord.gg/ZgWnzaPqae"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[#141414] transition-colors inline-flex items-center gap-2"
                >
                  <Image
                    src="/Discord-Symbol-Blurple.svg"
                    alt={copy('u_053bc65874ad')}
                    width={16}
                    height={16}
                  />{' '}
                  {copy('u_053bc65874ad')}{' '}
                </a>
              </li>
              <li>
                <a
                  href="https://www.reddit.com/r/budgero/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[#141414] transition-colors inline-flex items-center gap-2"
                >
                  <Image
                    src="/Reddit_Logo.webp"
                    alt={copy('u_eb0050f72303')}
                    width={16}
                    height={16}
                  />{' '}
                  {copy('u_eb0050f72303')}{' '}
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/tombadilo-bombadilo/budgero"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[#141414] transition-colors inline-flex items-center gap-2"
                >
                  <svg
                    viewBox="0 0 16 16"
                    width={16}
                    height={16}
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                  </svg>{' '}
                  {copy('u_f911e414cf6b')}{' '}
                </a>
              </li>
              <li>
                <Link href="/changelog" className="hover:text-[#141414] transition-colors">
                  {t('nav_changelog')}
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-[#9e9e9e]/70 mt-16 pt-8 text-center text-sm text-[#6b7280]">
          <p>{t('footer_copyright', { year: new Date().getFullYear() })}</p>
        </div>
      </div>
    </footer>
  );
}
