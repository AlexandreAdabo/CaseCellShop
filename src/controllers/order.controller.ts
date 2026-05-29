import type { Request, Response } from 'express';
import { createErrorBody } from './http-response.js';
import { OrderService } from '../services/order.service.js';

export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  getOrderStatus = (req: Request, res: Response): void => {
    const orderId = Array.isArray(req.params.orderId) ? req.params.orderId[0] : req.params.orderId;
    const order = this.orderService.getOrderStatus(orderId);

    if (!order) {
      res.status(404).json(createErrorBody('ORDER_NOT_FOUND', `Order ${orderId} not found.`));
      return;
    }

    res.json(order);
  };
}
