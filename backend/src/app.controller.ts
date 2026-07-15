import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';
import { SkipPerformanceCutoverGate } from './cutover/performance-cutover.decorator';

@ApiTags('health')
@SkipPerformanceCutoverGate()
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOkResponse({ description: '服务启动状态检查' })
  getHello(): string {
    return this.appService.getHello();
  }
}
