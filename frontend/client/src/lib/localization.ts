export type AppLanguage = "en" | "ar";

const LANGUAGE_FORMATS = {
  en: { locale: "en-EG", currency: "EGP", currencyLabel: "EGP" },
  ar: { locale: "ar-EG", currency: "EGP", currencyLabel: "ج.م" },
} as const satisfies Record<AppLanguage, {
  locale: string;
  currency: string;
  currencyLabel: string;
}>;

export function isAppLanguage(value: unknown): value is AppLanguage {
  return value === "en" || value === "ar";
}

export function getCurrentLanguage(): AppLanguage {
  if (typeof document !== "undefined" && isAppLanguage(document.documentElement.lang)) {
    return document.documentElement.lang;
  }

  if (typeof localStorage !== "undefined") {
    const storedLanguage = localStorage.getItem("lang");
    if (isAppLanguage(storedLanguage)) {
      return storedLanguage;
    }
  }

  return "en";
}

export function getLanguageFormat(language: AppLanguage = getCurrentLanguage()) {
  return LANGUAGE_FORMATS[language];
}

export function getCurrencyLabel(language: AppLanguage = getCurrentLanguage()) {
  return getLanguageFormat(language).currencyLabel;
}

export function formatCurrency(
  value: number,
  options: Intl.NumberFormatOptions = {},
  language: AppLanguage = getCurrentLanguage(),
) {
  const { locale, currency } = getLanguageFormat(language);

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
    ...options,
  }).format(value);
}

export function formatDateTime(
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions = {},
  language: AppLanguage = getCurrentLanguage(),
) {
  return new Date(value).toLocaleString(getLanguageFormat(language).locale, options);
}

export function formatDate(
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions = {},
  language: AppLanguage = getCurrentLanguage(),
) {
  return new Date(value).toLocaleDateString(getLanguageFormat(language).locale, options);
}
