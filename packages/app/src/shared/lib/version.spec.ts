import { isNewerVersion } from './version';

describe('isNewerVersion', () => {
  it('detects newer patch/minor/major releases', () => {
    expect(isNewerVersion('1.6.1', '1.6.0')).toBe(true);
    expect(isNewerVersion('1.7.0', '1.6.9')).toBe(true);
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true);
  });

  it('returns false for equal or older versions', () => {
    expect(isNewerVersion('1.6.0', '1.6.0')).toBe(false);
    expect(isNewerVersion('1.5.9', '1.6.0')).toBe(false);
    expect(isNewerVersion('1.6.0', '1.10.0')).toBe(false);
  });

  it('ignores v-prefix and build metadata', () => {
    expect(isNewerVersion('v1.6.1', '1.6.0+abc123')).toBe(true);
    expect(isNewerVersion('1.6.0+abc', 'v1.6.0')).toBe(false);
  });

  it('compares segments numerically, not lexically', () => {
    expect(isNewerVersion('1.10.0', '1.9.0')).toBe(true);
  });

  it('never reports malformed input as newer', () => {
    expect(isNewerVersion('unknown', '1.6.0')).toBe(false);
    expect(isNewerVersion('', '1.6.0')).toBe(false);
    expect(isNewerVersion('dev', 'dev')).toBe(false);
  });
});
