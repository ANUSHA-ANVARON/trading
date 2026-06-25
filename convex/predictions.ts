import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const predFields = {
  predId:      v.string(),
  date:        v.string(),
  asof:        v.string(),
  timeframe:   v.string(),
  direction:   v.string(),
  entryPrice:  v.number(),
  targetPrice: v.number(),
  stopPrice:   v.number(),
  confidence:  v.number(),
  lifecycle:   v.string(),
  session:     v.string(),
  signals: v.object({
    rsi1m:       v.union(v.number(), v.null()),
    rsi5m:       v.union(v.number(), v.null()),
    rsi15m:      v.union(v.number(), v.null()),
    bbPctB5m:    v.union(v.number(), v.null()),
    bbPctB15m:   v.union(v.number(), v.null()),
    spartanNet:  v.number(),
    surfNet:     v.number(),
    breadthMove: v.number(),
    tfAgree:     v.number(),
  }),
  outcome:      v.string(),
  outcomePrice: v.union(v.number(), v.null()),
  outcomeAt:    v.union(v.string(), v.null()),
  pnlPoints:    v.union(v.number(), v.null()),
} as const;

// Insert or update a prediction by predId.
export const upsertPrediction = mutation({
  args: predFields,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("predictions")
      .withIndex("by_predId", (q) => q.eq("predId", args.predId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("predictions", args);
    }
  },
});

// Return all predictions for a given date (YYYY-MM-DD IST), sorted entry-time asc.
export const getByDate = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const rows = await ctx.db
      .query("predictions")
      .withIndex("by_date", (q) => q.eq("date", date))
      .collect();
    return rows.sort((a, b) => a.asof.localeCompare(b.asof));
  },
});

// Return the distinct dates for which predictions exist, newest first.
export const getAvailableDates = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("predictions").collect();
    const set = new Set(rows.map((r) => r.date));
    return [...set].sort().reverse();
  },
});
