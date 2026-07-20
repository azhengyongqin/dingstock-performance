describe('baseline seed 脚本模块边界', () => {
  it('被其他模块导入时不读取环境配置、不自动执行 main', () => {
    const loadAppConfig = jest.fn(() => {
      throw new Error('导入 seed 模块时不应读取数据库配置');
    });

    jest.isolateModules(() => {
      jest.doMock('../config/configuration', () => ({ loadAppConfig }));
      expect(() => {
        jest.requireActual<typeof import('./seed-baseline-data')>(
          './seed-baseline-data',
        );
      }).not.toThrow();
    });

    expect(loadAppConfig).not.toHaveBeenCalled();
  });
});
