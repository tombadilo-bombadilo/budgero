import React from 'react';
import { Title, type StepProps } from './shared';

interface YnabStepProps extends StepProps {
  onFileSelected: (file: File) => Promise<void> | void;
}

export const YnabImportStep: React.FC<YnabStepProps> = ({ cur, state, onFileSelected }) => {
  const file = state.ynabFile;
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  return (
    <div>
      <Title h={cur.title} sub={cur.subtitle} />
      {!file && (
        // Presentation wrapper: the click merely widens the hit area of the
        // fully keyboard-accessible "Browse files" button inside.
        <div
          role="presentation"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) void onFileSelected(f);
          }}
          style={{
            marginTop: 12,
            padding: '36px 20px',
            textAlign: 'center',
            cursor: 'pointer',
            border: '2px dashed rgba(57,57,57,0.55)',
            background: '#fffdf8',
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>☁</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
            Drop your YNAB export here
          </div>
          <div style={{ fontSize: 11, color: '#393939', lineHeight: 1.5 }}>
            In YNAB: <em>File › Export Budget</em>. Drop the .zip here —<br />
            nothing leaves your device until you finish.
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.click();
            }}
            style={{
              marginTop: 14,
              padding: '8px 16px',
              border: '1px solid #141414',
              background: 'transparent',
              fontFamily: 'inherit',
              fontSize: 11,
              letterSpacing: 1,
              cursor: 'pointer',
            }}
          >
            BROWSE FILES
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFileSelected(f);
            }}
          />
        </div>
      )}
      {file && (
        <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
          <div
            style={{
              padding: 14,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              border: '1px dashed rgba(57,57,57,0.5)',
              background: '#fbf7eb',
            }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                border: '1.5px solid #141414',
                background: '#141414',
                color: '#fbf7eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                fontWeight: 700,
              }}
            >
              Y
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{file.name}</div>
              <div style={{ fontSize: 10, color: '#393939' }}>
                {file.size} · ready to import on finish
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#2f7d31', letterSpacing: 1 }}>
              ✓ READY
            </div>
          </div>
          <div
            style={{
              padding: 10,
              fontSize: 11,
              color: '#393939',
              lineHeight: 1.5,
              border: '1px dashed rgba(57,57,57,0.3)',
            }}
          >
            <span style={{ fontWeight: 700, color: '#141414' }}>Heads up:</span> YNAB’s “Age of
            Money” and scheduled transactions don’t carry over. Everything else does — accounts,
            categories, assignments, and transaction history.
          </div>
        </div>
      )}
    </div>
  );
};
