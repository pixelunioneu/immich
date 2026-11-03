import { ForbiddenException } from '@nestjs/common';
import { defaults } from 'src/dtos/config.dto.js';
import { NotificationAdminService } from 'src/services/notification-admin.service.js';
import { NotificationService } from 'src/services/notification.service.js';
import { userStub } from 'test/fixtures/user.stub.js';
import { mockEnvData } from 'test/repositories/config.repository.mock.js';
import { newTestService } from 'test/utils.js';

const smtp = {
  ...defaults.notifications.smtp,
  enabled: true,
  transport: {
    ignoreCert: false,
    host: '10.0.0.1',
    port: 25,
    secure: false,
    username: 'test',
    password: 'test',
  },
};

// PixelUnion: hosted tenants may not use the SMTP test endpoint to connect to arbitrary hosts.
const services = [
  { name: NotificationAdminService.name, setup: () => newTestService(NotificationAdminService) },
  { name: NotificationService.name, setup: () => newTestService(NotificationService) },
];

describe.each(services)('$name (PixelUnion SMTP test)', ({ setup }) => {
  it('should refuse to test SMTP settings on a hosted tenant', async () => {
    const { sut, mocks } = setup();
    mocks.config.getEnv.mockReturnValue(mockEnvData({ puTenantName: 'tenant' }));
    mocks.user.get.mockResolvedValue(userStub.admin);

    await expect(sut.sendTestEmail(userStub.admin.id, smtp)).rejects.toBeInstanceOf(ForbiddenException);

    expect(mocks.email.verifySmtp).not.toHaveBeenCalled();
    expect(mocks.email.sendEmail).not.toHaveBeenCalled();
  });

  it('should allow testing SMTP settings when not running as a hosted tenant', async () => {
    const { sut, mocks } = setup();
    mocks.config.getEnv.mockReturnValue(mockEnvData({ puTenantName: null }));
    mocks.user.get.mockResolvedValue(userStub.admin);
    mocks.email.verifySmtp.mockResolvedValue(true);
    mocks.email.renderEmail.mockResolvedValue({ html: '', text: '' });
    mocks.email.sendEmail.mockResolvedValue({ messageId: 'message-1', response: '' });

    await expect(sut.sendTestEmail(userStub.admin.id, smtp)).resolves.toEqual({ messageId: 'message-1' });

    expect(mocks.email.verifySmtp).toHaveBeenCalledWith(smtp.transport);
  });
});
