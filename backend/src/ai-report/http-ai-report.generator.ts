import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../generated/prisma/client';
import { PerfRatingSymbol } from '../generated/prisma/enums';
import type { AiReportGenerator, AiReportOutput } from './ai-report.types';

/**
 * 内部 AI 网关适配器。网关接收 `{ model, input }`，返回 AiReportOutput JSON；
 * 供应商鉴权和模型路由留在网关侧，绩效系统不绑定特定 SDK。
 */
@Injectable()
export class HttpAiReportGenerator implements AiReportGenerator {
  constructor(private readonly configService: ConfigService) {}

  isEnabled() {
    return this.configService.get<boolean>('aiReport.enabled', false);
  }

  async generate(input: Prisma.JsonValue): Promise<AiReportOutput> {
    const endpoint = this.configService.get<string>('aiReport.endpoint', '');
    if (!endpoint) {
      throw new BadGatewayException('AI 报告已启用但未配置网关地址');
    }
    const apiKey = this.configService.get<string>('aiReport.apiKey', '');
    const timeoutMs = this.configService.get<number>(
      'aiReport.timeoutMs',
      30_000,
    );
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.configService.get<string>('aiReport.model', ''),
        input,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      // 不读取响应正文，避免把上游可能包含的敏感提示词写入错误日志。
      throw new BadGatewayException(
        `AI 网关请求失败（HTTP ${response.status}）`,
      );
    }
    return this.parseOutput(await response.json());
  }

  private parseOutput(value: unknown): AiReportOutput {
    if (!this.isRecord(value)) {
      throw new BadGatewayException('AI 网关返回格式无效');
    }
    const levels = new Set(Object.values(PerfRatingSymbol));
    if (
      typeof value.referenceLevel !== 'string' ||
      !levels.has(value.referenceLevel as PerfRatingSymbol) ||
      typeof value.summary !== 'string' ||
      value.summary.trim().length === 0
    ) {
      throw new BadGatewayException('AI 网关缺少有效的参考等级或报告摘要');
    }
    return {
      referenceLevel: value.referenceLevel as PerfRatingSymbol,
      summary: value.summary,
      highlights: this.optionalJson(value.highlights),
      improvements: this.optionalJson(value.improvements),
      promotionSummary:
        typeof value.promotionSummary === 'string'
          ? value.promotionSummary
          : null,
      riskFlags: this.optionalJson(value.riskFlags),
    };
  }

  private optionalJson(value: unknown): Prisma.InputJsonValue | null {
    if (value === undefined || value === null) return null;
    // response.json() 已保证载荷来自 JSON；这里仅排除非 JSON 的运行时伪造值。
    try {
      JSON.stringify(value);
      return value;
    } catch {
      throw new BadGatewayException('AI 网关返回了不可序列化字段');
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
