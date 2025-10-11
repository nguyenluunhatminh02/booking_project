type Subscriber = (token: string | null) => void;

let accessToken: string | null = null;
const subscribers = new Set<Subscriber>();

export function getAuthToken() {
  return accessToken;
}

export function setAuthToken(token: string | null) {
  accessToken = token;
  subscribers.forEach((cb) => cb(token));
}

export function subscribeAuthToken(cb: Subscriber) {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}
