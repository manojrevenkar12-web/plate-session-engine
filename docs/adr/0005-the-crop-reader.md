# 0005: The crop reader: the model reads, code decides

## Context
When code cannot tell which entry an exit belongs to, a person compares the camera crops. A vision model can do
that comparison faster, but it also picks a plausible lookalike when the right car is not among the candidates.

## Decision
For an uncertain exit the engine shows the model the exit crop and up to four candidate entry crops
(`ClaudeCropReader`, Anthropic Messages API, images by URL, JSON answer). The engine accepts the pick only if
it is one of its candidates, has at least 8% posterior on the engine's own evidence, and the model is at least
0.9 confident. Otherwise the review goes to a person with the pick shown as a suggestion. A malformed answer or a
candidate the model was not shown counts as no answer. In the server the model answers asynchronously and the same
check runs in `offerCropAnswer`; an accepted answer is logged like a person's, so replay reproduces it.

## Consequences
- Operator minutes fall by about a fifth (41.4 → 32.4 per 1,000 stays, dev) at no measurable cost in wrong
  charges. On its own, deciding every unmatched exit, the model is the worst design: 422 wrong per 10,000.
- The study's model is simulated; the adapter is tested against a mocked API. No crop went to a real model.
