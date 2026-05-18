Notes on limitations:

- Kite Connect does not provide full historical option-chain OI snapshots. This means a strict backtest of a signal that depends on PCR / option-chain OI over time requires an external historical options dataset.
- The included bias engine is best used for real-time (or replay with recorded snapshots), and for paper trading confirmation.
- The futures candle backtest in this repo backtests price-based strategies using futures candles (with fees + slippage) and is suitable for validating entries/exits based on price/indicators.
