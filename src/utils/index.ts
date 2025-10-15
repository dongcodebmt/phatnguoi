export const parseDate = function (dateString: string): Date | undefined {
  try {
    const [time, date] = dateString.split(', ');
    const [day, month, year] = date.split('/');
    const isoString = `${year}-${month}-${day}T${time}:00`;
    return new Date(isoString);
  } catch {
    return undefined;
  }
}

export const getValueFromObject = function (obj: any, key: string): string {
  return obj.find((i: any) => i.label === key)?.value || undefined;
}