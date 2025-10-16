import { IViolation } from '@/models/violation';
import { IPlate } from '@/models/plate';
import { vehicleTypes } from '@/constants/consts';
import { States } from '@/constants/consts';

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

export const buildViolationMessage = function (violation: IViolation, isNew: boolean): string {
  const plate = violation.plate as IPlate
  const message = (isNew ? `Phát hiện vi phạm mới!\n` : '') +
    `Biển kiểm soát: ${plate.plateNumber}\n` +
    `Màu biển: ${plate.plateColor}\n` +
    `Loại phương tiện: ${vehicleTypes[plate.vehicleType]}\n` +
    `Thời gian vi phạm: ${violation.timeOfViolation.toLocaleString()}\n` +
    `Địa điểm vi phạm: ${violation.locationOfViolation}\n` +
    `Hành vi vi phạm: ${violation.violation}\n` +
    `Đơn vị phát hiện vi phạm: ${violation.unitDetectingViolation}\n` +
    `Nơi giải quyết vụ việc: ${violation.placeOfSettlement}\n` +
    `Trạng thái: ${States[violation.status]}`;
  return message;
}