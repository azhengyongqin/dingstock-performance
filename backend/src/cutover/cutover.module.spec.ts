import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';

describe('CutoverModule', () => {
  it('应用启动时应能解析切换监控接口的认证与权限守卫', async () => {
    // 编译完整应用模块，覆盖控制器守卫在所属模块上下文中的真实依赖解析。
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    await moduleRef.close();
  });
});
