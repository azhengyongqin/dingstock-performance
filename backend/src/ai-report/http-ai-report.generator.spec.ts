import { BadGatewayException } from '@nestjs/common';
import { HttpAiReportGenerator } from './http-ai-report.generator';

jest.mock(
  '../generated/prisma/client',
  () => ({ PrismaClient: class {}, Prisma: {} }),
  { virtual: true },
);
jest.mock(
  '../generated/prisma/enums',
  () => ({ PerfRatingSymbol: { S: 'S', A: 'A', B: 'B', C: 'C' } }),
  { virtual: true },
);

describe('HttpAiReportGenerator 内部 AI 网关适配', () => {
  const config = {
    get: jest.fn((key: string, fallback: unknown) => {
      const values: Record<string, unknown> = {
        'aiReport.enabled': true,
        'aiReport.endpoint': 'https://ai.internal.example/report',
        'aiReport.apiKey': 'secret',
        'aiReport.model': 'performance-review',
        'aiReport.timeoutMs': 30_000,
      };
      return values[key] ?? fallback;
    }),
  };
  let generator: HttpAiReportGenerator;

  beforeEach(() => {
    jest.clearAllMocks();
    generator = new HttpAiReportGenerator(config as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('发送输入快照并校验直接参考等级与报告结构', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        referenceLevel: 'A',
        summary: '综合表现稳定',
        highlights: [{ title: '结果', evidence: '目标达成' }],
        riskFlags: [],
      }),
    } as never);

    const result = await generator.generate({ participant: { id: 7 } });

    expect(fetch).toHaveBeenCalledWith(
      'https://ai.internal.example/report',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer secret' }),
        body: JSON.stringify({
          model: 'performance-review',
          input: { participant: { id: 7 } },
        }),
      }),
    );
    expect(result).toMatchObject({
      referenceLevel: 'A',
      summary: '综合表现稳定',
    });
  });

  it('拒绝没有 S/A/B/C 参考等级的异常响应', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: jest
        .fn()
        .mockResolvedValue({ referenceLevel: '优秀', summary: '错误输出' }),
    } as never);

    await expect(generator.generate({})).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
});
