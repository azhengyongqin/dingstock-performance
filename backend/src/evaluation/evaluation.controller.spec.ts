import { EvaluationController } from './evaluation.controller';

jest.mock('../auth/jwt-auth.guard', () => ({ JwtAuthGuard: class {} }));
jest.mock('../rbac/roles.guard', () => ({ RolesGuard: class {} }));
jest.mock('./evaluation-submission.service', () => ({
  EvaluationSubmissionService: class {},
}));
jest.mock('./peer-evaluation-submission.service', () => ({
  PeerEvaluationSubmissionService: class {},
}));
jest.mock('./peer-stage-result.service', () => ({
  PeerStageResultService: class {},
}));
jest.mock('./manager-evaluation-submission.service', () => ({
  ManagerEvaluationSubmissionService: class {},
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
  const peerService = {
    getPeerContext: jest.fn(),
    savePeerDraft: jest.fn(),
    submitPeer: jest.fn(),
  };
  const peerStageResultService = { getForManager: jest.fn() };
  const managerService = {
    getManagerContext: jest.fn(),
    saveManagerDraft: jest.fn(),
    submitManager: jest.fn(),
    getManagerResult: jest.fn(),
  };
  const controller = new EvaluationController(
    service as never,
    peerService as never,
    peerStageResultService as never,
    managerService as never,
  );
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

  it('360°上下文只使用 JWT 身份与 assignmentId 转调', async () => {
    await controller.getPeerContext(request, 11);
    expect(peerService.getPeerContext).toHaveBeenCalledWith('ou_me', 11);
  });

  it('360°草稿与正式提交转调统一提交服务', async () => {
    const dto = { assignmentId: 11, items: [] };

    await controller.savePeerDraft(request, dto);
    await controller.submitPeer(request, dto);

    expect(peerService.savePeerDraft).toHaveBeenCalledWith('ou_me', dto);
    expect(peerService.submitPeer).toHaveBeenCalledWith('ou_me', dto);
  });

  it('360°阶段结果查询只使用 JWT 身份与 participantId 转调', async () => {
    await controller.getPeerStageResult(request, 7);
    expect(peerStageResultService.getForManager).toHaveBeenCalledWith(
      'ou_me',
      7,
    );
  });

  it('上级评估上下文、草稿、提交与权威结果均只使用 JWT Leader 身份', async () => {
    const dto = { participantId: 7, items: [] };

    await controller.getManagerContext(request, 7);
    await controller.saveManagerDraft(request, dto);
    await controller.submitManager(request, dto);
    await controller.getManagerStageResult(request, 7);

    expect(managerService.getManagerContext).toHaveBeenCalledWith('ou_me', 7);
    expect(managerService.saveManagerDraft).toHaveBeenCalledWith('ou_me', dto);
    expect(managerService.submitManager).toHaveBeenCalledWith('ou_me', dto);
    expect(managerService.getManagerResult).toHaveBeenCalledWith('ou_me', 7);
  });
});
