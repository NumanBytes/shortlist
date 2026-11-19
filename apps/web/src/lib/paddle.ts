// Paddle.js, Paddle's checkout (docs/billing.md §20.4). Loaded only when someone opens a checkout,
// from Paddle's CDN as Paddle requires, and never precached by the service worker. It takes the
// public client-side token, never an API key; the price and the user were fixed on our server
// when it created the transaction, so the browser can't change what is bought or for whom.

interface PaddleJs {
  Environment: { set(env: 'sandbox'): void };
  Initialize(opts: { token: string; eventCallback?: (e: { name?: string }) => void }): void;
  Checkout: { open(opts: { transactionId: string }): void };
}

declare global {
  interface Window {
    Paddle?: PaddleJs;
  }
}

const SCRIPT = 'https://cdn.paddle.com/paddle/v2/paddle.js';

let loading: Promise<PaddleJs> | null = null;
let initializedFor: string | null = null;
let onCompleted: (() => void) | null = null;

function load(): Promise<PaddleJs> {
  if (window.Paddle) return Promise.resolve(window.Paddle);
  loading ??= new Promise<PaddleJs>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (window.Paddle ? resolve(window.Paddle) : reject(new Error('Paddle.js did not load')));
    script.onerror = () => {
      loading = null;
      reject(new Error("Couldn't load the checkout — check your connection and try again"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

// Opens Paddle's checkout overlay for a transaction our server created. `completed` runs when the
// payment goes through; the plan itself changes when Paddle's webhook reaches the server.
export async function openCheckout(
  client: { environment: 'sandbox' | 'production'; token: string },
  transactionId: string,
  completed: () => void,
) {
  const paddle = await load();
  onCompleted = completed;
  if (initializedFor !== client.token) {
    if (client.environment === 'sandbox') paddle.Environment.set('sandbox');
    paddle.Initialize({
      token: client.token,
      eventCallback: (e) => {
        if (e.name === 'checkout.completed') onCompleted?.();
      },
    });
    initializedFor = client.token;
  }
  paddle.Checkout.open({ transactionId });
}
