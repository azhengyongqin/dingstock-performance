import { PerfRole } from '../generated/prisma/enums';
import { ROLES_KEY } from '../rbac/roles.decorator';
import { ConfigTemplateController } from './config-template.controller';

jest.mock('../auth/jwt-auth.guard', () => ({ JwtAuthGuard: class {} }));
jest.mock('../rbac/roles.guard', () => ({ RolesGuard: class {} }));
jest.mock('./config-template.service', () => ({
  ConfigTemplateService: class {},
}));

describe('ConfigTemplateController 权限契约', () => {
  const getHandler = (method: keyof ConfigTemplateController) =>
    Object.getOwnPropertyDescriptor(ConfigTemplateController.prototype, method)!
      .value as object;

  it('HR 与 Admin 可读，配置版本生命周期写操作仅限 Admin', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ConfigTemplateController)).toEqual([
      PerfRole.HR,
      PerfRole.ADMIN,
    ]);

    const adminOnlyMethods: Array<keyof ConfigTemplateController> = [
      'create',
      'replaceDraft',
      'publish',
      'newDraft',
      'archive',
    ];
    for (const method of adminOnlyMethods) {
      expect(Reflect.getMetadata(ROLES_KEY, getHandler(method))).toEqual([
        PerfRole.ADMIN,
      ]);
    }

    for (const method of [
      'list',
      'listVersions',
      'detail',
      'validate',
      'calculationPreview',
    ] as const) {
      expect(
        Reflect.getMetadata(ROLES_KEY, getHandler(method)),
      ).toBeUndefined();
    }
  });
});
