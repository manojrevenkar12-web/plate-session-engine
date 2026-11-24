import { createHash } from "node:crypto";

/** BullMQ job ids may not contain ":"; a hash of the content also makes a retried request a no-op. */
export const jobId = (text: string): string => createHash("sha1").update(text).digest("hex");
