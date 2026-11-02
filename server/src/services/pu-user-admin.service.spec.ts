import { randomBytes } from 'node:crypto';
import { LEGACY_PLACEHOLDER_PASSWORD, UserAdminService } from 'src/services/user-admin.service.js';
import { UserFactory } from 'test/factories/user.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

// PixelUnion: admin-created users must never get a predictable (shared) password.
describe('PixelUnion admin user creation password', () => {
  let sut: UserAdminService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(UserAdminService));
    mocks.crypto.randomBytesAsText.mockImplementation((bytes: number) =>
      randomBytes(bytes).toString('base64').replaceAll(/\W/g, ''),
    );
    mocks.user.getAdmin.mockResolvedValue(UserFactory.create({ isAdmin: true }));
    mocks.user.create.mockImplementation((dto) => Promise.resolve(UserFactory.create({ ...dto } as any)));
  });

  const createdPasswords = () => mocks.user.create.mock.calls.map(([dto]) => dto.password);
  const hashedInputs = () => mocks.crypto.hashBcrypt.mock.calls.map(([input]) => input);

  it('should never hash the placeholder password and give each user a different hash', async () => {
    await sut.create({ email: 'a@immich.cloud', name: 'A', password: LEGACY_PLACEHOLDER_PASSWORD });
    await sut.create({ email: 'b@immich.cloud', name: 'B', password: LEGACY_PLACEHOLDER_PASSWORD });

    expect(hashedInputs()).toHaveLength(2);
    expect(hashedInputs()).not.toContain(LEGACY_PLACEHOLDER_PASSWORD);
    expect(mocks.crypto.randomBytesAsText).toHaveBeenCalledWith(32);

    const [first, second] = createdPasswords();
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toEqual(second);
    expect(first).not.toContain(LEGACY_PLACEHOLDER_PASSWORD);
  });

  it('should generate a random password when none is provided (OAuth enabled)', async () => {
    mocks.systemMetadata.get.mockResolvedValue({ oauth: { enabled: true } });

    await sut.create({ email: 'a@immich.cloud', name: 'A', password: '' });

    expect(mocks.crypto.randomBytesAsText).toHaveBeenCalledWith(32);
    expect(hashedInputs()).toHaveLength(1);
    expect(hashedInputs()[0]).not.toEqual('');
  });

  it('should not put a generated password in the signup event', async () => {
    await sut.create({ email: 'a@immich.cloud', name: 'A', password: LEGACY_PLACEHOLDER_PASSWORD, notify: true });

    expect(mocks.event.emit).toHaveBeenCalledWith('UserSignup', expect.objectContaining({ password: undefined }));
  });

  it('should hash a client-provided password as-is', async () => {
    await sut.create({ email: 'a@immich.cloud', name: 'A', password: 'client-random-value' });

    expect(mocks.crypto.randomBytesAsText).not.toHaveBeenCalled();
    expect(hashedInputs()).toEqual(['client-random-value']);
    expect(mocks.event.emit).toHaveBeenCalledWith(
      'UserSignup',
      expect.objectContaining({ password: 'client-random-value' }),
    );
  });
});
