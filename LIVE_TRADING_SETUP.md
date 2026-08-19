# DeveloperHCR V1.0 BETA — Live Trading

## Broker
This release includes an opt-in Zerodha Kite Connect adapter.

## Required server environment
- `KITE_API_KEY` — broker API key
- `KITE_API_SECRET` — broker API secret; server-side only
- `KITE_REDIRECT_URL` — optional, defaults to `http://127.0.0.1:8000/api/trading/live/callback`
- `LIVE_TRADING_ENABLED=1` — required before real order submission
- `KITE_ACCESS_TOKEN` — optional for an already authenticated session; otherwise use Connect Broker in the UI

Never put `KITE_API_SECRET` in frontend JavaScript, an APK, or a public repository.

## Live flow
1. Configure broker credentials on the local/server environment.
2. Open DeveloperHCR → Trading → Connect Broker.
3. Complete the broker login.
4. Refresh broker status.
5. Live quotes/orders/portfolio become available when authenticated.
6. Prepare a real order.
7. Review symbol, side, quantity, product, order type and price.
8. Confirm within 120 seconds.
9. DeveloperHCR sends the order only when `LIVE_TRADING_ENABLED=1`.

Practice Trading remains completely separate and never sends exchange orders.

## Safety
A successful broker API request to place an order is not proof that the exchange executed it. Always check the order book/history and trade status.
