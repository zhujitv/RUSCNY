import { z } from 'zod';

/** Identity fields are rendered in transcripts and line-oriented exports. */
export const safeIdentityText = (minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .min(minimum)
    .max(maximum)
    .refine(
      (value) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value),
      '姓名和公司不能包含换行或控制字符',
    );
