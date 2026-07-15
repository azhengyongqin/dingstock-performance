/**
 * Ticket 20 旧模型迁移命令。
 *
 * 用法：
 *   pnpm migration:legacy -- plan --run-key=t20-rehearsal --cycle-id=1
 *   pnpm migration:legacy -- apply --run-key=t20-apply
 *   pnpm migration:legacy -- report --run-key=t20-apply
 *   pnpm migration:legacy -- assert-ready --run-key=t20-apply
 *   pnpm migration:legacy -- rollback --run-key=t20-apply
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { LegacyMigrationService } from '../migration/legacy-migration.service';

type Command = 'plan' | 'apply' | 'report' | 'assert-ready' | 'rollback';

async function main() {
  const [commandValue, ...args] = process.argv.slice(2);
  const command = commandValue as Command;
  if (
    !['plan', 'apply', 'report', 'assert-ready', 'rollback'].includes(command)
  ) {
    throw new Error('命令必须为 plan/apply/report/assert-ready/rollback');
  }
  const runKey = option(args, '--run-key');
  if (!runKey) throw new Error('必须提供 --run-key=<稳定批次键>');
  const cycleIdValue = option(args, '--cycle-id');
  const cycleId = cycleIdValue ? Number(cycleIdValue) : undefined;
  if (cycleIdValue && (!Number.isInteger(cycleId) || Number(cycleId) <= 0)) {
    throw new Error('--cycle-id 必须是正整数');
  }
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const service = app.get(LegacyMigrationService);
    let output: unknown;
    if (command === 'plan' || command === 'apply') {
      output = await service.run({
        runKey,
        cycleId,
        dryRun: command === 'plan',
        acceptShadowBusinessKeys: options(args, '--accept-shadow-key'),
      });
    } else if (command === 'report') {
      output = await service.getReport(runKey);
    } else if (command === 'assert-ready') {
      output = await service.assertReady(runKey);
    } else {
      output = await service.rollback(runKey);
    }
    // CLI 输出是运维归档接口，保持纯 JSON 便于 tee 到报告文件或交给流水线解析。
    console.log(JSON.stringify(output, null, 2));
  } finally {
    await app.close();
  }
}

function option(args: readonly string[], name: string) {
  return options(args, name)[0];
}

function options(args: readonly string[], name: string) {
  const prefix = `${name}=`;
  return args
    .filter((item) => item.startsWith(prefix))
    .map((item) => item.slice(prefix.length));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
