import { z } from "zod";

// Supabase authenticates by email; username accounts use a non-deliverable alias.
export const hostLoginEmail = z.string().trim().min(1).max(254)
  .pipe(z.union([z.email(), z.string().regex(/^[a-zA-Z0-9_]{3,32}$/)]))
  .transform(value => value.includes("@") ? value : `${value.toLowerCase()}@umc-night.invalid`);
