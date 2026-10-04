import { handle, json } from '@/lib/server/http';
import { resetBuiltinPresets } from '@/lib/server/store';

export const POST = handle(async () => json(await resetBuiltinPresets()));
