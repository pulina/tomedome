export type ApiErrorKind =
  | 'validation'
  | 'not_found'
  | 'unprocessable'
  | 'upstream'
  | 'internal';

export interface ApiErrorBody {
  type: ApiErrorKind;
  message: string;
}

export function apiErr(type: ApiErrorKind, message: string): ApiErrorBody {
  return { type, message };
}
