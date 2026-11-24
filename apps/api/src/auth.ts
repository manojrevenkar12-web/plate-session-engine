import { type CanActivate, type ExecutionContext, Inject, Injectable, SetMetadata, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { timingSafeEqual } from "node:crypto";
import { SETTINGS, type Settings } from "./settings.js";

export const AUDIENCE = "pse:audience";
/** Edge devices authenticate with the edge token; operators with the operator token. */
export const Audience = (who: "edge" | "operator") => SetMetadata(AUDIENCE, who);

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

@Injectable()
export class TokenGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SETTINGS) private readonly settings: Settings,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const who = this.reflector.get<"edge" | "operator" | undefined>(AUDIENCE, ctx.getHandler());
    if (!who) return true;
    const expected = who === "edge" ? this.settings.edgeToken : this.settings.operatorToken;
    if (expected === null) return true; // development: no token configured
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const given = who === "edge" ? req.headers["x-edge-token"] : req.headers.authorization?.replace(/^Bearer /, "");
    if (!given || !same(given, expected)) throw new UnauthorizedException(`a valid ${who} token is required`);
    return true;
  }
}
