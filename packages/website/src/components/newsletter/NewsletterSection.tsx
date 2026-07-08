'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowRight, Mail, CheckCircle, Shield } from 'lucide-react';
import { handleNewsletterSignup } from '@/lib/newsletter';

export function NewsletterSection() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!email) {
      setError('Please enter your email address');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const result = await handleNewsletterSignup(email);
      if (result.success) {
        setIsSuccess(true);
        setEmail('');
      } else {
        setError(result.message || 'Something went wrong. Please try again.');
      }
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section id="newsletter" className="relative py-32 overflow-hidden -mt-16 pt-48">
      <div className="absolute -inset-y-16 inset-x-0 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 opacity-95 gradient-ultra-smooth"></div>
      <div className="absolute top-10 left-10 w-96 h-96 bg-white/10 rounded-full blur-3xl"></div>
      <div className="absolute bottom-10 right-10 w-96 h-96 bg-gray-400/15 rounded-full blur-3xl"></div>
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-gray-500/10 rounded-full blur-3xl"></div>
      <div className="container mx-auto px-4 relative z-10 text-center text-white">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-white/20 backdrop-blur-sm rounded-2xl mb-8 shadow-2xl">
            <Mail className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-5xl md:text-6xl lg:text-7xl font-black mb-8 leading-tight text-white">
            Ready to Take Control of{' '}
            <span className="relative inline-block">
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-gray-100 via-gray-200 to-gray-300 animate-gradient bg-[length:200%_200%]">
                Your Finances?
              </span>
              <div className="absolute -bottom-4 left-0 right-0 h-2 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-400 rounded-full blur-sm opacity-70"></div>
            </span>
          </h2>
          <p className="text-2xl md:text-3xl mb-12 opacity-90 max-w-4xl mx-auto leading-relaxed font-medium">
            Join the waitlist and get an exclusive 15% discount code when Budgero launches.
            <span className="block mt-4 text-gray-200 font-semibold">
              Your financial freedom starts here.
            </span>
          </p>
          {isSuccess ? (
            <div className="max-w-md mx-auto">
              <div className="bg-white/15 backdrop-blur-sm rounded-2xl p-8 border border-white/25 shadow-lg">
                <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8 text-gray-200" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-2">Welcome to the Waitlist!</h3>
                <p className="text-white/80 text-lg">
                  We&apos;ll email you when Budgero launches with your exclusive 15% discount.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="max-w-lg mx-auto mb-12">
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-6 h-6" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter your email address"
                      required
                      className="w-full pl-12 pr-4 py-4 text-lg border-0 rounded-2xl bg-white/90 dark:bg-white/95 text-gray-900 placeholder-gray-500 focus:ring-4 focus:ring-white/30 focus:outline-none transition-all shadow-2xl"
                    />
                  </div>
                  {error && (
                    <div className="p-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white text-sm">
                      {error}
                    </div>
                  )}
                  <div className="flex items-center justify-center space-x-6 text-white/80 text-sm">
                    <div className="flex items-center">
                      <Shield className="w-4 h-4 mr-2" />
                      No spam, ever
                    </div>
                    <div className="flex items-center">
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Unsubscribe anytime
                    </div>
                  </div>
                </form>
              </div>
              <div className="flex justify-center mb-12 px-4">
                <Button
                  onClick={handleSubmit}
                  disabled={isLoading}
                  className="text-sm md:text-base lg:text-xl px-4 md:px-8 lg:px-16 py-3 md:py-4 lg:py-8 font-bold bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 shadow-4xl hover:shadow-5xl transition-all duration-300 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <div className="flex items-center justify-center">
                      <div className="w-4 h-4 md:w-5 md:h-5 lg:w-6 lg:h-6 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                      <span>Joining...</span>
                    </div>
                  ) : (
                    <>
                      Join the Waitlist
                      <ArrowRight className="ml-2 w-4 h-4 md:w-5 md:h-5 lg:w-6 lg:h-6" />
                    </>
                  )}
                </Button>
              </div>
              <div className="flex justify-center">
                <div className="bg-white/15 backdrop-blur-sm rounded-xl px-6 py-3 border border-white/25 shadow-lg">
                  <div className="text-sm font-medium text-white/90">
                    Join now and get 15% off at launch
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
