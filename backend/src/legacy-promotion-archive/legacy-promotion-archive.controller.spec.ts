import { PerfRole } from '../generated/prisma/enums';
import { ROLES_KEY } from '../rbac/roles.decorator';
import { LegacyPromotionArchiveController } from './legacy-promotion-archive.controller';

jest.mock('../auth/jwt-auth.guard', () => ({ JwtAuthGuard: class {} }));
jest.mock('../rbac/roles.guard', () => ({ RolesGuard: class {} }));
jest.mock('./legacy-promotion-archive.service', () => ({
  LegacyPromotionArchiveService: class {},
}));

describe('LegacyPromotionArchiveController', () => {
  it('只允许 HR 与 Admin 访问只读列表入口', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, LegacyPromotionArchiveController),
    ).toEqual([PerfRole.HR, PerfRole.ADMIN]);

    const handler = Object.getOwnPropertyDescriptor(
      LegacyPromotionArchiveController.prototype,
      'list',
    )!.value as object;
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
    expect(
      Object.getOwnPropertyDescriptor(
        LegacyPromotionArchiveController.prototype,
        'create',
      ),
    ).toBeUndefined();
  });

  it('把当前操作人 open_id 传给归档查询服务', async () => {
    const service = { list: jest.fn() };
    const controller = new LegacyPromotionArchiveController(service as never);
    const query = { page: 1, page_size: 20 };

    await controller.list({ user: { open_id: 'ou_operator' } } as never, query);

    expect(service.list).toHaveBeenCalledWith('ou_operator', {
      page: 1,
      pageSize: 20,
      cycleId: undefined,
      sourceType: undefined,
    });
  });
});
