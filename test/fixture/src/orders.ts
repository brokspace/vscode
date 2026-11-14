// A tiny workspace for the integration tests.

/** Creates the order for a cart; safe to retry: the same cart returns the same order. */
export async function createOrder(cartId: string, userId: string): Promise<{ cartId: string; userId: string }> {
    return { cartId, userId };
}
