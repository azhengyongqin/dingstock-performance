import { AiReportProcessor } from './ai-report.processor';

jest.mock('./ai-report.service', () => ({ AiReportService: class {} }));

describe('AiReportProcessor 生产任务消费', () => {
  const service = {
    recoverTimedOut: jest.fn(),
    claimNext: jest.fn(),
    complete: jest.fn(),
    fail: jest.fn(),
  };
  const generator = { isEnabled: jest.fn(), generate: jest.fn() };
  let processor: AiReportProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    service.recoverTimedOut.mockResolvedValue({ count: 0 });
    service.claimNext.mockResolvedValue(null);
    service.complete.mockResolvedValue({ ok: true });
    service.fail.mockResolvedValue({ ok: true });
    generator.isEnabled.mockReturnValue(true);
    processor = new AiReportProcessor(service as never, generator);
  });

  it('定时恢复超时任务，并领取当前修订生成报告', async () => {
    service.claimNext
      .mockResolvedValueOnce({
        id: 9,
        revision: 'revision-1',
        input: { submissions: [] },
      })
      .mockResolvedValueOnce(null);
    generator.generate.mockResolvedValue({
      referenceLevel: 'A',
      summary: 'AI 参考报告',
    });

    await processor.processTick();

    expect(service.recoverTimedOut).toHaveBeenCalledWith(300_000);
    expect(generator.generate).toHaveBeenCalledWith({ submissions: [] });
    expect(service.complete).toHaveBeenCalledWith(9, 'revision-1', {
      referenceLevel: 'A',
      summary: 'AI 参考报告',
    });
  });

  it('模型失败时写入 FAILED，后续由 availableAt 自动重试', async () => {
    const failure = new Error('AI 网关超时');
    service.claimNext
      .mockResolvedValueOnce({ id: 9, revision: 'revision-1', input: {} })
      .mockResolvedValueOnce(null);
    generator.generate.mockRejectedValue(failure);

    await processor.processTick();

    expect(service.fail).toHaveBeenCalledWith(9, 'revision-1', failure);
    expect(service.complete).not.toHaveBeenCalled();
  });

  it('AI 开关关闭时不领取任务，人工流程继续独立推进', async () => {
    generator.isEnabled.mockReturnValue(false);

    await processor.processTick();

    expect(service.recoverTimedOut).toHaveBeenCalled();
    expect(service.claimNext).not.toHaveBeenCalled();
  });
});
