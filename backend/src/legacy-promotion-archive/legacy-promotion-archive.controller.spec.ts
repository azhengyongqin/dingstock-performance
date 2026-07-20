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
});
