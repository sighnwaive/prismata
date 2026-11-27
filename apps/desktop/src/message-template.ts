export function interpolateMessageTemplate(
  message: string,
  variables: Record<string, string | number | undefined>,
): string {
  return message.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (placeholder, name: string) => {
    const value = variables[name];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : placeholder;
  });
}
