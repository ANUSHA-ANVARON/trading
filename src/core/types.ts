export type IsoDateTime = string;

export type Side = "BUY" | "SELL";

export type Candle = {
  time: IsoDateTime; // ISO string
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type Market = {
  exchange: string;
  tradingsymbol: string;
};

export type Order = {
  id: string;
  time: IsoDateTime;
  market: Market;
  side: Side;
  quantity: number;
  type: "MARKET";
};

export type Fill = {
  orderId: string;
  time: IsoDateTime;
  side: Side;
  price: number;
  quantity: number;
  fees: number;
};

export type Position = {
  market: Market;
  quantity: number;
  avgPrice: number;
};

export type EquityPoint = {
  time: IsoDateTime;
  equity: number;
  cash: number;
  unrealizedPnl: number;
  realizedPnl: number;
};
