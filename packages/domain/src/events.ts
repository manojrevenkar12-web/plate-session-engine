/** What edge devices and payment channels send to the cloud. `at` is the device clock; `sentAt` is when the cloud received it. */
export type Direction = "in" | "out";

export interface ReadEvent {
  kind: "read";
  id: string;
  scanner: string;
  site: string;
  direction: Direction;
  at: number;
  plate: string;
  confidence: number;
  colour: string;
  make: string;
  /** where the edge device stored the plate crop, if it uploads one */
  cropUrl?: string;
  sentAt: number;
}

export interface PaymentEvent {
  kind: "payment";
  id: string;
  site: string;
  plate: string;
  at: number;
  amountCents: number;
  channel: "terminal" | "app";
  sentAt: number;
}

export interface HeartbeatEvent {
  kind: "heartbeat";
  id: string;
  scanner: string;
  site: string;
  at: number;
  sentAt: number;
}

export type EdgeEvent = ReadEvent | PaymentEvent | HeartbeatEvent;

export type SiteKind = "shopping" | "office" | "residential" | "hospital" | "airport" | "leisure";

/** Product data the platform holds about a site: what is installed where. Not truth about traffic. */
export interface SiteInfo {
  id: string;
  kind: SiteKind;
  tariff: string;
  scanners: { id: string; direction: Direction; lane: number }[];
}

/** A driver who registered a plate for Automatic Payment. */
export interface Account {
  id: string;
  plate: string;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
