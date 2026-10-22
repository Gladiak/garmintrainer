export const SECRET_FILES = Object.freeze([
  "data/secrets/db_password",
  "data/secrets/db_root_password",
  "data/encryption.key",
]);
export const GIT_CRYPT_HEADER = Buffer.from("\0GITCRYPT\0");
export const isEncrypted = (value) =>
  value.subarray(0, GIT_CRYPT_HEADER.length).equals(GIT_CRYPT_HEADER);
