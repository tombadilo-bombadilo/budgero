import { ApiError } from '@shared/api/api-client';
import { checkInviteCode, classifyInviteError, normalizeInviteCode } from './invite-code';

const mocks = vi.hoisted(() => ({ inspectInvite: vi.fn(), decryptInvite: vi.fn() }));

vi.mock('@shared/api/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/api/api-client')>();
  return { ...actual, spaceApi: { ...actual.spaceApi, inspectInvite: mocks.inspectInvite } };
});
vi.mock('@budgero/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@budgero/runtime')>()),
  decryptSpaceKeyFromInvite: mocks.decryptInvite,
}));

describe('normalizeInviteCode', () => {
  it.each([
    ['  abc_DEF-123  ', 'abc_DEF-123'],
    ['https://my.budgero.app/join#code=abc_DEF-123', 'abc_DEF-123'],
    ['Open http://dell:4170/join#code=abc%2Bx and sign in', 'abc+x'],
    ['abc_DEF\n-123', 'abc_DEF-123'],
    ['   ', ''],
  ])('%j → %j', (raw, code) => {
    expect(normalizeInviteCode(raw)).toBe(code);
  });
});

describe('checkInviteCode', () => {
  const now = Date.parse('2026-11-12T12:00:00Z');

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decryptInvite.mockResolvedValue(new Uint8Array(32));
  });

  it('accepts an open invite and names its workspace', async () => {
    mocks.inspectInvite.mockResolvedValue({
      encrypted_bundle: 'b',
      space_display_name: 'Home',
      expires_at: '2026-11-19T12:00:00Z',
    });
    await expect(checkInviteCode('code', now)).resolves.toEqual({ ok: true, spaceName: 'Home' });
    // Only the fingerprint goes to the server; the code opens the bundle here.
    expect(mocks.inspectInvite).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(mocks.decryptInvite).toHaveBeenCalledWith('b', 'code');
  });

  it.each([
    [
      'unknown or used code',
      () => mocks.inspectInvite.mockRejectedValue(new ApiError('x', 404)),
      'not_found',
    ],
    [
      'server says expired',
      () => mocks.inspectInvite.mockRejectedValue(new ApiError('x', 410)),
      'expired',
    ],
    [
      'past its expiry date',
      () =>
        mocks.inspectInvite.mockResolvedValue({
          encrypted_bundle: 'b',
          expires_at: '2026-11-01T00:00:00Z',
        }),
      'expired',
    ],
    [
      'missing its bundle',
      () => mocks.inspectInvite.mockResolvedValue({ encrypted_bundle: '' }),
      'incomplete',
    ],
    [
      'a bundle the code does not open',
      () => {
        mocks.inspectInvite.mockResolvedValue({ encrypted_bundle: 'b' });
        mocks.decryptInvite.mockRejectedValue(new Error('bad'));
      },
      'incomplete',
    ],
    [
      'offline',
      () => mocks.inspectInvite.mockRejectedValue(new TypeError('Failed to fetch')),
      'network',
    ],
    [
      'a server error',
      () => mocks.inspectInvite.mockRejectedValue(new ApiError('x', 500)),
      'unknown',
    ],
  ])('turns down %s', async (_name, arrange, reason) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    arrange();
    await expect(checkInviteCode('code', now)).resolves.toEqual({ ok: false, reason });
  });
});

describe('classifyInviteError', () => {
  it('tells a full workspace from an unfinished invite', () => {
    expect(classifyInviteError(new ApiError('collaborator seat limit reached', 409))).toBe(
      'no_seats'
    );
    expect(classifyInviteError(new ApiError('invite bundle missing', 409))).toBe('incomplete');
    expect(classifyInviteError(new Error('boom'))).toBeNull();
  });
});
