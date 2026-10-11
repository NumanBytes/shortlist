import { z } from 'zod';

// A date that can't be in the future. Checked per request with refine — a plain
// `.max(new Date())` would freeze "now" at the moment the module was first imported.
export const PastDate = z.coerce.date().refine((d) => d.getTime() <= Date.now(), 'Date cannot be in the future');

// http(s) only. A bare z.url() also accepts `javascript:` URLs, which would become
// an XSS hole the moment the web app renders one as a link.
export const WebUrl = z.url({ protocol: /^https?$/, message: 'Must be an http(s) URL' });

export const nonEmptyUpdate = (data: object) => Object.keys(data).length > 0;
export const NON_EMPTY_UPDATE_MESSAGE = 'Provide at least one field to update';
