import { formatCurrency as formatCurrencyValue, formatDateTime } from "@/lib/localization";

export function formatCurrency(value: number) {
  return formatCurrencyValue(value, { maximumFractionDigits: 2 });
}

export function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

export function labelize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

export function today() {
  return new Date().toISOString().split("T")[0];
}

export function currentPeriod() {
  return today().slice(0, 7);
}

export function getPeriodEnd(period: string) {
  const [year, month] = period.split("-").map(Number);
  return new Date(year, month, 0).toISOString().split("T")[0];
}

export function defaultDateForPeriod(period: string) {
  return period === currentPeriod() ? today() : `${period}-01`;
}

export { formatDateTime };