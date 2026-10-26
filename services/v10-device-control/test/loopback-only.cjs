// Local workerd uses listeners in its child process. Permit loopback IPC while
// denying all remote TCP. The runtime also asserts every worker's fetch mock.
const net = require('node:net');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let options = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (typeof options === 'string' && !/^\d+$/.test(options)) return connect.apply(this, args);
  if (typeof options === 'number' || typeof options === 'string') options = {port:Number(options),host:typeof args[1] === 'string' ? args[1] : 'localhost'};
  if (options && (options.path || options.fd)) return connect.apply(this, args);
  if (!['127.0.0.1', '::1', 'localhost'].includes(options?.host ?? 'localhost')) {
    const error = new Error('Local runtime forbids external network');
    error.code = 'OFFLINE_NETWORK_DENIED'; throw error;
  }
  return connect.apply(this, args);
};
