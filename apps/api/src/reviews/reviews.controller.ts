import { BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, UseGuards } from "@nestjs/common";
import type { ReviewItem } from "@pse/domain";
import { Audience, TokenGuard } from "../auth.js";
import { EngineService } from "../engine/engine.service.js";
import { answerSchema } from "../ingest/schema.js";

@Controller("v1/reviews")
@UseGuards(TokenGuard)
export class ReviewsController {
  constructor(@Inject(EngineService) private readonly engine: EngineService) {}

  /** What waits for a person, oldest first, with the evidence and any suggestion from the crop reader. */
  @Get()
  @Audience("operator")
  list(@Query("site") site?: string): { reviews: { item: ReviewItem; since: number }[] } {
    return { reviews: this.engine.pending(site) };
  }

  @Post(":id/answer")
  @HttpCode(200)
  @Audience("operator")
  async answer(@Param("id") id: string, @Body() body: unknown): Promise<{ status: "applied" }> {
    const parsed = answerSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`));
    const r = await this.engine.answer(id, parsed.data.answer, parsed.data.minutes, parsed.data.operator);
    if (r === "unknown") throw new NotFoundException(`review ${id} is not waiting: answered already, or never asked`);
    return { status: "applied" };
  }
}
