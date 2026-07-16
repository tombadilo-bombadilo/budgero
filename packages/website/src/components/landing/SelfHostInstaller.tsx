'use client';

import { useState } from 'react';
import { Check, Copy, ChevronDown } from 'lucide-react';
import { track } from '@/lib/analytics';

type InstallMethod = 'unix' | 'windows' | 'docker';

const installCommands: Record<InstallMethod, string> = {
  unix: 'curl -fsSL https://budgero.app/install.sh | bash',
  windows: 'irm https://budgero.app/install.ps1 | iex',
  docker: 'docker run -d -p 3001:3001 -v budgero_data:/data budgero/budgero',
};

const methodLabels: Record<InstallMethod, string> = {
  unix: 'Unix (macOS/Linux)',
  windows: 'Windows',
  docker: 'Docker',
};

function SyntaxHighlightedCommand({ method }: { method: InstallMethod }) {
  if (method === 'unix') {
    return (
      <>
        <span className="text-blue-600 dark:text-[#60A5FA]">curl</span>
        <span className="text-gray-500 dark:text-[#9A9A9A]"> -fsSL </span>
        <span className="text-gray-800 dark:text-[#E8E8E8]">https://budgero.app/install.sh</span>
        <span className="text-gray-500 dark:text-[#9A9A9A]"> | </span>
        <span className="text-blue-600 dark:text-[#60A5FA]">bash</span>
      </>
    );
  }

  if (method === 'windows') {
    return (
      <>
        <span className="text-blue-600 dark:text-[#6B9FD4]">irm</span>
        <span className="text-gray-800 dark:text-[#E8E8E8]"> https://budgero.app/install.ps1</span>
        <span className="text-gray-500 dark:text-[#9A9A9A]"> | </span>
        <span className="text-blue-600 dark:text-[#6B9FD4]">iex</span>
      </>
    );
  }

  // Docker
  return (
    <>
      <span className="text-teal-600 dark:text-[#5CB3B3]">docker</span>
      <span className="text-gray-500 dark:text-[#9A9A9A]"> run -d -p </span>
      <span className="text-orange-600 dark:text-[#CC7A5E]">3001:3001</span>
      <span className="text-gray-500 dark:text-[#9A9A9A]"> -v </span>
      <span className="text-green-600 dark:text-[#8BC070]">budgero_data:/data</span>
      <span className="text-gray-800 dark:text-[#E8E8E8]"> budgero/budgero</span>
    </>
  );
}

export default function SelfHostInstaller() {
  const [selectedMethod, setSelectedMethod] = useState<InstallMethod>('unix');
  const [copied, setCopied] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(installCommands[selectedMethod]);
    setCopied(true);
    if (typeof window !== 'undefined') {
      track('Self-Host - Install Command Copied', { method: selectedMethod });
    }
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full max-w-3xl mx-auto px-4 sm:px-0">
      {/* Main install row */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-0">
        {/* Dropdown Button - matches Claude Code style */}
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center justify-center gap-2 w-full sm:w-auto h-[46px] px-5 bg-white dark:bg-[#F7F5F0] hover:bg-gray-50 dark:hover:bg-[#EFECE5] rounded-full sm:rounded-l-full sm:rounded-r-none border border-gray-200 dark:border-[#E5E2DB] font-medium text-gray-900 dark:text-[#1A1A1A] transition-colors shadow-sm"
          >
            <span className="text-[15px]">{methodLabels[selectedMethod]}</span>
            <ChevronDown
              className={`w-4 h-4 text-gray-500 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {dropdownOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
              <div className="absolute top-full left-0 right-0 sm:right-auto mt-2 sm:w-52 bg-white border border-gray-200 rounded-xl shadow-xl z-20 overflow-hidden py-1">
                {(Object.keys(installCommands) as InstallMethod[]).map((method) => (
                  <button
                    key={method}
                    onClick={() => {
                      setSelectedMethod(method);
                      setDropdownOpen(false);
                    }}
                    className={`w-full px-4 py-2.5 text-left text-sm flex items-center justify-between hover:bg-gray-50 transition-colors ${
                      selectedMethod === method ? 'bg-gray-50' : ''
                    }`}
                  >
                    <span
                      className={`${selectedMethod === method ? 'font-medium' : ''} text-gray-900`}
                    >
                      {methodLabels[method]}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Command Box */}
        <div className="flex items-center min-h-[46px] bg-gray-100 dark:bg-[#1A1A1A] border border-gray-300 dark:border-[#3A3A3A] rounded-full sm:rounded-l-none sm:rounded-r-full px-4 sm:pl-5 sm:pr-2 py-2 sm:py-0">
          <code className="font-mono text-[13px] sm:text-[14px] pr-2 break-all sm:whitespace-nowrap tracking-tight flex-1">
            <SyntaxHighlightedCommand method={selectedMethod} />
          </code>

          {/* Copy Button */}
          <button
            onClick={handleCopy}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-white/10 rounded transition-colors"
            title="Copy to clipboard"
          >
            {copied ? (
              <Check className="w-4 h-4 text-green-500 dark:text-green-400" />
            ) : (
              <Copy className="w-4 h-4 text-gray-400 dark:text-[#7A7A7A]" />
            )}
          </button>
        </div>
      </div>

      {/* Help text */}
      <p className="mt-6 text-sm text-gray-500">
        {selectedMethod === 'docker' ? (
          <>
            Access Budgero at <code className="font-mono text-gray-600">http://localhost:3001</code>
          </>
        ) : (
          <>
            Then run <code className="font-mono text-gray-600">budgero serve</code> to start the
            server.
          </>
        )}
      </p>
    </div>
  );
}
