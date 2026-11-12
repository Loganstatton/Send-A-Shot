export function encryptBackup(data: Buffer, passphrase: string): Buffer;
export function decryptBackup(file: Buffer, passphrase: string): Buffer;
export const MIN_KEY_LENGTH: number;
