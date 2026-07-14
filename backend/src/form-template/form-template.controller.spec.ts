import { PerfRole } from '../generated/prisma/enums';
import { ROLES_KEY } from '../rbac/roles.decorator';
import { FormTemplateController } from './form-template.controller';

jest.mock('../auth/jwt-auth.guard', () => ({ JwtAuthGuard: class {} }));
jest.mock('../rbac/roles.guard', () => ({ RolesGuard: class {} }));
jest.mock('./form-template.service', () => ({
  FormTemplateService: class {},
}));

describe('FormTemplateController 权限契约', () => {
  it('HR 与 Admin 可读，所有生命周期写操作仅限 Admin', () => {
    const getHandler = (method: keyof FormTemplateController) =>
      Object.getOwnPropertyDescriptor(FormTemplateController.prototype, method)!
        .value as object;

    expect(Reflect.getMetadata(ROLES_KEY, FormTemplateController)).toEqual([
      PerfRole.HR,
      PerfRole.ADMIN,
    ]);

    const adminOnlyMethods: Array<keyof FormTemplateController> = [
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

    // 读接口不覆盖类级角色，继续沿用 HR / ADMIN 可读边界。
    expect(Reflect.getMetadata(ROLES_KEY, getHandler('list'))).toBeUndefined();
    expect(
      Reflect.getMetadata(ROLES_KEY, getHandler('detail')),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(ROLES_KEY, getHandler('analyzePrefixCoverage')),
    ).toBeUndefined();
  });
});
