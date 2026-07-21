import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { CalibrationController } from './calibration.controller';
import { CalibrationDecisionService } from './calibration-decision.service';
import { CalibrationService } from './calibration.service';
import { RedLineFindingService } from './red-line-finding.service';
import { ResultService } from './result.service';

describe('CalibrationController 校准确认与结果推送 API', () => {
  let app: INestApplication<App>;
  const calibrationService = {};
  const calibrationDecisionService = {
    confirmCycle: jest.fn(),
  };
  const resultService = {
    publishCycle: jest.fn(),
  };
  const redLineFindingService = {};
  const authGuard: CanActivate = {
    canActivate(context: ExecutionContext) {
      // HTTP 回归测试只替换认证外部边界，控制器仍从真实请求对象读取操作者。
      context.switchToHttp().getRequest().user = { open_id: 'ou_hr' };
      return true;
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CalibrationController],
      providers: [
        { provide: CalibrationService, useValue: calibrationService },
        {
          provide: CalibrationDecisionService,
          useValue: calibrationDecisionService,
        },
        { provide: ResultService, useValue: resultService },
        { provide: RedLineFindingService, useValue: redLineFindingService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(authGuard)
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    calibrationDecisionService.confirmCycle.mockResolvedValue({
      confirmed: 1,
      skipped: [],
    });
    resultService.publishCycle.mockResolvedValue({
      published: 1,
      unchanged: 0,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /cycles/:cycleId/calibrations/confirm 转发批量参与者并返回确认结果', async () => {
    await request(app.getHttpServer())
      .post('/cycles/3/calibrations/confirm')
      .send({ participantIds: [2] })
      .expect(201)
      .expect({ confirmed: 1, skipped: [] });

    expect(calibrationDecisionService.confirmCycle).toHaveBeenCalledWith(
      'ou_hr',
      3,
      [2],
    );
  });

  it('POST /cycles/:cycleId/results/push 返回新版发布计数', async () => {
    await request(app.getHttpServer())
      .post('/cycles/3/results/push')
      .send({})
      .expect(201)
      .expect({ published: 1, unchanged: 0 });

    expect(resultService.publishCycle).toHaveBeenCalledWith(
      'ou_hr',
      3,
      undefined,
    );
  });
});
