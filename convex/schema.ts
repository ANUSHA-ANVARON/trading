import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  predictions: defineTable({
    predId:      v.string(),
    date:        v.string(),   // YYYY-MM-DD IST
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
  })
    .index("by_predId", ["predId"])
    .index("by_date",   ["date"]),
});
