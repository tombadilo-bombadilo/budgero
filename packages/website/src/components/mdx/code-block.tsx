'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

function getText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(getText).join('');
  if (React.isValidElement(node)) return getText((node.props as any)?.children);
  return '';
}

function prettyLang(lang: string) {
  const m: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TSX',
    js: 'JavaScript',
    jsx: 'JSX',
    json: 'JSON',
    css: 'CSS',
    scss: 'SCSS',
    html: 'HTML',
    bash: 'Bash',
    sh: 'Shell',
    md: 'Markdown',
  };
  return m[lang] || lang.toUpperCase();
}

export function CodeBlock(props: React.HTMLAttributes<HTMLPreElement>) {
  const childrenArray = React.Children.toArray(props.children);
  const codeEl = childrenArray.find(
    (c) => React.isValidElement(c) && (c as any).type === 'code'
  ) as React.ReactElement | undefined;
  const codeText = codeEl ? getText(codeEl.props.children) : getText(props.children);
  const preLangData = (props as any)?.['data-language'] || (props as any)?.['data-lang'];
  const preLangFromClass = props.className?.match(/language-([\w-]+)/)?.[1];
  const codeLangData = codeEl?.props?.['data-language'] || codeEl?.props?.['data-lang'];
  const codeLangFromClass = codeEl?.props?.className?.match(/language-([\w-]+)/)?.[1];
  const lang = (preLangData ||
    preLangFromClass ||
    codeLangData ||
    codeLangFromClass ||
    '') as string;
  const label = lang ? prettyLang(lang) : 'Code';
  const title = ((props as any)?.['data-title'] ||
    codeEl?.props?.['data-title'] ||
    (props as any)?.['data-file'] ||
    (props as any)?.['data-filename']) as string | undefined;
  const [copied, setCopied] = React.useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <figure className="my-6 overflow-hidden rounded-md border shadow-sm">
      <div className="flex items-center justify-between px-3 py-2 text-xs border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="inline-flex items-center gap-1 pr-2">
            <span className="size-2.5 rounded-full bg-gray-500/80" />
            <span className="size-2.5 rounded-full bg-gray-400/80" />
            <span className="size-2.5 rounded-full bg-gray-300/80" />
          </span>
          {title ? (
            <span className="font-medium text-foreground/80 truncate max-w-[50vw]">{title}</span>
          ) : (
            <span className="rounded bg-muted px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide">
              {label}
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2"
          onClick={onCopy}
          aria-label="Copy code"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {/* Keep the original pre exactly as-is to preserve Shiki styles/vars */}
      <pre {...props} className={cn('!m-0', props.className)} />
    </figure>
  );
}
