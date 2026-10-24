// Same validation for subscriptions and delivery. Includes Edge/WNS without
// allowing arbitrary HTTPS destinations supplied by a client (SSRF).
export function allowedPushEndpoint(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash &&
      ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.apple.com', 'notify.windows.com']
        .some(host => url.hostname === host || url.hostname.endsWith('.' + host));
  } catch {return false;}
}
