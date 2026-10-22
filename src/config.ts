import { homedir } from "node:os";
import { join } from "node:path";

export const config = {
  rplCsvUrl: process.env.LEKI_RPL_URL ?? "https://rejestry.ezdrowie.gov.pl/api/rpl/medicinal-products/public-pl-report/get-csv",
  refundIndexUrl: process.env.LEKI_REFUND_INDEX_URL ?? "https://www.gov.pl/web/zdrowie/obwieszczenia-ministra-zdrowia-lista-lekow-refundowanych",
  /** direct link to the refund list annex (.xlsx), skips discovery on gov.pl */
  refundXlsxUrl: process.env.LEKI_REFUND_XLSX_URL,
  dataDir: process.env.LEKI_DATA_DIR ?? join(homedir(), ".cache", "leki-mcp"),
  refreshHours: Number(process.env.LEKI_REFRESH_HOURS ?? 24),
  log: process.env.LEKI_LOG ?? "info",
  userAgent: "leki-mcp (+https://github.com/ContentWriterco/leki-mcp)",
};

export function log(level: "debug" | "info" | "warn" | "error", ...args: unknown[]) {
  const order = { debug: 0, info: 1, warn: 2, error: 3 } as const;
  if (order[level] < (order[config.log as keyof typeof order] ?? 1)) return;
  console.error(`[leki-mcp] ${level}:`, ...args);
}

export class UserError extends Error {}
