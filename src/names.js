const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function validateName(name) {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new Error(`geçersiz ad ${JSON.stringify(name)}: yalnızca küçük harf, rakam ve '-' kullanılabilir, '-' ile başlayamaz`);
  }
  return name;
}
