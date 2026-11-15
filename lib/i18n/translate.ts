import type { Messages } from "@/messages/en";

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Every translation key, e.g. "editor.brush". Typos are compile errors. */
export type MessageKey = Leaves<Messages>;
export type TranslateParams = Record<string, string | number>;

export function translate(messages: Messages, key: MessageKey, params?: TranslateParams): string {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  if (typeof node !== "string") return key;
  if (!params) return node;
  return node.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}
