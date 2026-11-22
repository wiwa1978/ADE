export class HttpError extends Error {
	readonly status: number;
	readonly statusCode: number;
	readonly stderr?: string;

	constructor(status: number, message: string, options?: { cause?: unknown; stderr?: string }) {
		super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
		this.name = "HttpError";
		this.status = status;
		this.statusCode = status;
		if (options?.stderr !== undefined) {
			this.stderr = options.stderr;
		}
	}
}

export function httpError(status: number, message: string, options?: { cause?: unknown; stderr?: string }): HttpError {
	return new HttpError(status, message, options);
}

export function badRequest(message: string): HttpError {
	return new HttpError(400, message);
}

export function forbidden(message: string): HttpError {
	return new HttpError(403, message);
}

export function notFound(message: string): HttpError {
	return new HttpError(404, message);
}

export function conflict(message: string): HttpError {
	return new HttpError(409, message);
}

export function payloadTooLarge(message: string): HttpError {
	return new HttpError(413, message);
}

export function unsupportedMediaType(message: string): HttpError {
	return new HttpError(415, message);
}

export function internalError(message: string, options?: { cause?: unknown }): HttpError {
	return new HttpError(500, message, options);
}

export function notImplemented(message: string): HttpError {
	return new HttpError(501, message);
}

export function badGateway(message: string, options?: { cause?: unknown; stderr?: string }): HttpError {
	return new HttpError(502, message, options);
}

export function serviceUnavailable(message: string): HttpError {
	return new HttpError(503, message);
}
