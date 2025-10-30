let accessToken = null;
const subscribers = new Set();
export function getAuthToken() {
    return accessToken;
}
export function setAuthToken(token) {
    accessToken = token;
    subscribers.forEach((cb) => cb(token));
}
export function subscribeAuthToken(cb) {
    subscribers.add(cb);
    return () => {
        subscribers.delete(cb);
    };
}
