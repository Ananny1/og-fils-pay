import { useState } from "react";
import { fieldMessage, type FormCheckLang } from "../lib/formCheck.js";
import { ErrorAlert } from "@/components/dashboard/error-alert";

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function labelOf(el: Control): string {
  const label = el.labels?.[0];
  // The label's own words, not the text of a control nested inside it.
  const own = label
    ? Array.from(label.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? "")
        .join(" ")
        .trim()
    : "";
  return own || label?.textContent?.trim() || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.name || "This field";
}

/**
 * UX-71: a `<form>` that never shows the browser's validation popups. On
 * submit it checks the inputs' own rules (required, type, pattern, …); if
 * one fails it marks every bad field red (`aria-invalid`), focuses the
 * first, and shows the message in the app. Typing in a field clears its mark.
 */
export function CheckedForm({
  onSubmit,
  onInput,
  lang = "en",
  errorTitle,
  children,
  ...rest
}: React.FormHTMLAttributes<HTMLFormElement> & { lang?: FormCheckLang; errorTitle?: string }) {
  const [message, setMessage] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const controls = Array.from(event.currentTarget.elements).filter(
      (el): el is Control =>
        (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) && el.willValidate,
    );
    let first: { el: Control; text: string } | null = null;
    for (const el of controls) {
      const text = fieldMessage(
        {
          label: labelOf(el),
          type: el.type,
          title: el.title || undefined,
          minLength: "minLength" in el && el.minLength > 0 ? el.minLength : undefined,
          maxLength: "maxLength" in el && el.maxLength > 0 ? el.maxLength : undefined,
          min: el instanceof HTMLInputElement ? el.min : undefined,
          max: el instanceof HTMLInputElement ? el.max : undefined,
          validity: el.validity,
        },
        lang,
      );
      if (text) {
        el.setAttribute("aria-invalid", "true");
        first ??= { el, text };
      } else {
        el.removeAttribute("aria-invalid");
      }
    }
    if (first) {
      event.preventDefault();
      setMessage(first.text);
      first.el.focus();
      return;
    }
    setMessage(null);
    onSubmit?.(event);
  }

  function handleInput(event: React.FormEvent<HTMLFormElement>) {
    const target = event.target as Element;
    if (target.getAttribute("aria-invalid") === "true") target.removeAttribute("aria-invalid");
    if (message) setMessage(null);
    onInput?.(event);
  }

  return (
    <form {...rest} noValidate onSubmit={handleSubmit} onInput={handleInput}>
      {message ? (
        <div className="mb-4" role="alert">
          <ErrorAlert message={message} title={errorTitle ?? (lang === "ar" ? "يُرجى تصحيح الحقل" : "Please check this field")} />
        </div>
      ) : null}
      {children}
    </form>
  );
}
