export interface AppConfig {
  env: 'local' | 'development' | 'staging' | 'production';
  port: number;
  jwt: {
    accessSecret: string;
    accessTtl: string;
    refreshSecret: string;
    refreshTtlDays: number;
  };
  demoAllowedStates: string[];
}

export default (): AppConfig => ({
  env: (process.env.NODE_ENV as AppConfig['env']) ?? 'local',
  port: Number(process.env.PORT ?? 4000),
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me',
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-me',
    refreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30),
  },
  demoAllowedStates: (process.env.DEMO_ALLOWED_STATES ?? 'NJ,PA').split(','),
});
