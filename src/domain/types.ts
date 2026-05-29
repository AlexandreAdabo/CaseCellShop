export type Product = {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  stockAvailable: number;
  stockReserved: number;
};

export type CheckoutItemInput = {
  productId: string;
  quantity: number;
};

export type CheckoutRequest = {
  items: CheckoutItemInput[];
};

export type OrderStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type RequestContext = {
  requestId: string;
  correlationId: string;
  traceId: string;
};

export type CheckoutResponse = {
  orderId: string;
  status: OrderStatus;
  statusUrl: string;
  totalCents: number;
  idempotencyKey?: string;
};

export type OrderStatusResponse = {
  orderId: string;
  status: OrderStatus;
  totalCents: number;
  idempotencyKey: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  statusUrl: string;
};

export type OrderItemRow = {
  productId: string;
  quantity: number;
  unitPriceCents: number;
};

export type CheckoutResult = {
  orderId: string;
  totalCents: number;
  idempotencyKey: string | null;
  status: OrderStatus;
  created: boolean;
};

export type ErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};
