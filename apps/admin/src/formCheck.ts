/**
 * UX-71: the message shown in the app (not the browser's popup) when a form
 * field breaks its own HTML rules (required, type="email", pattern, min/max
 * length, min/max). Copy of apps/web/src/lib/formCheck.ts (English only;
 * the apps share no UI package). Reads the same `ValidityState` the browser would use,
 * so the rules stay on the inputs where they already are.
 */

export interface CheckedField {
  label: string;
  type: string;
  title?: string;
  minLength?: number;
  maxLength?: number;
  min?: string;
  max?: string;
  validity: Pick<
    ValidityState,
    | "valueMissing"
    | "typeMismatch"
    | "patternMismatch"
    | "tooShort"
    | "tooLong"
    | "rangeUnderflow"
    | "rangeOverflow"
    | "stepMismatch"
    | "badInput"
  >;
}

const TEXT = {
  en: {
    required: (l: string) => `${l} is required.`,
    choose: (l: string) => `Choose ${l}.`,
    email: (l: string) => `${l}: enter a valid email address, like name@example.com.`,
    url: (l: string) => `${l}: enter a full web address starting with https://.`,
    format: (l: string) => `${l} is not in the right format.`,
    tooShort: (l: string, n: number) => `${l} must be at least ${n} characters.`,
    tooLong: (l: string, n: number) => `${l} must be at most ${n} characters.`,
    min: (l: string, n: string) => `${l} must be ${n} or more.`,
    max: (l: string, n: string) => `${l} must be ${n} or less.`,
    number: (l: string) => `${l} must be a number.`,
    step: (l: string) => `${l} is not a valid value.`,
  },
} as const;

/** null when the field is fine. A `title` on a pattern field is the hint the author already wrote. */
export function fieldMessage(field: CheckedField): string | null {
  const t = TEXT.en;
  const { label, validity: v } = field;
  if (v.valueMissing) return field.type.startsWith("select") ? t.choose(label) : t.required(label);
  if (v.badInput) return t.number(label);
  if (v.typeMismatch) return field.type === "email" ? t.email(label) : field.type === "url" ? t.url(label) : t.format(label);
  if (v.patternMismatch) return field.title ? `${label}: ${field.title}` : t.format(label);
  if (v.tooShort) return t.tooShort(label, field.minLength ?? 0);
  if (v.tooLong) return t.tooLong(label, field.maxLength ?? 0);
  if (v.rangeUnderflow) return t.min(label, field.min ?? "");
  if (v.rangeOverflow) return t.max(label, field.max ?? "");
  if (v.stepMismatch) return t.step(label);
  return null;
}
