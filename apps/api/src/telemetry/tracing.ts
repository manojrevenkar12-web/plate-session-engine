import { trace, type Tracer } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

let started = false;

/**
 * Traces go over OTLP to whatever collects them: the Datadog Agent accepts OTLP directly, so no Datadog SDK is
 * needed in the code. Off unless OTEL_EXPORTER_OTLP_ENDPOINT is set.
 */
export function startTracing(env: NodeJS.ProcessEnv = process.env): void {
  if (started || !env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": env.OTEL_SERVICE_NAME ?? "plate-session-engine",
      "deployment.environment": env.DD_ENV ?? env.NODE_ENV ?? "development",
      "service.version": env.DD_VERSION ?? "dev",
    }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` }))],
  });
  provider.register();
  started = true;
}

export const tracer = (): Tracer => trace.getTracer("plate-session-engine");
