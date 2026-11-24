import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { normalize } from "@pse/domain";
import type { Outcome } from "@pse/engine";
import type { Store } from "@pse/store";
import { Audience, TokenGuard } from "../auth.js";
import { STORE } from "../settings.js";

@Controller("v1/sessions")
@UseGuards(TokenGuard)
export class SessionsController {
  constructor(@Inject(STORE) private readonly store: Store) {}

  /** Decided stays: charges, payments matched, notices and write-offs, newest first. */
  @Get()
  @Audience("operator")
  async list(@Query("site") site?: string, @Query("plate") plate?: string, @Query("limit") limit?: string): Promise<{ sessions: Outcome[] }> {
    const n = Math.min(Math.max(Number(limit ?? 50) || 50, 1), 500);
    return { sessions: await this.store.outcomes({ ...(site ? { site } : {}), ...(plate ? { plate: normalize(plate) } : {}), limit: n }) };
  }
}
