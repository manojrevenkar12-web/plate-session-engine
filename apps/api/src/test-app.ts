import "reflect-metadata";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { AppModule, type Overrides } from "./app.module.js";
import { settingsFromEnv, type Settings } from "./settings.js";

export async function testApp(env: Record<string, string> = {}, overrides: Overrides = {}): Promise<{ app: NestFastifyApplication; settings: Settings }> {
  const settings = settingsFromEnv({ PSE_EDGE_TOKEN: "edge-secret", PSE_OPERATOR_TOKEN: "op-secret", PSE_TICK_MS: "3600000", ...env });
  const mod = await Test.createTestingModule({ imports: [AppModule.register(settings, { reader: null, ...overrides })] }).compile();
  const app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, settings };
}

export const EDGE = { "x-edge-token": "edge-secret" };
export const OP = { authorization: "Bearer op-secret" };
