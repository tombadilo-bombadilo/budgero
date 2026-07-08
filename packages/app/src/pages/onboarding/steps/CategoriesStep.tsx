import React from 'react';
import { CATEGORY_PRESETS } from '../onboarding-data';
import { CategoriesIllustration } from '../illustrations';
import { Title, type StepProps } from './shared';

export const CategoriesStep: React.FC<StepProps> = ({ cur, state, set }) => {
  const toggleCat = (cat: string) => {
    const has = state.selectedCats.includes(cat);
    set({
      selectedCats: has
        ? state.selectedCats.filter((c) => c !== cat)
        : [...state.selectedCats, cat],
    });
  };
  return (
    <div>
      <div style={{ margin: '-20px -24px 20px' }}>
        <CategoriesIllustration height={200} />
      </div>
      <Title h={cur.title} sub={cur.subtitle} />
      <div style={{ display: 'grid', gap: 18 }}>
        {Object.entries(CATEGORY_PRESETS).map(([key, group]) => (
          <div key={key}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  background: group.color,
                  border: '1px solid #141414',
                }}
              />
              <span style={{ fontSize: 11, letterSpacing: 1.2, fontWeight: 700 }}>
                {group.label}
              </span>
              <span style={{ flex: 1, borderBottom: '1px dashed rgba(57,57,57,0.3)', height: 1 }} />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {group.items.map((item) => {
                const on = state.selectedCats.includes(item);
                return (
                  <button
                    key={item}
                    onClick={() => toggleCat(item)}
                    style={{
                      border: on ? '1px solid #141414' : '1px dashed rgba(57,57,57,0.5)',
                      background: on ? group.color : 'transparent',
                      color: on ? '#fbf7eb' : '#141414',
                      padding: '6px 12px',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontSize: 11,
                      fontWeight: on ? 600 : 400,
                    }}
                  >
                    {on ? '✓ ' : '+ '}
                    {item}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 16, fontSize: 11, color: '#393939' }}>
        {state.selectedCats.length} envelopes selected. You can always add more later.
      </div>
    </div>
  );
};
