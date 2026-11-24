import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { settingsFromEnv } from "./settings.js";
import { startTracing } from "./telemetry/tracing.js";

startTracing();
const settings = settingsFromEnv();
const app = await NestFactory.create<NestFastifyApplication>(AppModule.register(settings), new FastifyAdapter({ bodyLimit: 2_000_000, trustProxy: true }), {
  bufferLogs: false,
});
app.enableShutdownHooks();
await app.listen(settings.port, "0.0.0.0");
console.log(`plate-session-engine ${settings.role} listening on :${settings.port}`);
