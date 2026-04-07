export class MatrixError extends Error {
  constructor(message, errcode = 'M_UNKNOWN', status = 500) {
    super(message);
    this.name = 'MatrixError';
    this.errcode = errcode;
    this.status = status;
  }
}

export class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TimeoutError';
  }
}