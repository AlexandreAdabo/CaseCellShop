import type { OrderStatusResponse } from '../domain/types.js';
import type { AppLogger } from '../infrastructure/logger.js';
import { OrderRepository } from '../repositories/order.repository.js';

export class OrderService {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly logger: AppLogger,
  ) {}

  getOrderStatus(orderId: string): OrderStatusResponse | null {
    const order = this.orderRepository.getOrder(orderId);
    if (order) {
      this.logger.info({
        orderId: order.orderId,
        status: order.status,
      }, 'order.status.read');
    }

    return order;
  }
}
