/** @param {string} value */
export function migrationDatabaseUrl(value) {
  const url = new URL(value);
  if (url.hostname.endsWith(".pooler.supabase.com") && (!url.port || url.port === "5432")) {
    // The migration runner keeps every statement inside one explicit transaction.
    // It can share the transaction pool instead of competing for session slots.
    url.port = "6543";
    return url.toString();
  }
  return value;
}
