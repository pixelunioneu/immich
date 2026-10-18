import { BadRequestException } from '@nestjs/common';
import { UserAdminService } from 'src/services/user-admin.service.js';
import { UserService } from 'src/services/user.service.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { UserFactory } from 'test/factories/user.factory.js';
import { authStub } from 'test/fixtures/auth.stub.js';
import { userStub } from 'test/fixtures/user.stub.js';
import { newTestService } from 'test/utils.js';

// PixelUnion: PuApiSyncService listens for UserUpdate to keep the tenant user index in sync.
describe('PixelUnion UserUpdate event', () => {
  describe(UserService.name, () => {
    it('should emit UserUpdate with the updated user', async () => {
      const { sut, mocks } = newTestService(UserService);
      const user = UserFactory.create();
      const updated = { ...userStub.user1, id: user.id, name: 'New Name' };
      mocks.user.update.mockResolvedValue(updated);

      await sut.updateMe(AuthFactory.create(user), { name: 'New Name' });

      expect(mocks.user.update).toHaveBeenCalledWith(user.id, expect.objectContaining({ name: 'New Name' }));
      expect(mocks.event.emit).toHaveBeenCalledWith('UserUpdate', updated);
    });

    it('should not emit UserUpdate when the email is taken', async () => {
      const { sut, mocks } = newTestService(UserService);
      mocks.user.getByEmail.mockResolvedValue(userStub.user1);

      await expect(
        sut.updateMe(AuthFactory.create(UserFactory.create()), { email: userStub.user1.email }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.event.emit).not.toHaveBeenCalledWith('UserUpdate', expect.anything());
    });
  });

  describe(UserAdminService.name, () => {
    it('should emit UserUpdate with the updated user', async () => {
      const { sut, mocks } = newTestService(UserAdminService);
      mocks.user.get.mockResolvedValue(userStub.user1);
      mocks.user.update.mockResolvedValue(userStub.user1);

      await sut.update(authStub.admin, userStub.user1.id, { name: 'New Name' });

      expect(mocks.event.emit).toHaveBeenCalledWith('UserUpdate', userStub.user1);
    });
  });
});
