import type { Locale } from "./config";
import type { Messages } from "@/messages/en";
import en from "@/messages/en";
import ar from "@/messages/ar";
import de from "@/messages/de";

export type { Messages };

const all: Record<Locale, Messages> = { en, ar, de };

export function getMessages(locale: Locale): Messages {
  return all[locale];
}
