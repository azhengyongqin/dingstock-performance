import { EvaluationController } from './evaluation.controller';

jest.mock('../auth/jwt-auth.guard', () => ({ JwtAuthGuard: class {} }));
jest.mock('../rbac/roles.guard', () => ({ RolesGuard: class {} }));
jest.mock('./evaluation-submission.service', () => ({
  EvaluationSubmissionService: class {},
}));
jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfRatingSymbol: { S: 'S', A: 'A', B: 'B', C: 'C' },
  }),
  { virtual: true },
);

describe('EvaluationController 薄壳转调', () => {
  const service = {
    getSelfContext: jest.fn(),
    saveSelfDraft: jest.fn(),
    submitSelf: jest.fn(),
  };
  const controller = new EvaluationController(service as never);
  const request = { user: { open_id: 'ou_me' } } as never;

  beforeEach(() => jest.clearAllMocks());

  it('自评上下文转调 getSelfContext 并解析 cycleId', async () => {
    await controller.getSelfContext(request, '3');
    expect(service.getSelfContext).toHaveBeenCalledWith('ou_me', 3);

    await controller.getSelfContext(request, undefined);
    expect(service.getSelfContext).toHaveBeenLastCalledWith('ou_me', undefined);
  });

  it('草稿保存转调 saveSelfDraft', async () => {
    const dto = { cycleId: 1, items: [] };
    await controller.saveSelfDraft(request, dto);
    expect(service.saveSelfDraft).toHaveBeenCalledWith('ou_me', dto);
  });

  it('提交转调 submitSelf', async () => {
    const dto = { cycleId: 1, items: [] };
    await controller.submitSelf(request, dto);
    expect(service.submitSelf).toHaveBeenCalledWith('ou_me', dto);
  });
});
